/**
 * GET  /api/expenses        — list expenses (paginated, filtered)
 * POST /api/expenses        — create expense
 * GET  /api/expenses/[id]   — get expense detail
 * PUT  /api/expenses/[id]   — update expense
 * POST /api/expenses/[id]/submit   — submit for approval
 * POST /api/expenses/[id]/approve  — approve
 * POST /api/expenses/[id]/reject   — reject
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { ExpenseFilters, ApiResponse, PaginatedResponse, ExpenseWithRelations } from '@/types'

// ─── VALIDATION SCHEMAS ─────────────────────────────

export const CreateExpenseSchema = z.object({
  merchant: z.string().min(1).max(200),
  expenseDate: z.string().datetime(),
  currency: z.string().length(3).default('EUR'),
  grossAmount: z.number().positive().max(1_000_000),
  vatRate: z.number().min(0).max(100).optional(),
  vatAmount: z.number().min(0).optional(),
  netAmount: z.number().min(0).optional(),
  vatCodeId: z.string().cuid().optional(),
  categoryId: z.string().optional(),
  departmentId: z.string().cuid().optional(),
  costCenterId: z.string().cuid().optional(),
  projectCode: z.string().max(50).optional(),
  paymentMethod: z.enum(['card', 'cash', 'bank_transfer', 'other']).optional(),
  cardId: z.string().cuid().optional(),
  notes: z.string().max(2000).optional(),
})

export const UpdateExpenseSchema = CreateExpenseSchema.partial()

export const ExpenseFiltersSchema = z.object({
  status: z.array(z.enum(['DRAFT','SUBMITTED','PENDING_APPROVAL','APPROVED','REJECTED','EXPORTED','FLAGGED'])).optional(),
  userId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  costCenterId: z.string().cuid().optional(),
  categoryId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  amountMin: z.coerce.number().optional(),
  amountMax: z.coerce.number().optional(),
  hasReceipt: z.coerce.boolean().optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().min(1).default(1),
  perPage: z.coerce.number().min(1).max(100).default(25),
  sortBy: z.enum(['expenseDate', 'grossAmount', 'merchant', 'createdAt']).default('expenseDate'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
})

// ─── LIST HANDLER ────────────────────────────────────

export async function listExpenses(
  organizationId: string,
  userId: string,
  userRole: string,
  filters: ExpenseFilters
) {
  // Dynamically import prisma to keep this file importable in edge contexts
  const { default: prisma } = await import('@/lib/db/prisma')

  const where: Record<string, unknown> = {
    organizationId,
    deletedAt: null,
  }

  // Employees can only see their own expenses
  if (userRole === 'EMPLOYEE') {
    where.userId = userId
  } else if (filters.userId) {
    where.userId = filters.userId
  }

  if (filters.status?.length) where.status = { in: filters.status }
  if (filters.departmentId) where.departmentId = filters.departmentId
  if (filters.costCenterId) where.costCenterId = filters.costCenterId
  if (filters.categoryId) where.categoryId = filters.categoryId

  if (filters.dateFrom || filters.dateTo) {
    where.expenseDate = {}
    if (filters.dateFrom) (where.expenseDate as Record<string, unknown>).gte = new Date(filters.dateFrom)
    if (filters.dateTo) (where.expenseDate as Record<string, unknown>).lte = new Date(filters.dateTo)
  }

  if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
    where.grossAmount = {}
    if (filters.amountMin !== undefined) (where.grossAmount as Record<string, unknown>).gte = filters.amountMin
    if (filters.amountMax !== undefined) (where.grossAmount as Record<string, unknown>).lte = filters.amountMax
  }

  if (filters.hasReceipt === true) where.receipt = { isNot: null }
  if (filters.hasReceipt === false) where.receipt = { is: null }

  if (filters.search) {
    where.OR = [
      { merchant: { contains: filters.search, mode: 'insensitive' } },
      { notes: { contains: filters.search, mode: 'insensitive' } },
    ]
  }

  const page = filters.page ?? 1
  const perPage = filters.perPage ?? 25

  const [total, items] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        department: true,
        costCenter: true,
        vatCode: true,
        receipt: { select: { id: true, fileUrl: true, ocrProcessed: true } },
        _count: { select: { comments: true, attachments: true } },
      },
      orderBy: { expenseDate: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  return {
    data: items,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
  }
}

// ─── CREATE HANDLER ──────────────────────────────────

export async function createExpense(
  organizationId: string,
  userId: string,
  input: z.infer<typeof CreateExpenseSchema>
) {
  const { default: prisma } = await import('@/lib/db/prisma')

  // Calculate VAT fields if not provided
  let vatAmount = input.vatAmount
  let netAmount = input.netAmount

  if (input.vatRate && input.grossAmount && !vatAmount) {
    netAmount = Math.round((input.grossAmount / (1 + input.vatRate / 100)) * 100) / 100
    vatAmount = Math.round((input.grossAmount - netAmount) * 100) / 100
  }

  const expense = await prisma.expense.create({
    data: {
      organizationId,
      userId,
      merchant: input.merchant,
      expenseDate: new Date(input.expenseDate),
      currency: input.currency,
      grossAmount: input.grossAmount,
      vatRate: input.vatRate,
      vatAmount,
      netAmount,
      vatCodeId: input.vatCodeId,
      categoryId: input.categoryId,
      departmentId: input.departmentId,
      costCenterId: input.costCenterId,
      projectCode: input.projectCode,
      paymentMethod: input.paymentMethod,
      cardId: input.cardId,
      notes: input.notes,
      status: 'DRAFT',
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      department: true,
      costCenter: true,
    },
  })

  // Audit log
  await prisma.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: 'CREATE',
      entityType: 'expense',
      entityId: expense.id,
      after: expense as unknown as Record<string, unknown>,
    },
  })

  return expense
}

// ─── SUBMIT FOR APPROVAL ─────────────────────────────

export async function submitExpense(
  expenseId: string,
  organizationId: string,
  actorId: string
) {
  const { default: prisma } = await import('@/lib/db/prisma')

  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, organizationId, deletedAt: null },
  })

  if (!expense) throw new Error('Expense not found')
  if (!['DRAFT', 'REJECTED'].includes(expense.status)) {
    throw new Error(`Cannot submit expense in status ${expense.status}`)
  }

  const updated = await prisma.expense.update({
    where: { id: expenseId },
    data: { status: 'SUBMITTED' },
  })

  await prisma.auditLog.create({
    data: {
      organizationId, actorId,
      action: 'UPDATE', entityType: 'expense', entityId: expenseId,
      before: { status: expense.status },
      after: { status: 'SUBMITTED' },
    },
  })

  // TODO: Trigger approval workflow engine
  // await approvalEngine.initiate({ entityType: 'expense', entityId: expenseId, organizationId, amount: Number(expense.grossAmount) })

  return updated
}

// ─── APPROVE / REJECT ────────────────────────────────

export async function approveExpense(
  expenseId: string,
  organizationId: string,
  actorId: string,
  comment?: string
) {
  const { default: prisma } = await import('@/lib/db/prisma')

  const before = await prisma.expense.findFirst({ where: { id: expenseId, organizationId } })
  if (!before) throw new Error('Expense not found')

  const updated = await prisma.expense.update({
    where: { id: expenseId },
    data: { status: 'APPROVED', approvalStatus: 'APPROVED' },
  })

  if (comment) {
    await prisma.comment.create({
      data: { authorId: actorId, content: comment, entityType: 'expense', entityId: expenseId, expenseId },
    })
  }

  await prisma.auditLog.create({
    data: {
      organizationId, actorId, action: 'APPROVE',
      entityType: 'expense', entityId: expenseId,
      before: { status: before.status }, after: { status: 'APPROVED' },
    },
  })

  // Notify submitter
  await prisma.notification.create({
    data: {
      userId: before.userId, organizationId,
      type: 'expense_approved', title: 'Expense approved',
      message: `Your expense at ${before.merchant} (€${before.grossAmount}) has been approved`,
      entityType: 'expense', entityId: expenseId,
    },
  })

  return updated
}

export async function rejectExpense(
  expenseId: string,
  organizationId: string,
  actorId: string,
  reason: string
) {
  const { default: prisma } = await import('@/lib/db/prisma')

  const before = await prisma.expense.findFirst({ where: { id: expenseId, organizationId } })
  if (!before) throw new Error('Expense not found')

  const updated = await prisma.expense.update({
    where: { id: expenseId },
    data: { status: 'REJECTED', approvalStatus: 'REJECTED' },
  })

  await prisma.comment.create({
    data: {
      authorId: actorId, content: reason,
      entityType: 'expense', entityId: expenseId, expenseId,
      visibility: 'INTERNAL',
    },
  })

  await prisma.auditLog.create({
    data: {
      organizationId, actorId, action: 'REJECT',
      entityType: 'expense', entityId: expenseId,
      before: { status: before.status }, after: { status: 'REJECTED' },
      metadata: { reason },
    },
  })

  await prisma.notification.create({
    data: {
      userId: before.userId, organizationId,
      type: 'expense_rejected', title: 'Expense rejected',
      message: `Your expense at ${before.merchant} was rejected: ${reason}`,
      entityType: 'expense', entityId: expenseId,
    },
  })

  return updated
}

// ─── VAT SUMMARY ────────────────────────────────────

export async function getVATSummary(organizationId: string, dateFrom: Date, dateTo: Date) {
  const { default: prisma } = await import('@/lib/db/prisma')

  const expenses = await prisma.expense.findMany({
    where: {
      organizationId,
      expenseDate: { gte: dateFrom, lte: dateTo },
      status: { in: ['APPROVED', 'EXPORTED'] },
      deletedAt: null,
    },
    select: { grossAmount: true, vatAmount: true, vatRate: true },
  })

  const summary = { rate19: 0, rate7: 0, rate0: 0, totalReclaimable: 0, total: 0 }

  for (const e of expenses) {
    const vat = Number(e.vatAmount ?? 0)
    const rate = Number(e.vatRate ?? 0)
    summary.total += vat
    if (rate === 19) summary.rate19 += vat
    else if (rate === 7) summary.rate7 += vat
    else summary.rate0 += Number(e.grossAmount)
    summary.totalReclaimable += vat
  }

  return summary
}

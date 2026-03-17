import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import { getApprovalEngine } from '@/lib/services/approval-engine'
import type { SessionUser } from '@/types'

const CreateExpenseSchema = z.object({
  merchant: z.string().min(1).max(200),
  expenseDate: z.string().datetime(),
  currency: z.string().length(3).default('EUR'),
  grossAmount: z.number().positive(),
  vatRate: z.number().min(0).max(100).optional(),
  vatAmount: z.number().min(0).optional(),
  netAmount: z.number().min(0).optional(),
  vatCodeId: z.string().cuid().optional(),
  categoryId: z.string().optional(),
  departmentId: z.string().cuid().optional(),
  costCenterId: z.string().cuid().optional(),
  projectCode: z.string().max(50).optional(),
  paymentMethod: z.enum(['card', 'cash', 'bank_transfer', 'other']).default('card'),
  cardId: z.string().cuid().optional(),
  notes: z.string().max(2000).optional(),
  transactionId: z.string().cuid().optional(),
})

// ─── GET /api/expenses ───────────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)

  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '25'), 100)
  const status = searchParams.getAll('status')
  const userId = searchParams.get('userId')
  const departmentId = searchParams.get('departmentId')
  const costCenterId = searchParams.get('costCenterId')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')
  const amountMin = searchParams.get('amountMin')
  const amountMax = searchParams.get('amountMax')
  const hasReceipt = searchParams.get('hasReceipt')
  const search = searchParams.get('search')

  const where: Record<string, unknown> = {
    organizationId: session.currentOrganizationId,
    deletedAt: null,
  }

  // Scope by role
  if (session.currentRole === 'EMPLOYEE') {
    where.userId = session.id
  } else if (userId) {
    where.userId = userId
  }

  if (status.length > 0) where.status = { in: status }
  if (departmentId) where.departmentId = departmentId
  if (costCenterId) where.costCenterId = costCenterId

  if (dateFrom || dateTo) {
    where.expenseDate = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo) } : {}),
    }
  }

  if (amountMin || amountMax) {
    where.grossAmount = {
      ...(amountMin ? { gte: parseFloat(amountMin) } : {}),
      ...(amountMax ? { lte: parseFloat(amountMax) } : {}),
    }
  }

  if (hasReceipt === 'true') where.receipt = { isNot: null }
  if (hasReceipt === 'false') where.receipt = { is: null }

  if (search) {
    where.OR = [
      { merchant: { contains: search, mode: 'insensitive' } },
      { notes: { contains: search, mode: 'insensitive' } },
      { categoryId: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [total, items] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        department: { select: { id: true, name: true, code: true } },
        costCenter: { select: { id: true, name: true, code: true } },
        vatCode: { select: { id: true, code: true, rate: true, description: true } },
        receipt: { select: { id: true, fileUrl: true, ocrProcessed: true, merchant: true, total: true } },
        _count: { select: { comments: true, attachments: true } },
      },
      orderBy: { expenseDate: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  // Aggregate stats for sidebar filters
  const stats = await prisma.expense.groupBy({
    by: ['status'],
    where: { organizationId: session.currentOrganizationId, deletedAt: null,
      ...(session.currentRole === 'EMPLOYEE' ? { userId: session.id } : {}),
    },
    _count: { status: true },
    _sum: { grossAmount: true },
  })

  return NextResponse.json({
    data: items,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    stats: stats.map((s) => ({ status: s.status, count: s._count.status, total: Number(s._sum.grossAmount ?? 0) })),
  })
})

// ─── POST /api/expenses ──────────────────────────────

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const data = CreateExpenseSchema.parse(body)

  // Compute VAT if not provided
  let { vatAmount, netAmount } = data
  if (data.vatRate && !vatAmount) {
    netAmount = Math.round((data.grossAmount / (1 + data.vatRate / 100)) * 100) / 100
    vatAmount = Math.round((data.grossAmount - netAmount) * 100) / 100
  }

  const expense = await prisma.expense.create({
    data: {
      organizationId: session.currentOrganizationId,
      userId: session.id,
      merchant: data.merchant,
      expenseDate: new Date(data.expenseDate),
      currency: data.currency,
      grossAmount: data.grossAmount,
      vatRate: data.vatRate,
      vatAmount,
      netAmount,
      vatCodeId: data.vatCodeId,
      categoryId: data.categoryId,
      departmentId: data.departmentId,
      costCenterId: data.costCenterId,
      projectCode: data.projectCode,
      paymentMethod: data.paymentMethod,
      cardId: data.cardId,
      notes: data.notes,
      transactionId: data.transactionId,
      status: 'DRAFT',
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      department: true,
      costCenter: true,
      vatCode: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'CREATE',
      entityType: 'expense',
      entityId: expense.id,
      after: { merchant: expense.merchant, grossAmount: Number(expense.grossAmount) },
    },
  })

  return NextResponse.json({ data: expense }, { status: 201 })
})

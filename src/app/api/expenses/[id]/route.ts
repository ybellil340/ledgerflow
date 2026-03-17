export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import { getApprovalEngine } from '@/lib/services/approval-engine'
import { canManageExpense, canApproveExpense } from '@/lib/auth/rbac'
import type { SessionUser } from '@/types'

type Params = { id: string }

// ─── GET /api/expenses/[id] ──────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
  const expense = await prisma.expense.findFirst({
    where: { id: params!.id, organizationId: session.currentOrganizationId, deletedAt: null },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } },
      department: true,
      costCenter: true,
      vatCode: true,
      receipt: true,
      attachments: true,
      comments: {
        include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })

  if (!canManageExpense(session, expense.userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({ data: expense })
})

// ─── PUT /api/expenses/[id] ──────────────────────────

const UpdateExpenseSchema = z.object({
  merchant: z.string().min(1).max(200).optional(),
  expenseDate: z.string().datetime().optional(),
  currency: z.string().length(3).optional(),
  grossAmount: z.number().positive().optional(),
  vatRate: z.number().min(0).max(100).optional(),
  vatAmount: z.number().min(0).optional(),
  netAmount: z.number().min(0).optional(),
  vatCodeId: z.string().cuid().optional(),
  categoryId: z.string().optional(),
  departmentId: z.string().cuid().optional(),
  costCenterId: z.string().cuid().optional(),
  projectCode: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
})

export const PUT = withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
  const expense = await prisma.expense.findFirst({
    where: { id: params!.id, organizationId: session.currentOrganizationId, deletedAt: null },
  })
  if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  if (!canManageExpense(session, expense.userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Can't edit exported expenses
  if (expense.status === 'EXPORTED') {
    return NextResponse.json({ error: 'Cannot edit an exported expense' }, { status: 400 })
  }

  const body = await req.json()
  const data = UpdateExpenseSchema.parse(body)

  // Recompute VAT if gross or rate changed
  let vatAmount = data.vatAmount
  let netAmount = data.netAmount
  const grossAmount = data.grossAmount ?? Number(expense.grossAmount)
  const vatRate = data.vatRate ?? Number(expense.vatRate ?? 0)

  if ((data.grossAmount !== undefined || data.vatRate !== undefined) && !vatAmount) {
    if (vatRate > 0) {
      netAmount = Math.round((grossAmount / (1 + vatRate / 100)) * 100) / 100
      vatAmount = Math.round((grossAmount - netAmount) * 100) / 100
    }
  }

  const before = { status: expense.status, grossAmount: expense.grossAmount }

  const updated = await prisma.expense.update({
    where: { id: params!.id },
    data: {
      ...data,
      ...(data.expenseDate ? { expenseDate: new Date(data.expenseDate) } : {}),
      ...(vatAmount !== undefined ? { vatAmount } : {}),
      ...(netAmount !== undefined ? { netAmount } : {}),
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      department: true,
      costCenter: true,
      vatCode: true,
      receipt: { select: { id: true, fileUrl: true } },
    },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'UPDATE',
      entityType: 'expense',
      entityId: params!.id,
      before,
      after: { grossAmount: updated.grossAmount, status: updated.status },
    },
  })

  return NextResponse.json({ data: updated })
})

// ─── DELETE /api/expenses/[id] ───────────────────────

export const DELETE = withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
  const expense = await prisma.expense.findFirst({
    where: { id: params!.id, organizationId: session.currentOrganizationId, deletedAt: null },
  })
  if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  if (!canManageExpense(session, expense.userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (expense.status === 'EXPORTED') return NextResponse.json({ error: 'Cannot delete an exported expense' }, { status: 400 })

  await prisma.expense.update({ where: { id: params!.id }, data: { deletedAt: new Date() } })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'DELETE',
      entityType: 'expense',
      entityId: params!.id,
      before: { status: expense.status },
    },
  })

  return NextResponse.json({ data: { success: true } })
})

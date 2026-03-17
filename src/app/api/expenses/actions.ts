export const dynamic = 'force-dynamic'

// /api/expenses/[id]/submit  — POST
// /api/expenses/[id]/approve — POST  
// /api/expenses/[id]/reject  — POST
// /api/expenses/[id]/export  — POST (add to export batch)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import { getApprovalEngine } from '@/lib/services/approval-engine'
import { canApproveExpense } from '@/lib/auth/rbac'
import type { SessionUser } from '@/types'

type Params = { id: string }

// ─── SUBMIT ──────────────────────────────────────────

export async function submitExpenseAction(expenseId: string, session: SessionUser): Promise<NextResponse> {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, organizationId: session.currentOrganizationId, deletedAt: null },
  })
  if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  if (expense.userId !== session.id && !session.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!['DRAFT', 'REJECTED'].includes(expense.status)) {
    return NextResponse.json({ error: `Cannot submit expense with status ${expense.status}` }, { status: 400 })
  }

  // Check for receipt — warn but don't block
  const hasReceipt = await prisma.receipt.findFirst({ where: { expenseId } })
  const warnings = !hasReceipt ? ['No receipt attached — this may delay approval'] : []

  const updated = await prisma.expense.update({
    where: { id: expenseId },
    data: { status: 'SUBMITTED' },
  })

  // Trigger approval engine
  const engine = await getApprovalEngine()
  const { requiresApproval } = await engine.initiate({
    entityType: 'expense',
    entityId: expenseId,
    organizationId: session.currentOrganizationId,
    amount: Number(expense.grossAmount),
    departmentId: expense.departmentId ?? undefined,
    userId: session.id,
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'UPDATE',
      entityType: 'expense',
      entityId: expenseId,
      before: { status: 'DRAFT' },
      after: { status: requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED' },
    },
  })

  const final = await prisma.expense.findUnique({ where: { id: expenseId } })
  return NextResponse.json({ data: final, warnings })
}

// ─── APPROVE ─────────────────────────────────────────

export async function approveExpenseAction(
  expenseId: string,
  session: SessionUser,
  comment?: string
): Promise<NextResponse> {
  if (!canApproveExpense(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, organizationId: session.currentOrganizationId },
  })
  if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  if (!['SUBMITTED', 'PENDING_APPROVAL'].includes(expense.status)) {
    return NextResponse.json({ error: `Cannot approve expense with status ${expense.status}` }, { status: 400 })
  }

  const updated = await prisma.expense.update({
    where: { id: expenseId },
    data: { status: 'APPROVED', approvalStatus: 'APPROVED' },
  })

  if (comment) {
    await prisma.comment.create({
      data: {
        authorId: session.id,
        content: comment,
        entityType: 'expense',
        entityId: expenseId,
        expenseId,
        visibility: 'INTERNAL',
      },
    })
  }

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'APPROVE',
      entityType: 'expense',
      entityId: expenseId,
      before: { status: expense.status },
      after: { status: 'APPROVED' },
      metadata: { comment },
    },
  })

  await prisma.notification.create({
    data: {
      userId: expense.userId,
      organizationId: session.currentOrganizationId,
      type: 'expense_approved',
      title: 'Expense approved',
      message: `Your expense at ${expense.merchant} (€${Number(expense.grossAmount).toFixed(2)}) was approved`,
      entityType: 'expense',
      entityId: expenseId,
    },
  })

  return NextResponse.json({ data: updated })
}

// ─── REJECT ──────────────────────────────────────────

export async function rejectExpenseAction(
  expenseId: string,
  session: SessionUser,
  reason: string
): Promise<NextResponse> {
  if (!canApproveExpense(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, organizationId: session.currentOrganizationId },
  })
  if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })

  const updated = await prisma.expense.update({
    where: { id: expenseId },
    data: { status: 'REJECTED', approvalStatus: 'REJECTED' },
  })

  await prisma.comment.create({
    data: {
      authorId: session.id,
      content: reason,
      entityType: 'expense',
      entityId: expenseId,
      expenseId,
      visibility: 'INTERNAL',
    },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'REJECT',
      entityType: 'expense',
      entityId: expenseId,
      before: { status: expense.status },
      after: { status: 'REJECTED' },
      metadata: { reason },
    },
  })

  await prisma.notification.create({
    data: {
      userId: expense.userId,
      organizationId: session.currentOrganizationId,
      type: 'expense_rejected',
      title: 'Expense rejected',
      message: `Your expense at ${expense.merchant} was rejected: ${reason}`,
      entityType: 'expense',
      entityId: expenseId,
    },
  })

  return NextResponse.json({ data: updated })
}

// ─── ROUTE HANDLERS ──────────────────────────────────

// These get registered as separate route files:
// src/app/api/expenses/[id]/submit/route.ts
// src/app/api/expenses/[id]/approve/route.ts
// src/app/api/expenses/[id]/reject/route.ts

export function makeSubmitRoute() {
  return withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
    return submitExpenseAction(params!.id, session)
  })
}

export function makeApproveRoute() {
  return withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
    const body = await req.json().catch(() => ({}))
    return approveExpenseAction(params!.id, session, body.comment)
  })
}

export function makeRejectRoute() {
  return withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
    const body = await req.json()
    const { reason } = z.object({ reason: z.string().min(1) }).parse(body)
    return rejectExpenseAction(params!.id, session, reason)
  })
}

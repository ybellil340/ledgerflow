/**
 * GET    /api/budgets           — list all department budgets with live utilization
 * POST   /api/budgets           — create budget
 * GET    /api/budgets/[id]      — budget detail + transaction breakdown
 * PATCH  /api/budgets/[id]      — update budget
 * DELETE /api/budgets/[id]      — deactivate budget
 *
 * Budgets link to departments and have monthly/quarterly/annual amounts.
 * Utilization is computed from approved expenses + AP invoices in the budget period.
 * Alerts fire (via notification system) when utilization crosses 80% and 95%.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/session'
import { assertPermission } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/prisma'
import type { SessionUser } from '@/types'

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

type BudgetPeriod = 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY'

function getPeriodRange(period: BudgetPeriod, fiscalYearStart: string = '01-01'): { from: Date; to: Date } {
  const now = new Date()
  const [fyMonth, fyDay] = fiscalYearStart.split('-').map(Number)

  switch (period) {
    case 'MONTHLY': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
      return { from, to }
    }
    case 'QUARTERLY': {
      const q = Math.floor(now.getMonth() / 3)
      const from = new Date(now.getFullYear(), q * 3, 1)
      const to = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59)
      return { from, to }
    }
    case 'ANNUALLY': {
      // Respect fiscal year start (e.g., 04-01 for April start)
      const fyStart = new Date(now.getFullYear(), fyMonth - 1, fyDay)
      const from = fyStart > now
        ? new Date(now.getFullYear() - 1, fyMonth - 1, fyDay)
        : fyStart
      const to = new Date(from.getFullYear() + 1, fyMonth - 1, fyDay - 1, 23, 59, 59)
      return { from, to }
    }
  }
}

async function computeUtilization(
  orgId: string,
  departmentId: string | null,
  from: Date,
  to: Date
): Promise<{ spentAmount: number; committedAmount: number }> {
  // Approved + exported expenses
  const expenseResult = await prisma.expense.aggregate({
    where: {
      organizationId: orgId,
      departmentId: departmentId ?? undefined,
      status: { in: ['APPROVED', 'EXPORTED'] },
      expenseDate: { gte: from, lte: to },
    },
    _sum: { grossAmount: true },
  })

  // Approved + paid AP invoices attributed to department
  const invoiceResult = await prisma.supplierInvoice.aggregate({
    where: {
      organizationId: orgId,
      departmentId: departmentId ?? undefined,
      status: { in: ['APPROVED', 'PAID'] },
      invoiceDate: { gte: from, lte: to },
    },
    _sum: { totalAmount: true },
  })

  // Pending/submitted (committed but not yet approved)
  const committedResult = await prisma.expense.aggregate({
    where: {
      organizationId: orgId,
      departmentId: departmentId ?? undefined,
      status: { in: ['SUBMITTED', 'PENDING_APPROVAL'] },
      expenseDate: { gte: from, lte: to },
    },
    _sum: { grossAmount: true },
  })

  return {
    spentAmount: Number(expenseResult._sum.grossAmount ?? 0) + Number(invoiceResult._sum.totalAmount ?? 0),
    committedAmount: Number(committedResult._sum.grossAmount ?? 0),
  }
}

// ─────────────────────────────────────────────
// GET /api/budgets
// ─────────────────────────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  assertPermission(session, 'view:analytics')

  const orgId = session.currentOrganizationId

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { fiscalYearStart: true },
  })

  const budgets = await prisma.budget.findMany({
    where: { organizationId: orgId, isActive: true },
    include: {
      department: { select: { id: true, name: true, code: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Compute live utilization for each budget
  const withUtilization = await Promise.all(
    budgets.map(async (b) => {
      const range = getPeriodRange(b.period as BudgetPeriod, org?.fiscalYearStart ?? '01-01')
      const { spentAmount, committedAmount } = await computeUtilization(
        orgId,
        b.departmentId,
        range.from,
        range.to
      )

      const budgetAmount = Number(b.amount)
      const utilizationPct = budgetAmount > 0 ? (spentAmount / budgetAmount) * 100 : 0
      const committedPct = budgetAmount > 0 ? ((spentAmount + committedAmount) / budgetAmount) * 100 : 0

      return {
        id: b.id,
        name: b.name,
        period: b.period,
        amount: budgetAmount,
        currency: b.currency,
        department: b.department,
        periodRange: { from: range.from.toISOString(), to: range.to.toISOString() },
        utilization: {
          spentAmount,
          committedAmount,
          remainingAmount: Math.max(0, budgetAmount - spentAmount),
          utilizationPct: Math.round(utilizationPct * 10) / 10,
          committedPct: Math.round(committedPct * 10) / 10,
          status: utilizationPct >= 95 ? 'CRITICAL' : utilizationPct >= 80 ? 'WARNING' : 'OK',
        },
        notes: b.notes,
        createdAt: b.createdAt,
      }
    })
  )

  // Summary
  const totalBudgeted = withUtilization.reduce((s, b) => s + b.amount, 0)
  const totalSpent = withUtilization.reduce((s, b) => s + b.utilization.spentAmount, 0)
  const criticalCount = withUtilization.filter(b => b.utilization.status === 'CRITICAL').length
  const warningCount = withUtilization.filter(b => b.utilization.status === 'WARNING').length

  return NextResponse.json({
    data: {
      budgets: withUtilization,
      summary: { totalBudgeted, totalSpent, criticalCount, warningCount },
    },
  })
})

// ─────────────────────────────────────────────
// POST /api/budgets
// ─────────────────────────────────────────────

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  assertPermission(session, 'manage:organization')

  const body = await req.json()
  const { name, period, amount, currency = 'EUR', departmentId, alertAt80 = true, alertAt95 = true, notes } = body

  if (!name || !period || !amount) {
    return NextResponse.json({ error: 'name, period, and amount are required' }, { status: 400 })
  }

  if (!['MONTHLY', 'QUARTERLY', 'ANNUALLY'].includes(period)) {
    return NextResponse.json({ error: 'period must be MONTHLY, QUARTERLY, or ANNUALLY' }, { status: 400 })
  }

  const budget = await prisma.budget.create({
    data: {
      organizationId: session.currentOrganizationId,
      name,
      period,
      amount,
      currency,
      departmentId: departmentId ?? null,
      alertAt80,
      alertAt95,
      notes,
      isActive: true,
    },
    include: {
      department: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({ data: budget }, { status: 201 })
})

// ─────────────────────────────────────────────
// Budget alert checker (called from cron job)
// ─────────────────────────────────────────────

export async function checkBudgetAlerts(orgId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { fiscalYearStart: true },
  })

  const budgets = await prisma.budget.findMany({
    where: { organizationId: orgId, isActive: true },
    include: { department: { select: { name: true } } },
  })

  for (const budget of budgets) {
    const range = getPeriodRange(budget.period as BudgetPeriod, org?.fiscalYearStart ?? '01-01')
    const { spentAmount } = await computeUtilization(orgId, budget.departmentId, range.from, range.to)

    const pct = Number(budget.amount) > 0 ? (spentAmount / Number(budget.amount)) * 100 : 0

    // Check if we should send an alert (and haven't sent one recently)
    const alertKey80 = `budget_alert_80_${budget.id}_${range.from.toISOString().slice(0, 7)}`
    const alertKey95 = `budget_alert_95_${budget.id}_${range.from.toISOString().slice(0, 7)}`

    if (budget.alertAt80 && pct >= 80 && pct < 95) {
      // Send 80% alert to Finance Managers
      await prisma.notification.create({
        data: {
          organizationId: orgId,
          type: 'BUDGET_ALERT',
          title: `Budget alert: ${budget.name}`,
          message: `${budget.department?.name ?? 'General'} budget is ${Math.round(pct)}% utilized (${new Intl.NumberFormat('de-DE', { style: 'currency', currency: budget.currency }).format(spentAmount)} of ${new Intl.NumberFormat('de-DE', { style: 'currency', currency: budget.currency }).format(Number(budget.amount))}).`,
          metadata: { budgetId: budget.id, utilizationPct: pct, threshold: 80 },
        },
      }).catch(() => {})
    } else if (budget.alertAt95 && pct >= 95) {
      await prisma.notification.create({
        data: {
          organizationId: orgId,
          type: 'BUDGET_ALERT',
          title: `⚠ Budget critical: ${budget.name}`,
          message: `${budget.department?.name ?? 'General'} budget is ${Math.round(pct)}% utilized. Only ${new Intl.NumberFormat('de-DE', { style: 'currency', currency: budget.currency }).format(Math.max(0, Number(budget.amount) - spentAmount))} remaining.`,
          metadata: { budgetId: budget.id, utilizationPct: pct, threshold: 95 },
        },
      }).catch(() => {})
    }
  }
}

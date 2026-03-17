/**
 * LedgerFlow Cash Flow Forecasting Service
 *
 * Combines:
 * - Open AR invoices (expected inflows)
 * - Open AP invoices (expected outflows)
 * - Recurring expenses patterns
 * - Payroll estimates
 * - Tax obligation estimates
 * - Manual cash events
 *
 * Modular: designed for AI/ML forecasting to be plugged in later.
 */

import type { CashFlowForecast, CashFlowDataPoint, CashFlowObligation, CashFlowInflow } from '@/types'

interface ForecastParams {
  organizationId: string
  currentBalance: number
  horizonDays: 30 | 60 | 90 | 180
}

export async function generateCashFlowForecast(params: ForecastParams): Promise<CashFlowForecast> {
  const { default: prisma } = await import('@/lib/db/prisma')
  const { organizationId, currentBalance, horizonDays } = params

  const today = new Date()
  const horizonDate = new Date()
  horizonDate.setDate(horizonDate.getDate() + horizonDays)

  // ── EXPECTED INFLOWS ──────────────────────────────
  const openCustomerInvoices = await prisma.customerInvoice.findMany({
    where: {
      organizationId,
      status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID'] },
      dueDate: { lte: horizonDate },
      deletedAt: null,
    },
    include: { customer: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
  })

  const inflows: CashFlowInflow[] = openCustomerInvoices.map((inv) => ({
    description: `${inv.customer.name} — ${inv.invoiceNumber}`,
    amount: Number(inv.total) - Number(inv.paidAmount),
    expectedDate: inv.dueDate.toISOString().slice(0, 10),
    invoiceId: inv.id,
    probability: invoiceProbability(inv.dueDate, inv.status),
  }))

  // ── EXPECTED OUTFLOWS ─────────────────────────────
  const openSupplierInvoices = await prisma.supplierInvoice.findMany({
    where: {
      organizationId,
      status: { in: ['APPROVED', 'OVERDUE'] },
      dueDate: { lte: horizonDate },
      deletedAt: null,
    },
    include: { supplier: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
  })

  const obligations: CashFlowObligation[] = openSupplierInvoices.map((inv) => ({
    description: `${inv.supplier.name} — ${inv.invoiceNumber}`,
    amount: Number(inv.grossAmount) - Number(inv.paidAmount ?? 0),
    dueDate: inv.dueDate.toISOString().slice(0, 10),
    category: 'invoice',
  }))

  // ── PAYROLL ESTIMATE ──────────────────────────────
  // Estimate from headcount × average salary (simplified)
  const memberCount = await prisma.organizationMembership.count({
    where: { organizationId, status: 'ACTIVE' },
  })

  const estimatedMonthlySalary = 3200 // €3,200 avg per employee per month
  const payrollAmount = memberCount * estimatedMonthlySalary

  // Add payroll dates within horizon
  let payrollDate = new Date(today.getFullYear(), today.getMonth(), 28)
  while (payrollDate <= horizonDate) {
    if (payrollDate >= today) {
      obligations.push({
        description: `Payroll — ${memberCount} employees`,
        amount: payrollAmount,
        dueDate: payrollDate.toISOString().slice(0, 10),
        category: 'payroll',
      })
    }
    payrollDate = new Date(payrollDate.getFullYear(), payrollDate.getMonth() + 1, 28)
  }

  // ── VAT OBLIGATIONS ───────────────────────────────
  // Voranmeldung: 10th of each month (or quarterly for small businesses)
  const nextVATDate = nextVoranmeldungDate(today)
  if (nextVATDate <= horizonDate) {
    // Estimate from recent expenses VAT
    const recentExpenses = await prisma.expense.findMany({
      where: {
        organizationId,
        status: 'APPROVED',
        expenseDate: { gte: new Date(today.getFullYear(), today.getMonth() - 1, 1) },
      },
      select: { vatAmount: true },
    })

    const estimatedVAT = recentExpenses.reduce((sum, e) => sum + Number(e.vatAmount ?? 0), 0)

    obligations.push({
      description: 'USt-Voranmeldung',
      amount: Math.max(estimatedVAT * 1.2, 500), // rough estimate
      dueDate: nextVATDate.toISOString().slice(0, 10),
      category: 'tax',
    })
  }

  // ── BUILD TIME SERIES ─────────────────────────────
  const dataPoints = buildTimeSeries({
    today,
    horizonDate,
    currentBalance,
    inflows,
    obligations,
  })

  const expectedInflow = inflows.reduce((s, i) => s + i.amount * (i.probability ?? 0.9), 0)
  const expectedOutflow = obligations.reduce((s, o) => s + o.amount, 0)
  const projectedBalance = currentBalance + expectedInflow - expectedOutflow
  const runway = projectedBalance > 0 && expectedOutflow > 0
    ? Math.round((projectedBalance / (expectedOutflow / horizonDays)) * 10) / 10
    : undefined

  return {
    currentBalance,
    projectedBalance,
    expectedInflow,
    expectedOutflow,
    runway,
    dataPoints,
    upcomingObligations: obligations.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    expectedInflows: inflows.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)),
  }
}

// ─────────────────────────────────────────────
// TIME SERIES BUILDER
// ─────────────────────────────────────────────

function buildTimeSeries(params: {
  today: Date
  horizonDate: Date
  currentBalance: number
  inflows: CashFlowInflow[]
  obligations: CashFlowObligation[]
}): CashFlowDataPoint[] {
  const { today, horizonDate, currentBalance, inflows, obligations } = params
  const points: CashFlowDataPoint[] = []

  // Build a map of daily cashflows
  const dailyInflows: Record<string, number> = {}
  const dailyOutflows: Record<string, number> = {}

  for (const inf of inflows) {
    dailyInflows[inf.expectedDate] = (dailyInflows[inf.expectedDate] ?? 0) + inf.amount * (inf.probability ?? 0.9)
  }

  for (const ob of obligations) {
    dailyOutflows[ob.dueDate] = (dailyOutflows[ob.dueDate] ?? 0) + ob.amount
  }

  let runningBalance = currentBalance
  const cur = new Date(today)

  while (cur <= horizonDate) {
    const dateStr = cur.toISOString().slice(0, 10)
    const inflow = dailyInflows[dateStr] ?? 0
    const outflow = dailyOutflows[dateStr] ?? 0
    runningBalance = runningBalance + inflow - outflow

    if (inflow > 0 || outflow > 0) {
      points.push({
        date: dateStr,
        inflow,
        outflow,
        balance: Math.round(runningBalance * 100) / 100,
        isProjected: true,
      })
    }

    cur.setDate(cur.getDate() + 1)
  }

  return points
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function invoiceProbability(dueDate: Date, status: string): number {
  const daysUntilDue = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

  if (status === 'VIEWED') return 0.9
  if (daysUntilDue <= 0) return 0.6   // overdue
  if (daysUntilDue <= 7) return 0.85
  if (daysUntilDue <= 30) return 0.8
  return 0.7
}

function nextVoranmeldungDate(from: Date): Date {
  // Voranmeldung is due on the 10th of the following month
  const next = new Date(from.getFullYear(), from.getMonth() + 1, 10)
  return next
}

// ─────────────────────────────────────────────
// HISTORICAL ANALYTICS
// ─────────────────────────────────────────────

export async function getMonthlyFlowHistory(
  organizationId: string,
  months: number = 6
): Promise<Array<{ month: string; inflow: number; outflow: number; net: number }>> {
  const { default: prisma } = await import('@/lib/db/prisma')

  const result = []
  const today = new Date()

  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const end = new Date(today.getFullYear(), today.getMonth() - i + 1, 0)

    const [inflows, outflows] = await Promise.all([
      prisma.customerInvoice.aggregate({
        where: {
          organizationId,
          status: { in: ['PAID', 'PARTIALLY_PAID'] },
          paidAt: { gte: start, lte: end },
        },
        _sum: { total: true },
      }),
      prisma.expense.aggregate({
        where: {
          organizationId,
          status: { in: ['APPROVED', 'EXPORTED'] },
          expenseDate: { gte: start, lte: end },
        },
        _sum: { grossAmount: true },
      }),
    ])

    const inflow = Number(inflows._sum.total ?? 0)
    const outflow = Number(outflows._sum.grossAmount ?? 0)

    result.push({
      month: start.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }),
      inflow,
      outflow,
      net: inflow - outflow,
    })
  }

  return result
}

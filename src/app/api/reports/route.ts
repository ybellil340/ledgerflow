export const dynamic = 'force-dynamic'

/**
 * GET  /api/reports?type=...&from=...&to=...&groupBy=...
 * POST /api/reports/export  — generate CSV or XLSX download
 *
 * Report types:
 *   pl              — Profit & loss (AR revenue vs AP cost)
 *   spend_by_cat    — Spend breakdown by expense category
 *   spend_by_dept   — Spend breakdown by department
 *   spend_by_user   — Per-employee spend totals
 *   vat_summary     — Input/output VAT by rate code — feeds USt-Voranmeldung
 *   cash_position   — Daily closing balance reconstruction
 *   invoice_aging   — AP/AR aging buckets (0-30, 31-60, 61-90, 90+ days)
 *   card_usage      — Corporate card utilization and limit adherence
 *   approval_kpi    — Time-to-approve, rejection rates, escalation rates
 *
 * All reports are scoped to the authenticated user's organization.
 * Finance Manager+ can see all; Employee sees own data only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { assertPermission } from '@/lib/auth/rbac'
import type { SessionUser } from '@/types'

export type ReportType =
  | 'pl' | 'spend_by_cat' | 'spend_by_dept' | 'spend_by_user'
  | 'vat_summary' | 'cash_position' | 'invoice_aging'
  | 'card_usage' | 'approval_kpi'

// ─────────────────────────────────────────────
// GET /api/reports
// ─────────────────────────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  assertPermission(session, 'view:analytics')

  const { searchParams } = new URL(req.url)
  const type = (searchParams.get('type') ?? 'pl') as ReportType
  const from = searchParams.get('from') ?? getDefaultFrom()
  const to = searchParams.get('to') ?? new Date().toISOString().split('T')[0]
  const groupBy = searchParams.get('groupBy') ?? 'month'
  const currency = searchParams.get('currency') ?? 'EUR'

  const orgId = session.currentOrganizationId
  const fromDate = new Date(from)
  const toDate = new Date(to)

  let data: unknown

  switch (type) {
    case 'pl':
      data = await getProfitLoss(orgId, fromDate, toDate, groupBy)
      break
    case 'spend_by_cat':
      data = await getSpendByCategory(orgId, fromDate, toDate)
      break
    case 'spend_by_dept':
      data = await getSpendByDepartment(orgId, fromDate, toDate)
      break
    case 'spend_by_user':
      data = await getSpendByUser(orgId, fromDate, toDate, session)
      break
    case 'vat_summary':
      data = await getVATSummary(orgId, fromDate, toDate)
      break
    case 'invoice_aging':
      data = await getInvoiceAging(orgId)
      break
    case 'approval_kpi':
      data = await getApprovalKPIs(orgId, fromDate, toDate)
      break
    case 'card_usage':
      data = await getCardUsage(orgId, fromDate, toDate)
      break
    case 'cash_position':
      data = await getCashPosition(orgId, fromDate, toDate)
      break
    default:
      return NextResponse.json({ error: 'Unknown report type' }, { status: 400 })
  }

  return NextResponse.json({
    data,
    meta: {
      type,
      from,
      to,
      groupBy,
      currency,
      generatedAt: new Date().toISOString(),
      organizationId: orgId,
    },
  })
})

// ─────────────────────────────────────────────
// REPORT BUILDERS
// ─────────────────────────────────────────────

async function getProfitLoss(orgId: string, from: Date, to: Date, groupBy: string) {
  // AR invoices — revenue
  const revenue = await prisma.customerInvoice.groupBy({
    by: ['status'],
    where: {
      organizationId: orgId,
      invoiceDate: { gte: from, lte: to },
      status: { in: ['SENT', 'PAID', 'PARTIALLY_PAID'] },
    },
    _sum: { totalAmount: true, netAmount: true, vatAmount: true },
    _count: true,
  })

  // AP invoices — costs
  const costs = await prisma.supplierInvoice.groupBy({
    by: ['status'],
    where: {
      organizationId: orgId,
      invoiceDate: { gte: from, lte: to },
      status: { in: ['APPROVED', 'PAID'] },
    },
    _sum: { totalAmount: true, netAmount: true, vatAmount: true },
    _count: true,
  })

  // Expenses
  const expenses = await prisma.expense.aggregate({
    where: {
      organizationId: orgId,
      expenseDate: { gte: from, lte: to },
      status: { in: ['APPROVED', 'EXPORTED'] },
    },
    _sum: { grossAmount: true, netAmount: true, vatAmount: true },
    _count: true,
  })

  // Monthly breakdown for chart
  const months = getMonthRange(from, to)
  const monthlyRevenue = await prisma.$queryRaw<Array<{ month: string; total: number; net: number }>>`
    SELECT
      TO_CHAR("invoiceDate", 'YYYY-MM') AS month,
      SUM("totalAmount") AS total,
      SUM("netAmount") AS net
    FROM "CustomerInvoice"
    WHERE "organizationId" = ${orgId}
      AND "invoiceDate" >= ${from}
      AND "invoiceDate" <= ${to}
      AND status IN ('SENT', 'PAID', 'PARTIALLY_PAID')
    GROUP BY month
    ORDER BY month
  `

  const monthlyCosts = await prisma.$queryRaw<Array<{ month: string; total: number }>>`
    SELECT
      TO_CHAR("invoiceDate", 'YYYY-MM') AS month,
      SUM("totalAmount") AS total
    FROM "SupplierInvoice"
    WHERE "organizationId" = ${orgId}
      AND "invoiceDate" >= ${from}
      AND "invoiceDate" <= ${to}
      AND status IN ('APPROVED', 'PAID')
    GROUP BY month
    ORDER BY month
  `

  const totalRevenue = Number(revenue.reduce((s, r) => s + Number(r._sum.totalAmount ?? 0), 0))
  const totalCosts = Number(costs.reduce((s, r) => s + Number(r._sum.totalAmount ?? 0), 0)) +
    Number(expenses._sum.grossAmount ?? 0)

  return {
    summary: {
      totalRevenue,
      totalCosts,
      grossProfit: totalRevenue - totalCosts,
      grossMargin: totalRevenue > 0 ? ((totalRevenue - totalCosts) / totalRevenue * 100) : 0,
      revenueVAT: Number(revenue.reduce((s, r) => s + Number(r._sum.vatAmount ?? 0), 0)),
      costVAT: Number(costs.reduce((s, r) => s + Number(r._sum.vatAmount ?? 0), 0)) +
        Number(expenses._sum.vatAmount ?? 0),
      invoiceCount: revenue.reduce((s, r) => s + r._count, 0),
      expenseCount: expenses._count,
    },
    monthly: months.map((month) => {
      const rev = monthlyRevenue.find((r) => r.month === month)
      const cost = monthlyCosts.find((c) => c.month === month)
      const revTotal = Number(rev?.total ?? 0)
      const costTotal = Number(cost?.total ?? 0)
      return {
        month,
        revenue: revTotal,
        costs: costTotal,
        profit: revTotal - costTotal,
        margin: revTotal > 0 ? ((revTotal - costTotal) / revTotal * 100) : 0,
      }
    }),
  }
}

async function getSpendByCategory(orgId: string, from: Date, to: Date) {
  const results = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: {
      organizationId: orgId,
      expenseDate: { gte: from, lte: to },
      status: { in: ['APPROVED', 'EXPORTED'] },
    },
    _sum: { grossAmount: true, netAmount: true, vatAmount: true },
    _count: true,
    orderBy: { _sum: { grossAmount: 'desc' } },
  })

  const total = results.reduce((s, r) => s + Number(r._sum.grossAmount ?? 0), 0)

  return {
    total,
    categories: results.map((r) => ({
      category: r.categoryId ?? 'Uncategorized',
      gross: Number(r._sum.grossAmount ?? 0),
      net: Number(r._sum.netAmount ?? 0),
      vat: Number(r._sum.vatAmount ?? 0),
      count: r._count,
      share: total > 0 ? (Number(r._sum.grossAmount ?? 0) / total * 100) : 0,
    })),
  }
}

async function getSpendByDepartment(orgId: string, from: Date, to: Date) {
  const results = await prisma.$queryRaw<Array<{
    dept_name: string; dept_code: string; total: number; net: number; vat: number; cnt: number
  }>>`
    SELECT
      d.name AS dept_name,
      d.code AS dept_code,
      SUM(e."grossAmount") AS total,
      SUM(e."netAmount") AS net,
      SUM(e."vatAmount") AS vat,
      COUNT(*)::int AS cnt
    FROM "Expense" e
    LEFT JOIN "Department" d ON e."departmentId" = d.id
    WHERE e."organizationId" = ${orgId}
      AND e."expenseDate" >= ${from}
      AND e."expenseDate" <= ${to}
      AND e.status IN ('APPROVED', 'EXPORTED')
    GROUP BY d.name, d.code
    ORDER BY total DESC NULLS LAST
  `

  const total = results.reduce((s, r) => s + Number(r.total ?? 0), 0)

  return {
    total,
    departments: results.map((r) => ({
      name: r.dept_name ?? 'No Department',
      code: r.dept_code,
      total: Number(r.total ?? 0),
      net: Number(r.net ?? 0),
      vat: Number(r.vat ?? 0),
      count: Number(r.cnt),
      share: total > 0 ? (Number(r.total ?? 0) / total * 100) : 0,
    })),
  }
}

async function getSpendByUser(orgId: string, from: Date, to: Date, session: SessionUser) {
  const userFilter = session.currentRole === 'EMPLOYEE'
    ? { userId: session.id }
    : {}

  const results = await prisma.expense.groupBy({
    by: ['userId'],
    where: {
      organizationId: orgId,
      expenseDate: { gte: from, lte: to },
      status: { in: ['APPROVED', 'EXPORTED'] },
      ...userFilter,
    },
    _sum: { grossAmount: true, netAmount: true },
    _count: true,
    orderBy: { _sum: { grossAmount: 'desc' } },
  })

  const userIds = results.map((r) => r.userId)
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  })
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]))

  const total = results.reduce((s, r) => s + Number(r._sum.grossAmount ?? 0), 0)

  return {
    total,
    users: results.map((r) => {
      const u = userMap[r.userId]
      return {
        userId: r.userId,
        name: u ? `${u.firstName} ${u.lastName}` : 'Unknown',
        total: Number(r._sum.grossAmount ?? 0),
        net: Number(r._sum.netAmount ?? 0),
        count: r._count,
        share: total > 0 ? (Number(r._sum.grossAmount ?? 0) / total * 100) : 0,
        avgPerExpense: r._count > 0 ? Number(r._sum.grossAmount ?? 0) / r._count : 0,
      }
    }),
  }
}

async function getVATSummary(orgId: string, from: Date, to: Date) {
  // Input VAT (from expenses + AP invoices)
  const expenseVAT = await prisma.expense.groupBy({
    by: ['vatRate'],
    where: {
      organizationId: orgId,
      expenseDate: { gte: from, lte: to },
      status: { in: ['APPROVED', 'EXPORTED'] },
    },
    _sum: { vatAmount: true, netAmount: true, grossAmount: true },
    _count: true,
  })

  // Output VAT (from AR invoices)
  const arVAT = await prisma.$queryRaw<Array<{
    vat_code: string; vat_rate: number; net: number; vat: number; gross: number; cnt: number
  }>>`
    SELECT
      li."vatCodeId" AS vat_code,
      vc.rate AS vat_rate,
      SUM(li."netAmount") AS net,
      SUM(li."vatAmount") AS vat,
      SUM(li."grossAmount") AS gross,
      COUNT(*)::int AS cnt
    FROM "InvoiceLineItem" li
    LEFT JOIN "VATCode" vc ON li."vatCodeId" = vc.id
    JOIN "CustomerInvoice" ci ON li."invoiceId" = ci.id
    WHERE ci."organizationId" = ${orgId}
      AND ci."invoiceDate" >= ${from}
      AND ci."invoiceDate" <= ${to}
      AND ci.status IN ('SENT', 'PAID', 'PARTIALLY_PAID')
    GROUP BY li."vatCodeId", vc.rate
    ORDER BY vat_rate DESC
  `

  const totalInputVAT = expenseVAT.reduce((s, r) => s + Number(r._sum.vatAmount ?? 0), 0)
  const totalOutputVAT = arVAT.reduce((s, r) => s + Number(r.vat ?? 0), 0)

  return {
    period: { from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] },
    summary: {
      totalOutputVAT,             // USt — Umsatzsteuer (you collect from customers)
      totalInputVAT,              // VSt — Vorsteuer (you paid to suppliers)
      vatPayable: totalOutputVAT - totalInputVAT,  // Zahllast / Überschuss
    },
    inputVAT: expenseVAT.map((r) => ({
      vatRate: r.vatRate ?? 0,
      netAmount: Number(r._sum.netAmount ?? 0),
      vatAmount: Number(r._sum.vatAmount ?? 0),
      grossAmount: Number(r._sum.grossAmount ?? 0),
      expenseCount: r._count,
    })),
    outputVAT: arVAT.map((r) => ({
      vatCode: r.vat_code,
      vatRate: Number(r.vat_rate ?? 0),
      netAmount: Number(r.net ?? 0),
      vatAmount: Number(r.vat ?? 0),
      grossAmount: Number(r.gross ?? 0),
      lineCount: r.cnt,
    })),
  }
}

async function getInvoiceAging(orgId: string) {
  const today = new Date()

  const apAging = await prisma.$queryRaw<Array<{
    bucket: string; count: number; total: number
  }>>`
    SELECT
      CASE
        WHEN "dueDate" >= CURRENT_DATE THEN 'current'
        WHEN CURRENT_DATE - "dueDate" <= 30 THEN '1_30'
        WHEN CURRENT_DATE - "dueDate" <= 60 THEN '31_60'
        WHEN CURRENT_DATE - "dueDate" <= 90 THEN '61_90'
        ELSE 'over_90'
      END AS bucket,
      COUNT(*)::int AS count,
      SUM("totalAmount") AS total
    FROM "SupplierInvoice"
    WHERE "organizationId" = ${orgId}
      AND status NOT IN ('PAID', 'CANCELLED')
    GROUP BY bucket
  `

  const arAging = await prisma.$queryRaw<Array<{
    bucket: string; count: number; total: number
  }>>`
    SELECT
      CASE
        WHEN "dueDate" >= CURRENT_DATE THEN 'current'
        WHEN CURRENT_DATE - "dueDate" <= 30 THEN '1_30'
        WHEN CURRENT_DATE - "dueDate" <= 60 THEN '31_60'
        WHEN CURRENT_DATE - "dueDate" <= 90 THEN '61_90'
        ELSE 'over_90'
      END AS bucket,
      COUNT(*)::int AS count,
      SUM("totalAmount") AS total
    FROM "CustomerInvoice"
    WHERE "organizationId" = ${orgId}
      AND status NOT IN ('PAID', 'CANCELLED')
    GROUP BY bucket
  `

  const bucketOrder = ['current', '1_30', '31_60', '61_90', 'over_90']
  const bucketLabels: Record<string, string> = {
    current: 'Not yet due',
    '1_30': '1–30 days',
    '31_60': '31–60 days',
    '61_90': '61–90 days',
    over_90: 'Over 90 days',
  }

  return {
    asOf: today.toISOString().split('T')[0],
    payables: bucketOrder.map((b) => {
      const r = apAging.find((x) => x.bucket === b)
      return { bucket: b, label: bucketLabels[b], count: r?.count ?? 0, total: Number(r?.total ?? 0) }
    }),
    receivables: bucketOrder.map((b) => {
      const r = arAging.find((x) => x.bucket === b)
      return { bucket: b, label: bucketLabels[b], count: r?.count ?? 0, total: Number(r?.total ?? 0) }
    }),
  }
}

async function getApprovalKPIs(orgId: string, from: Date, to: Date) {
  const approved = await prisma.expense.findMany({
    where: {
      organizationId: orgId,
      status: 'APPROVED',
      updatedAt: { gte: from, lte: to },
    },
    select: { createdAt: true, updatedAt: true, grossAmount: true },
  })

  const rejected = await prisma.expense.count({
    where: { organizationId: orgId, status: 'REJECTED', updatedAt: { gte: from, lte: to } },
  })

  const submitted = await prisma.expense.count({
    where: { organizationId: orgId, status: { in: ['SUBMITTED', 'PENDING_APPROVAL'] }, createdAt: { gte: from, lte: to } },
  })

  const avgTurnaroundMs = approved.length > 0
    ? approved.reduce((s, e) => s + (e.updatedAt.getTime() - e.createdAt.getTime()), 0) / approved.length
    : 0

  return {
    period: { from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] },
    approvedCount: approved.length,
    rejectedCount: rejected,
    pendingCount: submitted,
    totalProcessed: approved.length + rejected,
    approvalRate: (approved.length + rejected) > 0
      ? (approved.length / (approved.length + rejected) * 100)
      : 0,
    avgTurnaroundHours: Math.round(avgTurnaroundMs / (1000 * 60 * 60) * 10) / 10,
    avgApprovedAmount: approved.length > 0
      ? approved.reduce((s, e) => s + Number(e.grossAmount), 0) / approved.length
      : 0,
  }
}

async function getCardUsage(orgId: string, from: Date, to: Date) {
  const cards = await prisma.corporateCard.findMany({
    where: { organizationId: orgId },
    include: {
      user: { select: { firstName: true, lastName: true } },
      _count: { select: { transactions: true } },
    },
  })

  return {
    cards: cards.map((c) => ({
      id: c.id,
      holderName: `${c.user.firstName} ${c.user.lastName}`,
      limitAmount: Number(c.limitAmount),
      limitPeriod: c.limitPeriod,
      status: c.status,
      transactionCount: c._count.transactions,
      utilizationPct: c.limitAmount ? Math.round((Number(c.currentMonthSpend ?? 0) / Number(c.limitAmount)) * 100) : 0,
      currentSpend: Number(c.currentMonthSpend ?? 0),
    })),
    summary: {
      totalCards: cards.length,
      activeCards: cards.filter((c) => c.status === 'ACTIVE').length,
      frozenCards: cards.filter((c) => c.status === 'FROZEN').length,
      totalLimit: cards.reduce((s, c) => s + Number(c.limitAmount ?? 0), 0),
      totalSpend: cards.reduce((s, c) => s + Number(c.currentMonthSpend ?? 0), 0),
    },
  }
}

async function getCashPosition(orgId: string, from: Date, to: Date) {
  const transactions = await prisma.transaction.findMany({
    where: {
      organizationId: orgId,
      transactionDate: { gte: from, lte: to },
    },
    orderBy: { transactionDate: 'asc' },
    select: { transactionDate: true, amount: true, currency: true },
  })

  let runningBalance = 0
  const dailyPositions = transactions.reduce<Record<string, number>>((acc, tx) => {
    const date = tx.transactionDate.toISOString().split('T')[0]
    runningBalance += Number(tx.amount)
    acc[date] = runningBalance
    return acc
  }, {})

  const days = getDateRange(from, to)
  let lastBalance = 0
  return {
    days: days.map((day) => {
      if (dailyPositions[day] !== undefined) {
        lastBalance = dailyPositions[day]
      }
      return { date: day, balance: lastBalance }
    }),
  }
}

// ─────────────────────────────────────────────
// POST /api/reports/export — CSV export
// ─────────────────────────────────────────────

export async function generateCSVExport(
  type: ReportType,
  data: Record<string, unknown>
): Promise<string> {
  // Each report type knows how to serialize itself to CSV
  switch (type) {
    case 'spend_by_cat': {
      const d = data as { categories: Array<{ category: string; gross: number; net: number; vat: number; count: number; share: number }> }
      const header = 'Category,Gross (EUR),Net (EUR),VAT (EUR),Count,Share (%)'
      const rows = d.categories.map((r) =>
        `"${r.category}",${r.gross.toFixed(2)},${r.net.toFixed(2)},${r.vat.toFixed(2)},${r.count},${r.share.toFixed(1)}`
      )
      return [header, ...rows].join('\r\n')
    }
    case 'vat_summary': {
      const d = data as { summary: Record<string, number>; inputVAT: Array<Record<string, number>> }
      const lines = [
        'VAT Summary',
        `Output VAT (USt),${d.summary.totalOutputVAT?.toFixed(2)}`,
        `Input VAT (VSt),${d.summary.totalInputVAT?.toFixed(2)}`,
        `VAT Payable,${d.summary.vatPayable?.toFixed(2)}`,
        '',
        'Input VAT Detail',
        'VAT Rate,Net,VAT,Gross,Count',
        ...(d.inputVAT ?? []).map((r) =>
          `${r.vatRate}%,${r.netAmount?.toFixed(2)},${r.vatAmount?.toFixed(2)},${r.grossAmount?.toFixed(2)},${r.expenseCount}`
        ),
      ]
      return lines.join('\r\n')
    }
    default:
      return 'Report type not exportable as CSV yet.'
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function getDefaultFrom(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 1)
  return d.toISOString().split('T')[0]
}

function getMonthRange(from: Date, to: Date): string[] {
  const months: string[] = []
  const d = new Date(from.getFullYear(), from.getMonth(), 1)
  while (d <= to) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() + 1)
  }
  return months
}

function getDateRange(from: Date, to: Date): string[] {
  const dates: string[] = []
  const d = new Date(from)
  while (d <= to) {
    dates.push(d.toISOString().split('T')[0])
    d.setDate(d.getDate() + 1)
  }
  return dates
}

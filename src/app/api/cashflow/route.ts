export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import { generateCashFlowForecast, getMonthlyFlowHistory } from '@/lib/services/cash-flow'
import type { SessionUser } from '@/types'

// ─── GET /api/cashflow ───────────────────────
// Returns forecast + historical data in one call

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)
  const horizon = parseInt(searchParams.get('horizon') ?? '30') as 30 | 60 | 90
  const historyMonths = parseInt(searchParams.get('historyMonths') ?? '6')

  const orgId = session.currentOrganizationId

  // Get current balance (mock until real banking integration)
  // In production this comes from the open banking provider
  const mockBalance = await estimateCurrentBalance(orgId)

  const [forecast, history, vatObligations, payrollEstimate] = await Promise.all([
    generateCashFlowForecast({ organizationId: orgId, currentBalance: mockBalance, horizonDays: horizon }),
    getMonthlyFlowHistory(orgId, historyMonths),
    getUpcomingVATObligations(orgId),
    getPayrollEstimate(orgId),
  ])

  // Burn rate: average monthly outflow over last 3 months
  const recentOutflows = history.slice(-3).map((h) => h.outflow)
  const burnRate = recentOutflows.length > 0
    ? recentOutflows.reduce((s, v) => s + v, 0) / recentOutflows.length
    : 0

  // Runway in months
  const runwayMonths = burnRate > 0 ? Math.floor(mockBalance / burnRate) : null

  return NextResponse.json({
    data: {
      forecast,
      history,
      summary: {
        currentBalance: mockBalance,
        burnRate,
        runwayMonths,
        vatObligations,
        payrollEstimate,
        expectedInflow30d: forecast.expectedInflow,
        expectedOutflow30d: forecast.expectedOutflow,
        projectedBalance30d: forecast.projectedBalance,
      },
    },
  })
}, 'view:analytics')

// ─── POST /api/cashflow/events ────────────────
// Manual cash events (one-time inflows/outflows)

const ManualEventSchema = z.object({
  description: z.string().min(1).max(200),
  amount: z.number(), // positive = inflow, negative = outflow
  expectedDate: z.string().datetime(),
  category: z.enum(['inflow', 'outflow', 'payroll', 'tax', 'investment']),
  isRecurring: z.boolean().default(false),
  recurringRule: z.object({
    frequency: z.enum(['weekly', 'monthly', 'quarterly']),
    endDate: z.string().optional(),
  }).optional(),
})

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const data = ManualEventSchema.parse(body)

  // Store as a special transaction record tagged as manual cash event
  const event = await prisma.transaction.create({
    data: {
      organizationId: session.currentOrganizationId,
      merchant: data.description,
      amount: data.amount,
      currency: 'EUR',
      transactionDate: new Date(data.expectedDate),
      merchantCategory: `manual_event:${data.category}`,
      description: data.description,
      status: 'CATEGORIZED',
    },
  })

  return NextResponse.json({ data: event }, { status: 201 })
}, 'view:analytics')

// ─── HELPERS ─────────────────────────────────

async function estimateCurrentBalance(orgId: string): Promise<number> {
  // Without a real banking integration, estimate from transaction history
  // In production: fetch from Tink/Plaid/finAPI
  const recentTransactions = await prisma.transaction.aggregate({
    where: {
      organizationId: orgId,
      transactionDate: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
    _sum: { amount: true },
  })

  // Return a seeded demo value for the mock environment
  const seed = Number(recentTransactions._sum.amount ?? 0)
  return Math.max(20000, 124500 + seed * 0.1) // Demo: ~€124k
}

async function getUpcomingVATObligations(orgId: string): Promise<Array<{ type: string; amount: number; dueDate: string }>> {
  const now = new Date()
  const results = []

  // USt-Voranmeldung: 10th of next month
  const voranmeldungDate = new Date(now.getFullYear(), now.getMonth() + 1, 10)
  if (voranmeldungDate > now) {
    // Estimate from this month's expenses
    const expenses = await prisma.expense.aggregate({
      where: {
        organizationId: orgId,
        status: { in: ['APPROVED', 'EXPORTED'] },
        expenseDate: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
      },
      _sum: { vatAmount: true, grossAmount: true },
    })
    const inputVAT = Number(expenses._sum.vatAmount ?? 0)
    const outputVAT = inputVAT * 1.5 // Rough estimate: output VAT typically higher

    results.push({
      type: 'USt-Voranmeldung',
      amount: Math.max(outputVAT - inputVAT, 0),
      dueDate: voranmeldungDate.toISOString().slice(0, 10),
    })
  }

  return results
}

async function getPayrollEstimate(orgId: string): Promise<{ amount: number; nextDate: string; headcount: number }> {
  const headcount = await prisma.organizationMembership.count({
    where: { organizationId: orgId, status: 'ACTIVE' },
  })

  const avgSalary = 3200 // €3,200 avg per employee
  const amount = headcount * avgSalary

  const now = new Date()
  const nextPayroll = new Date(now.getFullYear(), now.getMonth(), 28)
  if (nextPayroll <= now) {
    nextPayroll.setMonth(nextPayroll.getMonth() + 1)
  }

  return { amount, nextDate: nextPayroll.toISOString().slice(0, 10), headcount }
}

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import { getMonthlyFlowHistory } from '@/lib/services/cash-flow'
import type { SessionUser } from '@/types'

// ─── GET /api/dashboard ──────────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const orgId = session.currentOrganizationId
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  const [
    totalSpend,
    pendingApprovals,
    missingReceipts,
    overdueInvoices,
    spendByCategory,
    unreadNotifications,
    monthlyFlow,
    recentTransactions,
    topMerchants,
    taxObligations,
  ] = await Promise.all([

    // Total spend this month (approved + exported expenses)
    prisma.expense.aggregate({
      where: {
        organizationId: orgId,
        status: { in: ['APPROVED', 'EXPORTED'] },
        expenseDate: { gte: monthStart, lte: monthEnd },
        deletedAt: null,
      },
      _sum: { grossAmount: true },
    }),

    // Pending approvals - return actual expense objects
    prisma.expense.findMany({
      where: {
        organizationId: orgId,
        status: { in: ['SUBMITTED', 'PENDING_APPROVAL'] },
        deletedAt: null,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),

    // Missing receipts (approved expenses with no receipt)
    prisma.expense.findMany({
      where: {
        organizationId: orgId,
        status: { in: ['APPROVED', 'SUBMITTED', 'PENDING_APPROVAL'] },
        receipt: { is: null },
        deletedAt: null,
      },
      select: { grossAmount: true },
    }),

    // Overdue AP invoices
    prisma.supplierInvoice.aggregate({
      where: {
        organizationId: orgId,
        status: 'OVERDUE',
        deletedAt: null,
      },
      _count: { id: true },
      _sum: { grossAmount: true },
    }),

    // Spend by category (this month)
    prisma.expense.groupBy({
      by: ['categoryId'],
      where: {
        organizationId: orgId,
        status: { in: ['APPROVED', 'EXPORTED'] },
        expenseDate: { gte: monthStart, lte: monthEnd },
        deletedAt: null,
      },
      _sum: { grossAmount: true },
      orderBy: { _sum: { grossAmount: 'desc' } },
      take: 8,
    }),

    // Unread notifications for current user
    prisma.notification.count({
      where: { userId: session.id, isRead: false },
    }),

    // Monthly inflow/outflow (last 6 months)
    getMonthlyFlowHistory(orgId, 6),

    // Recent transactions (last 10)
    prisma.transaction.findMany({
      where: { organizationId: orgId, parentId: null },
      include: {
        card: { select: { lastFour: true, user: { select: { firstName: true, lastName: true } } } },
        receipt: { select: { id: true } },
        expense: { select: { id: true, status: true } },
      },
      orderBy: { transactionDate: 'desc' },
      take: 10,
    }),

    // Top merchants this month
    prisma.transaction.groupBy({
      by: ['merchant'],
      where: {
        organizationId: orgId,
        transactionDate: { gte: monthStart },
        amount: { lt: 0 },
      },
      _sum: { amount: true },
      _count: { merchant: true },
      orderBy: { _sum: { amount: 'asc' } }, // most negative = highest spend
      take: 5,
    }),

    // Pending reimbursements
    prisma.reimbursement.count({
      where: { organizationId: orgId, status: { in: ['SUBMITTED', 'APPROVED'] } },
    }),
  ])

  // Compute totals
  const totalSpendAmount = Number(totalSpend._sum.grossAmount ?? 0)
  const missingReceiptsCount = missingReceipts.length
  const missingReceiptsAmount = missingReceipts.reduce((sum, e) => sum + Number(e.grossAmount), 0)

  // Pending approvals with overdue flag
  const oldPending = await prisma.expense.count({
    where: {
      organizationId: orgId,
      status: { in: ['SUBMITTED', 'PENDING_APPROVAL'] },
      createdAt: { lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }, // 3+ days old
      deletedAt: null,
    },
  })

  const categoryNames: Record<string, string> = {
    Travel: 'Travel', Software: 'Software', Meals: 'Meals',
    Equipment: 'Equipment', Marketing: 'Marketing', Office: 'Office',
    Banking: 'Banking', Consulting: 'Consulting', Other: 'Other',
  }

  const spendByCategoryFormatted = spendByCategory.map((item) => {
    const amount = Number(item._sum.grossAmount ?? 0)
    return {
      category: item.categoryId ? (categoryNames[item.categoryId] ?? item.categoryId) : 'Uncategorized',
      amount,
      percentage: totalSpendAmount > 0 ? Math.round((amount / totalSpendAmount) * 100) : 0,
    }
  })

  return NextResponse.json({
    data: {
      totalSpendMonth: totalSpendAmount,
      cashPosition: 124500, // TODO: connect to real bank integration
      pendingApprovals,
      overduePendingApprovals: oldPending,
      missingReceipts: missingReceiptsCount,
      missingReceiptsAmount,
      overdueInvoices: overdueInvoices._count.id,
      overdueInvoicesAmount: Number(overdueInvoices._sum.grossAmount ?? 0),
      spendByCategory: spendByCategoryFormatted,
      monthlyFlow,
      recentTransactions,
      topMerchants: topMerchants.map((m) => ({
        merchant: m.merchant,
        amount: Math.abs(Number(m._sum.amount ?? 0)),
        count: m._count.merchant,
      })),
      unreadNotifications,
      reimbursementQueue: taxObligations,
    },
  })
})

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

// ─── Plan definitions ────────────────────────

export const PLANS = {
  STARTER: {
    name: 'Starter',
    monthlyPrice: 29,
    annualPrice: 290,
    features: ['Up to 5 users', '10 corporate cards', '100 expenses/month', 'DATEV CSV export', 'Email support'],
    limits: { maxUsers: 5, maxCards: 10, maxMonthlyExpenses: 100 },
  },
  GROWTH: {
    name: 'Growth',
    monthlyPrice: 89,
    annualPrice: 890,
    features: ['Up to 25 users', '50 corporate cards', 'Unlimited expenses', 'DATEV Buchungsstapel export', 'Tax advisor portal', 'Approval workflows', 'Priority support'],
    limits: { maxUsers: 25, maxCards: 50, maxMonthlyExpenses: 999999 },
  },
  PRO: {
    name: 'Pro',
    monthlyPrice: 199,
    annualPrice: 1990,
    features: ['Up to 100 users', '200 corporate cards', 'Unlimited everything', 'Multi-entity support', 'API access', 'SSO (coming)', 'Dedicated support'],
    limits: { maxUsers: 100, maxCards: 200, maxMonthlyExpenses: 999999 },
  },
  ENTERPRISE: {
    name: 'Enterprise',
    monthlyPrice: null,
    annualPrice: null,
    features: ['Unlimited users & cards', 'Custom integrations', 'SLA guarantee', 'On-premise option', 'Custom contracts', 'Dedicated CSM'],
    limits: { maxUsers: 999999, maxCards: 999999, maxMonthlyExpenses: 999999 },
  },
} as const

// ─── GET /api/billing ─────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: session.currentOrganizationId },
  })

  if (!subscription) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
  }

  // Usage metrics
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const [activeUsers, activeCards, monthlyExpenses] = await Promise.all([
    prisma.organizationMembership.count({
      where: { organizationId: session.currentOrganizationId, status: 'ACTIVE' },
    }),
    prisma.card.count({
      where: { organizationId: session.currentOrganizationId, status: { in: ['ACTIVE', 'FROZEN'] } },
    }),
    prisma.expense.count({
      where: {
        organizationId: session.currentOrganizationId,
        createdAt: { gte: monthStart },
        deletedAt: null,
      },
    }),
  ])

  const plan = PLANS[subscription.plan]
  const usagePercent = {
    users: Math.round((activeUsers / subscription.maxUsers) * 100),
    cards: Math.round((activeCards / subscription.maxCards) * 100),
    expenses: subscription.maxMonthlyExpenses < 999999
      ? Math.round((monthlyExpenses / subscription.maxMonthlyExpenses) * 100)
      : 0,
  }

  // Mock invoice history (in production: from Stripe)
  const invoiceHistory = [
    { id: 'inv_001', date: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(), amount: plan.monthlyPrice ?? 0, status: 'paid', description: `${plan.name} Plan — ${new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}` },
    { id: 'inv_002', date: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString(), amount: plan.monthlyPrice ?? 0, status: 'paid', description: `${plan.name} Plan — ${new Date(now.getFullYear(), now.getMonth() - 2, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}` },
  ]

  return NextResponse.json({
    data: {
      subscription,
      plan,
      usage: { activeUsers, activeCards, monthlyExpenses, usagePercent },
      invoiceHistory,
      allPlans: PLANS,
    },
  })
}, 'manage:billing')

// ─── POST /api/billing/upgrade ───────────────

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { plan, billingCycle } = z.object({
    plan: z.enum(['STARTER', 'GROWTH', 'PRO', 'ENTERPRISE']),
    billingCycle: z.enum(['monthly', 'annual']).default('monthly'),
  }).parse(await req.json())

  const currentSub = await prisma.subscription.findUnique({
    where: { organizationId: session.currentOrganizationId },
  })

  if (!currentSub) return NextResponse.json({ error: 'No subscription found' }, { status: 404 })

  const planConfig = PLANS[plan]

  // TODO: In production — create Stripe checkout session and redirect
  // For now: directly update subscription (mock)
  const updated = await prisma.subscription.update({
    where: { organizationId: session.currentOrganizationId },
    data: {
      plan: plan as never,
      status: 'ACTIVE',
      maxUsers: planConfig.limits.maxUsers,
      maxCards: planConfig.limits.maxCards,
      maxMonthlyExpenses: planConfig.limits.maxMonthlyExpenses,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + (billingCycle === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000),
    },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'UPDATE',
      entityType: 'subscription',
      entityId: currentSub.id,
      before: { plan: currentSub.plan },
      after: { plan, billingCycle },
    },
  })

  return NextResponse.json({ data: updated })
}, 'manage:billing')

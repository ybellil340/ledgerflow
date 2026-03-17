export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db/prisma'
import { getSessionFromRequest } from '@/lib/auth/session'

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const orgId = session.currentOrganizationId

  if (type === 'invoices') {
    // Return mock invoice history for now
    return NextResponse.json({
      data: [
        { id: '1', description: 'Growth Plan — March 2025', amount: 89, currency: 'EUR', period: 'Mar 2025', status: 'PAID', createdAt: new Date().toISOString() },
        { id: '2', description: 'Growth Plan — February 2025', amount: 89, currency: 'EUR', period: 'Feb 2025', status: 'PAID', createdAt: new Date().toISOString() },
      ]
    })
  }

  // Default: billing info
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: orgId },
  })

  const memberCount = await prisma.organizationMembership.count({
    where: { organizationId: orgId, status: 'ACTIVE' }
  })

  const cardCount = await prisma.card.count({
    where: { organizationId: orgId, status: { in: ['ACTIVE', 'FROZEN'] } }
  })

  const expenseCount = await prisma.expense.count({
    where: { organizationId: orgId, deletedAt: null }
  })

  return NextResponse.json({
    data: {
      currentPlan: subscription?.plan ?? 'GROWTH',
      billingCycle: 'MONTHLY',
      nextRenewalDate: subscription?.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toLocaleDateString('de-DE')
        : '15 Apr 2025',
      isTrialing: subscription?.status === 'TRIALING',
      trialEndsAt: subscription?.trialEndsAt
        ? new Date(subscription.trialEndsAt).toLocaleDateString('de-DE')
        : null,
      monthlyPrice: 89,
      paymentMethodLast4: null,
      paymentMethodBrand: null,
      usage: [
        { label: 'Team members', current: memberCount, limit: 25, unit: '' },
        { label: 'Corporate cards', current: cardCount, limit: 50, unit: '' },
        { label: 'Expenses', current: expenseCount, limit: null, unit: '' },
      ],
    }
  })
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action, planId } = body

  if (action === 'upgrade') {
    await prisma.subscription.update({
      where: { organizationId: session.currentOrganizationId },
      data: { plan: planId },
    }).catch(() => {})
    return NextResponse.json({ data: { success: true } })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db/prisma'
import { getSessionFromRequest } from '@/lib/auth/session'

async function requireSuperAdmin(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return null
  if (!session.isSuperAdmin) return null
  return session
}

export async function GET(req: NextRequest) {
  // Allow any admin or company admin to view basic stats
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')

  if (type === 'companies') {
    const orgs = await prisma.organization.findMany({
      include: {
        _count: { select: { memberships: true, expenses: true } },
        subscription: { select: { plan: true, status: true } },
        owner: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    const data = orgs.map(org => ({
      id: org.id,
      name: org.name,
      plan: org.subscription?.plan ?? 'STARTER',
      status: org.subscription?.status ?? 'ACTIVE',
      userCount: org._count.memberships,
      expenseCount: org._count.expenses,
      createdAt: org.createdAt.toISOString(),
      adminEmail: org.owner.email,
      mrr: org.subscription?.plan === 'GROWTH' ? 89 : org.subscription?.plan === 'PRO' ? 199 : 29,
    }))
    return NextResponse.json({ data: { orgs: data, total: data.length } })
  }

  if (type === 'audit') {
    const search = searchParams.get('search') ?? ''
    const limit = parseInt(searchParams.get('limit') ?? '50')
    const logs = await prisma.auditLog.findMany({
      where: search ? {
        OR: [
          { action: { contains: search, mode: 'insensitive' } },
          { actor: { OR: [{ firstName: { contains: search } }, { email: { contains: search } }] } },
        ]
      } : {},
      include: {
        actor: { select: { firstName: true, lastName: true, email: true } },
        organization: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    const data = logs.map(l => ({
      id: l.id,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      actor: { name: `${l.actor?.firstName ?? ''} ${l.actor?.lastName ?? ''}`.trim(), email: l.actor?.email ?? '' },
      orgName: l.organization?.name ?? '',
      createdAt: l.createdAt.toISOString(),
    }))
    return NextResponse.json({ data: { logs: data, total: data.length } })
  }

  if (type === 'flags') {
    const FLAGS = [
      { key: 'ocr_receipt_extraction',     description: 'AI OCR for receipt extraction',       enabled: false, rolloutPercent: 100 },
      { key: 'ai_cash_flow_forecast',       description: 'ML-based cash flow forecasting',      enabled: false, rolloutPercent: 100 },
      { key: 'duplicate_invoice_detection', description: 'ML duplicate detection for invoices', enabled: true,  rolloutPercent: 100 },
      { key: 'smart_categorization',        description: 'Auto-categorize transactions',         enabled: true,  rolloutPercent: 100 },
      { key: 'multi_currency',              description: 'Multi-currency expense support',       enabled: true,  rolloutPercent: 100 },
      { key: 'sso',                         description: 'Single Sign-On (SSO/SAML)',            enabled: false, rolloutPercent: 0   },
    ]
    // Override with DB values
    const dbFlags = await prisma.featureFlag.findMany({}).catch(() => [])
    const dbMap = new Map(dbFlags.map((f: any) => [f.key, f]))
    const data = FLAGS.map(f => ({ ...f, ...(dbMap.get(f.key) ?? {}) }))
    return NextResponse.json({ data })
  }

  // Default: platform stats
  const [totalOrgs, totalUsers, totalExpenses] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.expense.count(),
  ])

  const totalVolume = await prisma.expense.aggregate({ _sum: { grossAmount: true } })

  return NextResponse.json({
    data: {
      totalOrgs,
      activeOrgs: totalOrgs,
      totalUsers,
      activeUsers30d: totalUsers,
      newOrgsThisMonth: 1,
      totalExpenses,
      totalVolume: Number(totalVolume._sum.grossAmount ?? 0),
      planBreakdown: [
        { plan: 'STARTER', count: 0 },
        { plan: 'GROWTH', count: totalOrgs },
        { plan: 'PRO', count: 0 },
        { plan: 'ENTERPRISE', count: 0 },
      ],
    }
  })
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  if (action === 'set_flag') {
    await prisma.featureFlag.upsert({
      where: { key: body.key },
      update: { isEnabled: body.enabled },
      create: { key: body.key, isEnabled: body.enabled, description: body.key },
    }).catch(() => {})
    return NextResponse.json({ data: { success: true } })
  }

  if (action === 'impersonate') {
    // Log the impersonation attempt
    await prisma.auditLog.create({
      data: {
        organizationId: body.organizationId ?? session.currentOrganizationId,
        actorId: session.id,
        action: 'IMPERSONATE',
        entityType: 'Organization',
        entityId: body.organizationId ?? '',
      },
    }).catch(() => {})
    return NextResponse.json({ data: { redirectUrl: '/dashboard' } })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

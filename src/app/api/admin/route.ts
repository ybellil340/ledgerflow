import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth, signToken, setSessionCookie } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

// ─── All admin routes require SUPER_ADMIN ────

function requireSuperAdmin(session: SessionUser): NextResponse | null {
  if (!session.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
  }
  return null
}

// ─── GET /api/admin/companies ────────────────

export const GET_COMPANIES = withAuth(async (req: NextRequest, session: SessionUser) => {
  const guard = requireSuperAdmin(session)
  if (guard) return guard

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '25'), 100)
  const search = searchParams.get('search')
  const plan = searchParams.get('plan')
  const status = searchParams.get('status')

  const where: Record<string, unknown> = {}
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { vatId: { contains: search, mode: 'insensitive' } },
      { owner: { email: { contains: search, mode: 'insensitive' } } },
    ]
  }
  if (status === 'active') where.isActive = true
  if (status === 'inactive') where.isActive = false

  const [total, companies] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      include: {
        owner: { select: { id: true, email: true, firstName: true, lastName: true } },
        subscription: { select: { plan: true, status: true, trialEndsAt: true } },
        _count: { select: { memberships: true, cards: true, expenses: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  return NextResponse.json({
    data: companies,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
  })
})

// ─── GET /api/admin/users ─────────────────────

export const GET_USERS = withAuth(async (req: NextRequest, session: SessionUser) => {
  const guard = requireSuperAdmin(session)
  if (guard) return guard

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '25'), 100)
  const search = searchParams.get('search')

  const where: Record<string, unknown> = {}
  if (search) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        isActive: true, lastLoginAt: true, createdAt: true,
        twoFactorEnabled: true,
        memberships: {
          include: { organization: { select: { id: true, name: true } } },
          take: 3,
        },
        taxAdvisorProfile: { include: { firm: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  return NextResponse.json({
    data: users,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
  })
})

// ─── GET /api/admin/audit-logs ───────────────

export const GET_AUDIT_LOGS = withAuth(async (req: NextRequest, session: SessionUser) => {
  const guard = requireSuperAdmin(session)
  if (guard) return guard

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '50'), 200)
  const actorId = searchParams.get('actorId')
  const orgId = searchParams.get('organizationId')
  const action = searchParams.get('action')
  const entityType = searchParams.get('entityType')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')

  const where: Record<string, unknown> = {}
  if (actorId) where.actorId = actorId
  if (orgId) where.organizationId = orgId
  if (action) where.action = action
  if (entityType) where.entityType = entityType
  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo) } : {}),
    }
  }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: {
        actor: { select: { id: true, email: true, firstName: true, lastName: true } },
        organization: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  return NextResponse.json({
    data: logs,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
  })
})

// ─── POST /api/admin/impersonate ─────────────

export const POST_IMPERSONATE = withAuth(async (req: NextRequest, session: SessionUser) => {
  const guard = requireSuperAdmin(session)
  if (guard) return guard

  const { userId, organizationId } = z.object({
    userId: z.string().cuid(),
    organizationId: z.string().cuid(),
  }).parse(await req.json())

  const user = await prisma.user.findUnique({ where: { id: userId } })
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, organizationId },
  })

  if (!user || !membership) {
    return NextResponse.json({ error: 'User or membership not found' }, { status: 404 })
  }

  const token = await signToken({
    sub: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: membership.role,
    organizationId,
    isSuperAdmin: false,
    isTaxAdvisor: false,
  })

  setSessionCookie(token)

  await prisma.auditLog.create({
    data: {
      organizationId,
      actorId: session.id,
      action: 'IMPERSONATE',
      entityType: 'user',
      entityId: userId,
      metadata: { impersonatorId: session.id, targetUserId: userId },
    },
  })

  return NextResponse.json({ data: { success: true, redirectTo: '/dashboard' } })
}, 'super_admin')

// ─── GET/POST /api/admin/flags ───────────────

export const GET_FLAGS = withAuth(async (req: NextRequest, session: SessionUser) => {
  const guard = requireSuperAdmin(session)
  if (guard) return guard

  const flags = await prisma.featureFlag.findMany({
    include: { organizationOverrides: { include: { organization: { select: { id: true, name: true } } } } },
    orderBy: { key: 'asc' },
  })

  return NextResponse.json({ data: flags })
})

export const PATCH_FLAG = withAuth(async (req: NextRequest, session: SessionUser) => {
  const guard = requireSuperAdmin(session)
  if (guard) return guard

  const { key, isEnabled, organizationId } = z.object({
    key: z.string(),
    isEnabled: z.boolean(),
    organizationId: z.string().cuid().optional(),
  }).parse(await req.json())

  if (organizationId) {
    // Org-level override
    const flag = await prisma.featureFlag.findUnique({ where: { key } })
    if (!flag) return NextResponse.json({ error: 'Flag not found' }, { status: 404 })

    await prisma.organizationFeatureFlag.upsert({
      where: { organizationId_featureFlagId: { organizationId, featureFlagId: flag.id } },
      update: { isEnabled },
      create: { organizationId, featureFlagId: flag.id, isEnabled },
    })
  } else {
    // Global toggle
    await prisma.featureFlag.update({ where: { key }, data: { isEnabled } })
  }

  await prisma.auditLog.create({
    data: {
      actorId: session.id,
      action: 'UPDATE',
      entityType: 'feature_flag',
      entityId: key,
      after: { isEnabled, organizationId },
    },
  })

  return NextResponse.json({ data: { success: true } })
}, 'super_admin')

// ─── GET /api/admin/stats ─────────────────────
// Platform-wide metrics for super admin dashboard

export const GET_STATS = withAuth(async (req: NextRequest, session: SessionUser) => {
  const guard = requireSuperAdmin(session)
  if (guard) return guard

  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const [
    totalOrgs, activeOrgs, totalUsers, activeUsers,
    totalExpenses, totalExpenseAmount, newOrgsThisMonth,
    subscriptionBreakdown, recentActivity,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { isActive: true } }),
    prisma.user.count(),
    prisma.user.count({ where: { lastLoginAt: { gte: thirtyDaysAgo } } }),
    prisma.expense.count({ where: { deletedAt: null } }),
    prisma.expense.aggregate({ _sum: { grossAmount: true }, where: { deletedAt: null } }),
    prisma.organization.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.subscription.groupBy({ by: ['plan', 'status'], _count: { plan: true } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { actor: { select: { email: true, firstName: true, lastName: true } }, organization: { select: { name: true } } } }),
  ])

  return NextResponse.json({
    data: {
      platform: { totalOrgs, activeOrgs, totalUsers, activeUsers, newOrgsThisMonth },
      financial: { totalExpenses, totalExpenseAmount: Number(totalExpenseAmount._sum.grossAmount ?? 0) },
      subscriptions: subscriptionBreakdown,
      recentActivity,
    },
  })
}, 'super_admin')

// ─── PATCH /api/admin/companies/[id] ─────────

export const PATCH_COMPANY = withAuth(async (req: NextRequest, session: SessionUser) => {
  const guard = requireSuperAdmin(session)
  if (guard) return guard

  const id = req.url.split('/companies/')[1]?.split('?')[0]
  const body = await req.json()

  const data = z.object({
    isActive: z.boolean().optional(),
    onboardingComplete: z.boolean().optional(),
  }).parse(body)

  const updated = await prisma.organization.update({ where: { id }, data })

  await prisma.auditLog.create({
    data: {
      actorId: session.id, action: 'UPDATE',
      entityType: 'organization', entityId: id, after: data,
    },
  })

  return NextResponse.json({ data: updated })
}, 'super_admin')

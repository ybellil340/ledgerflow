import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

// ─── VALIDATION ──────────────────────────────────────

const CreateCardSchema = z.object({
  userId: z.string().cuid(),
  type: z.enum(['VIRTUAL', 'PHYSICAL']),
  purpose: z.string().min(1).max(200),
  limitAmount: z.number().positive(),
  limitPeriod: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'ONE_TIME']),
  allowedMerchantCategories: z.array(z.string()).default([]),
  blockedMerchantCategories: z.array(z.string()).default([]),
  allowedMerchants: z.array(z.string()).default([]),
  blockedMerchants: z.array(z.string()).default([]),
})

// ─── GET /api/cards ──────────────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const userId = searchParams.get('userId')
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '25'), 100)

  const where: Record<string, unknown> = { organizationId: session.currentOrganizationId }

  // Employees see only their own cards
  if (session.currentRole === 'EMPLOYEE') {
    where.userId = session.id
  } else if (userId) {
    where.userId = userId
  }

  if (status) where.status = status

  const [total, cards] = await Promise.all([
    prisma.card.count({ where }),
    prisma.card.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        limitRules: true,
        _count: { select: { transactions: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  // Attach current month spend for each card
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const spendData = await prisma.transaction.groupBy({
    by: ['cardId'],
    where: {
      cardId: { in: cards.map((c) => c.id) },
      transactionDate: { gte: monthStart },
      amount: { lt: 0 },
    },
    _sum: { amount: true },
  })

  const spendMap = Object.fromEntries(spendData.map((s) => [s.cardId, Math.abs(Number(s._sum.amount ?? 0))]))

  const enriched = cards.map((c) => ({
    ...c,
    currentMonthSpend: spendMap[c.id] ?? 0,
  }))

  return NextResponse.json({
    data: enriched,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
  })
})

// ─── POST /api/cards ─────────────────────────────────

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  if (!['manage:cards'].some((p) => session.permissions.includes(p as never)) && !session.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const data = CreateCardSchema.parse(body)

  // Verify target user is in same org
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: data.userId, organizationId: session.currentOrganizationId, status: 'ACTIVE' },
  })
  if (!membership) return NextResponse.json({ error: 'User not found in organization' }, { status: 404 })

  // Check subscription card limit
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: session.currentOrganizationId },
  })
  if (subscription) {
    const cardCount = await prisma.card.count({
      where: { organizationId: session.currentOrganizationId, status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] } },
    })
    if (cardCount >= subscription.maxCards) {
      return NextResponse.json({ error: `Card limit reached (${subscription.maxCards} cards on your plan)` }, { status: 429 })
    }
  }

  // Mock: get cardholder name
  const cardUser = await prisma.user.findUnique({ where: { id: data.userId } })
  if (!cardUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const card = await prisma.card.create({
    data: {
      organizationId: session.currentOrganizationId,
      userId: data.userId,
      type: data.type,
      status: data.type === 'VIRTUAL' ? 'ACTIVE' : 'REQUESTED', // Physical cards need fulfillment
      cardholderName: `${cardUser.firstName} ${cardUser.lastName}`,
      purpose: data.purpose,
      currency: 'EUR',
      // Mock card details (real issuer would return these)
      lastFour: data.type === 'VIRTUAL' ? String(Math.floor(1000 + Math.random() * 9000)) : undefined,
      issuedAt: data.type === 'VIRTUAL' ? new Date() : undefined,
      limitRules: {
        create: {
          period: data.limitPeriod,
          limitAmount: data.limitAmount,
          spentAmount: 0,
          allowedMerchantCategories: data.allowedMerchantCategories,
          blockedMerchantCategories: data.blockedMerchantCategories,
          allowedMerchants: data.allowedMerchants,
          blockedMerchants: data.blockedMerchants,
        },
      },
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } }, limitRules: true },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'CREATE',
      entityType: 'card',
      entityId: card.id,
      after: { type: card.type, userId: card.userId, limitAmount: data.limitAmount },
    },
  })

  // Notify cardholder
  await prisma.notification.create({
    data: {
      userId: data.userId,
      organizationId: session.currentOrganizationId,
      type: 'card_issued',
      title: data.type === 'VIRTUAL' ? 'Virtual card ready' : 'Physical card requested',
      message: data.type === 'VIRTUAL'
        ? `Your virtual card (${card.lastFour}) is ready to use`
        : 'Your physical card has been requested and will arrive in 5–7 business days',
      entityType: 'card',
      entityId: card.id,
    },
  })

  return NextResponse.json({ data: card }, { status: 201 })
}, 'manage:cards')

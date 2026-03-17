export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

type Params = { id: string }

// ─── GET /api/cards/[id] ─────────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
  const card = await prisma.card.findFirst({
    where: {
      id: params!.id,
      organizationId: session.currentOrganizationId,
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } },
      limitRules: true,
      transactions: {
        orderBy: { transactionDate: 'desc' },
        take: 20,
        include: { receipt: { select: { id: true, fileUrl: true } } },
      },
    },
  })

  if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

  // Employees can only view their own card
  if (session.currentRole === 'EMPLOYEE' && card.userId !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({ data: card })
})

// ─── PATCH /api/cards/[id] — update limits/restrictions ─

const UpdateCardSchema = z.object({
  limitAmount: z.number().positive().optional(),
  limitPeriod: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'ONE_TIME']).optional(),
  allowedMerchantCategories: z.array(z.string()).optional(),
  blockedMerchantCategories: z.array(z.string()).optional(),
  allowedMerchants: z.array(z.string()).optional(),
  blockedMerchants: z.array(z.string()).optional(),
})

export const PATCH = withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
  const card = await prisma.card.findFirst({
    where: { id: params!.id, organizationId: session.currentOrganizationId },
    include: { limitRules: true },
  })

  if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

  const body = await req.json()

  // Handle action-based operations
  if (body.action === 'freeze') return handleFreeze(card.id, session, true)
  if (body.action === 'unfreeze') return handleFreeze(card.id, session, false)
  if (body.action === 'cancel') return handleCancel(card.id, session)

  // Update limit rules
  const data = UpdateCardSchema.parse(body)
  const existingRule = card.limitRules[0]

  if (existingRule && (data.limitAmount !== undefined || data.limitPeriod !== undefined)) {
    await prisma.cardLimitRule.update({
      where: { id: existingRule.id },
      data: {
        limitAmount: data.limitAmount ?? existingRule.limitAmount,
        period: data.limitPeriod ?? existingRule.period,
        allowedMerchantCategories: data.allowedMerchantCategories ?? existingRule.allowedMerchantCategories,
        blockedMerchantCategories: data.blockedMerchantCategories ?? existingRule.blockedMerchantCategories,
        allowedMerchants: data.allowedMerchants ?? existingRule.allowedMerchants,
        blockedMerchants: data.blockedMerchants ?? existingRule.blockedMerchants,
      },
    })
  }

  const before = { limitAmount: existingRule?.limitAmount }
  const after = { limitAmount: data.limitAmount }

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'UPDATE',
      entityType: 'card',
      entityId: card.id,
      before,
      after,
    },
  })

  const updated = await prisma.card.findUnique({ where: { id: card.id }, include: { limitRules: true } })
  return NextResponse.json({ data: updated })
}, 'manage:cards')

// ─── FREEZE / UNFREEZE ───────────────────────────────

async function handleFreeze(cardId: string, session: SessionUser, freeze: boolean): Promise<NextResponse> {
  const card = await prisma.card.findUnique({ where: { id: cardId } })
  if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

  if (freeze && card.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Card is not active' }, { status: 400 })
  }
  if (!freeze && card.status !== 'FROZEN') {
    return NextResponse.json({ error: 'Card is not frozen' }, { status: 400 })
  }

  const updated = await prisma.card.update({
    where: { id: cardId },
    data: {
      status: freeze ? 'FROZEN' : 'ACTIVE',
      frozenAt: freeze ? new Date() : null,
    },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: freeze ? 'CARD_FREEZE' : 'CARD_UNFREEZE',
      entityType: 'card',
      entityId: cardId,
      before: { status: card.status },
      after: { status: updated.status },
    },
  })

  // Notify cardholder
  await prisma.notification.create({
    data: {
      userId: card.userId,
      organizationId: session.currentOrganizationId,
      type: freeze ? 'card_frozen' : 'card_unfrozen',
      title: freeze ? 'Card frozen' : 'Card unfrozen',
      message: freeze
        ? `Your card ending in ${card.lastFour} has been frozen`
        : `Your card ending in ${card.lastFour} has been unfrozen and is active`,
      entityType: 'card',
      entityId: cardId,
    },
  })

  return NextResponse.json({ data: updated })
}

async function handleCancel(cardId: string, session: SessionUser): Promise<NextResponse> {
  const card = await prisma.card.findUnique({ where: { id: cardId } })
  if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })
  if (card.status === 'CANCELLED') return NextResponse.json({ error: 'Card is already cancelled' }, { status: 400 })

  const updated = await prisma.card.update({
    where: { id: cardId },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'UPDATE',
      entityType: 'card',
      entityId: cardId,
      before: { status: card.status },
      after: { status: 'CANCELLED' },
    },
  })

  return NextResponse.json({ data: updated })
}

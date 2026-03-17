import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

// ─── GET /api/notifications ──────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)
  const unreadOnly = searchParams.get('unreadOnly') === 'true'
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '30'), 100)

  const where: Record<string, unknown> = { userId: session.id }
  if (unreadOnly) where.isRead = false

  const [total, items, unreadCount] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.notification.count({ where: { userId: session.id, isRead: false } }),
  ])

  return NextResponse.json({
    data: items,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage), unreadCount },
  })
})

// ─── PATCH /api/notifications ─────────────────
// Mark notifications as read (bulk or single)

const MarkReadSchema = z.object({
  ids: z.array(z.string().cuid()).optional(), // if omitted, mark all as read
  markAll: z.boolean().optional(),
})

export const PATCH = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const { ids, markAll } = MarkReadSchema.parse(body)

  const where: Record<string, unknown> = { userId: session.id }
  if (!markAll && ids?.length) where.id = { in: ids }

  await prisma.notification.updateMany({
    where,
    data: { isRead: true, readAt: new Date() },
  })

  const remaining = await prisma.notification.count({
    where: { userId: session.id, isRead: false },
  })

  return NextResponse.json({ data: { success: true, remainingUnread: remaining } })
})

// ─── DELETE /api/notifications ───────────────

export const DELETE = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (id) {
    await prisma.notification.deleteMany({ where: { id, userId: session.id } })
  } else {
    // Delete all read notifications older than 30 days
    await prisma.notification.deleteMany({
      where: {
        userId: session.id,
        isRead: true,
        createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    })
  }

  return NextResponse.json({ data: { success: true } })
})

// ─── Notification dispatcher (internal service) ─

export interface NotificationPayload {
  userId: string
  organizationId?: string
  type: string
  title: string
  message: string
  entityType?: string
  entityId?: string
  metadata?: Record<string, unknown>
}

export async function dispatch(payload: NotificationPayload): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: payload.userId,
      organizationId: payload.organizationId,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      entityType: payload.entityType,
      entityId: payload.entityId,
      metadata: payload.metadata,
      channel: 'IN_APP',
    },
  })
  // TODO: trigger email/SMS via email provider based on user preferences
}

export async function dispatchToRole(
  organizationId: string,
  role: string,
  payload: Omit<NotificationPayload, 'userId'>
): Promise<void> {
  const members = await prisma.organizationMembership.findMany({
    where: { organizationId, role: role as never, status: 'ACTIVE' },
    select: { userId: true },
  })
  await Promise.all(
    members.map((m) => dispatch({ ...payload, userId: m.userId, organizationId }))
  )
}

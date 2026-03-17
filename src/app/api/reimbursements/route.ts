export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import { getApprovalEngine } from '@/lib/services/approval-engine'
import type { SessionUser } from '@/types'

const CreateReimbursementSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  currency: z.string().length(3).default('EUR'),
  amount: z.number().positive(),
  vatAmount: z.number().min(0).optional(),
  paymentDate: z.string().datetime().optional(),
  bankAccount: z.string().max(34).optional(), // IBAN
})

// ─── GET /api/reimbursements ─────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '25'), 100)
  const status = searchParams.getAll('status')

  const where: Record<string, unknown> = {
    organizationId: session.currentOrganizationId,
  }

  if (session.currentRole === 'EMPLOYEE') where.userId = session.id
  if (status.length > 0) where.status = { in: status }

  const [total, items] = await Promise.all([
    prisma.reimbursement.count({ where }),
    prisma.reimbursement.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        attachments: { select: { id: true, fileUrl: true, fileName: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  return NextResponse.json({
    data: items,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
  })
})

// ─── POST /api/reimbursements ────────────────────────

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const data = CreateReimbursementSchema.parse(body)

  const reimbursement = await prisma.reimbursement.create({
    data: {
      organizationId: session.currentOrganizationId,
      userId: session.id,
      title: data.title,
      description: data.description,
      currency: data.currency,
      amount: data.amount,
      vatAmount: data.vatAmount,
      paymentDate: data.paymentDate ? new Date(data.paymentDate) : undefined,
      bankAccount: data.bankAccount, // TODO: encrypt
      status: 'DRAFT',
    },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'CREATE',
      entityType: 'reimbursement',
      entityId: reimbursement.id,
      after: { title: reimbursement.title, amount: Number(reimbursement.amount) },
    },
  })

  return NextResponse.json({ data: reimbursement }, { status: 201 })
})

// ─── PATCH /api/reimbursements/[id] — status actions ─

export async function handleReimbursementAction(
  id: string,
  action: 'submit' | 'approve' | 'reject' | 'mark_paid',
  session: SessionUser,
  payload?: { reason?: string; paidAmount?: number }
): Promise<NextResponse> {
  const item = await prisma.reimbursement.findFirst({
    where: { id, organizationId: session.currentOrganizationId },
  })
  if (!item) return NextResponse.json({ error: 'Reimbursement not found' }, { status: 404 })

  let newStatus: string
  let auditAction: 'UPDATE' | 'APPROVE' | 'REJECT' = 'UPDATE'

  switch (action) {
    case 'submit':
      if (item.userId !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      if (item.status !== 'DRAFT') return NextResponse.json({ error: 'Already submitted' }, { status: 400 })
      newStatus = 'SUBMITTED'
      // Trigger approval
      const engine = await getApprovalEngine()
      await engine.initiate({
        entityType: 'reimbursement', entityId: id,
        organizationId: session.currentOrganizationId,
        amount: Number(item.amount), userId: session.id,
      })
      break

    case 'approve':
      if (!['COMPANY_ADMIN', 'FINANCE_MANAGER', 'APPROVER', 'SUPER_ADMIN'].includes(session.currentRole)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      newStatus = 'APPROVED'
      auditAction = 'APPROVE'
      break

    case 'reject':
      if (!['COMPANY_ADMIN', 'FINANCE_MANAGER', 'APPROVER', 'SUPER_ADMIN'].includes(session.currentRole)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      newStatus = 'REJECTED'
      auditAction = 'REJECT'
      if (payload?.reason) {
        await prisma.comment.create({
          data: {
            authorId: session.id, content: payload.reason,
            entityType: 'reimbursement', entityId: id,
            reimbursementId: id, visibility: 'INTERNAL',
          },
        })
      }
      break

    case 'mark_paid':
      if (!['COMPANY_ADMIN', 'FINANCE_MANAGER', 'SUPER_ADMIN'].includes(session.currentRole)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      newStatus = 'PAID'
      break

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const updated = await prisma.reimbursement.update({
    where: { id },
    data: {
      status: newStatus as never,
      ...(action === 'mark_paid' ? { paidAt: new Date(), paidById: session.id } : {}),
    },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: auditAction,
      entityType: 'reimbursement',
      entityId: id,
      before: { status: item.status },
      after: { status: newStatus },
    },
  })

  // Notify user
  if (['approve', 'reject', 'mark_paid'].includes(action)) {
    const messages: Record<string, string> = {
      approve: `Your reimbursement "${item.title}" was approved`,
      reject: `Your reimbursement "${item.title}" was rejected${payload?.reason ? `: ${payload.reason}` : ''}`,
      mark_paid: `Your reimbursement "${item.title}" of €${Number(item.amount).toFixed(2)} has been paid`,
    }
    await prisma.notification.create({
      data: {
        userId: item.userId,
        organizationId: session.currentOrganizationId,
        type: `reimbursement_${action}`,
        title: messages[action].split(' ').slice(0, 3).join(' '),
        message: messages[action],
        entityType: 'reimbursement',
        entityId: id,
      },
    })
  }

  return NextResponse.json({ data: updated })
}

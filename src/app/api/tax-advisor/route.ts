export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db/prisma'
import { getSessionFromRequest } from '@/lib/auth/session'

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const orgId = searchParams.get('orgId') ?? session.currentOrganizationId

  // Portfolio view for tax advisor
  if (!type || type === 'portfolio') {
    const links = await prisma.taxAdvisorClientLink.findMany({
      where: { firm: { profiles: { some: { userId: session.id } } } },
      include: {
        organization: {
          include: {
            expenses: { where: { status: 'SUBMITTED' }, select: { id: true } },
            _count: { select: { expenses: true } },
          },
        },
      },
    })

    const clients = links.map(link => ({
      id: link.organization.id,
      name: link.organization.name,
      city: link.organization.city ?? '',
      legalForm: link.organization.legalForm ?? 'GmbH',
      industry: link.organization.industry ?? '',
      plan: 'GROWTH',
      isTrialing: false,
      healthScore: 78,
      issues: [{ type: 'missing', count: 0, label: 'No issues', severity: 'low' as const }],
      lastExportDate: undefined,
      pendingReview: link.organization.expenses.length,
      openComments: 0,
      isLocked: false,
    }))

    return NextResponse.json({
      data: {
        clients,
        totalMissingDocs: 0,
        vatAnomalies: 0,
        criticalClients: 0,
      }
    })
  }

  if (type === 'review') {
    const expenses = await prisma.expense.findMany({
      where: { organizationId: orgId, status: { in: ['SUBMITTED', 'PENDING_APPROVAL'] } },
      select: { id: true, merchant: true, grossAmount: true, expenseDate: true, status: true },
      take: 20,
    })
    const data = expenses.map(e => ({
      id: e.id,
      type: 'expense' as const,
      description: e.merchant,
      amount: Number(e.grossAmount),
      date: e.expenseDate.toISOString().slice(0, 10),
      status: e.status,
    }))
    return NextResponse.json({ data })
  }

  if (type === 'comments') {
    const comments = await prisma.comment.findMany({
      where: { entityId: orgId, entityType: 'organization' },
      include: { author: { select: { firstName: true, lastName: true, memberships: { select: { role: true }, take: 1 } } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    const data = comments.map(c => ({
      id: c.id,
      author: `${c.author.firstName} ${c.author.lastName}`.trim(),
      authorRole: c.author.memberships[0]?.role ?? 'EMPLOYEE',
      text: c.content,
      createdAt: c.createdAt.toISOString(),
      isRead: true,
    }))
    return NextResponse.json({ data })
  }

  return NextResponse.json({ data: [] })
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action, organizationId, text } = body

  if (action === 'comment') {
    const comment = await prisma.comment.create({
      data: {
        authorId: session.id,
        content: text ?? body.content ?? '',
        entityType: 'organization',
        entityId: organizationId ?? session.currentOrganizationId,
        visibility: 'EXTERNAL',
      },
    })
    return NextResponse.json({ data: comment })
  }

  return NextResponse.json({ data: { success: true } })
}

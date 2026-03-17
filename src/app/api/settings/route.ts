export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db/prisma'
import { getSessionFromRequest } from '@/lib/auth/session'

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'members'
  const orgId = session.currentOrganizationId

  if (type === 'members') {
    const members = await prisma.organizationMembership.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, lastLoginAt: true, createdAt: true } } },
      orderBy: { joinedAt: 'asc' },
    })
    const data = members.map(m => ({
      id: m.id,
      name: `${m.user.firstName} ${m.user.lastName}`.trim(),
      email: m.user.email,
      role: m.role,
      department: m.departmentId,
      lastActiveAt: m.user.lastLoginAt ? new Date(m.user.lastLoginAt).toLocaleDateString('de-DE') : undefined,
      createdAt: m.joinedAt.toISOString(),
      hasTwoFactor: false,
      isActive: m.status === 'ACTIVE',
      avatarInitials: `${m.user.firstName?.[0] ?? ''}${m.user.lastName?.[0] ?? ''}`.toUpperCase(),
      avatarColor: '#185FA5',
    }))
    return NextResponse.json({ data })
  }

  if (type === 'invitations') {
    const invitations = await prisma.invitation.findMany({
      where: { organizationId: orgId, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ data: invitations })
  }

  if (type === 'departments') {
    const departments = await prisma.department.findMany({
      where: { organizationId: orgId },
      include: { _count: { select: { memberships: true } } },
    })
    const data = departments.map(d => ({
      id: d.id,
      name: d.name,
      code: d.code,
      memberCount: d._count.memberships,
      monthlyBudget: d.budgetMonthly ? Number(d.budgetMonthly) : undefined,
    }))
    return NextResponse.json({ data })
  }

  return NextResponse.json({ data: [] })
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body
  const orgId = session.currentOrganizationId

  if (action === 'invite' || body.email) {
    const { email, role, departmentId } = body
    // Create a pending invitation
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: orgId,
        email: email.toLowerCase().trim(),
        role: role ?? 'EMPLOYEE',
        departmentId: departmentId ?? null,
        invitedById: session.id,
        token: Math.random().toString(36).slice(2) + Date.now().toString(36),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
    return NextResponse.json({ data: invitation }, { status: 201 })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

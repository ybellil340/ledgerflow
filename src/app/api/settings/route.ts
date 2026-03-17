import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

// ─── GET /api/settings/team ──────────────────
// Returns members + pending invitations

export const GET_TEAM = withAuth(async (req: NextRequest, session: SessionUser) => {
  const [members, invitations] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { organizationId: session.currentOrganizationId },
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true, email: true,
            avatarUrl: true, lastLoginAt: true, twoFactorEnabled: true,
          },
        },
        department: { select: { id: true, name: true } },
      },
      orderBy: { joinedAt: 'desc' },
    }),
    prisma.invitation.findMany({
      where: { organizationId: session.currentOrganizationId },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return NextResponse.json({ data: { members, invitations } })
})

// ─── PATCH /api/settings/team/[memberId] ────
// Update role or remove member

export const PATCH_MEMBER = withAuth(async (req: NextRequest, session: SessionUser) => {
  const memberId = req.url.split('/team/')[1]?.split('?')[0]
  if (!memberId) return NextResponse.json({ error: 'Member ID required' }, { status: 400 })

  const body = await req.json()
  const { role, status, departmentId } = z.object({
    role: z.enum(['COMPANY_ADMIN', 'FINANCE_MANAGER', 'EMPLOYEE', 'APPROVER']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']).optional(),
    departmentId: z.string().cuid().optional().nullable(),
  }).parse(body)

  const membership = await prisma.organizationMembership.findFirst({
    where: { id: memberId, organizationId: session.currentOrganizationId },
  })
  if (!membership) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const before = { role: membership.role, status: membership.status }

  const updated = await prisma.organizationMembership.update({
    where: { id: memberId },
    data: {
      ...(role ? { role: role as never } : {}),
      ...(status ? { status: status as never } : {}),
      ...(departmentId !== undefined ? { departmentId } : {}),
    },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId, actorId: session.id,
      action: 'ROLE_CHANGE', entityType: 'membership', entityId: memberId,
      before, after: { role, status },
    },
  })

  return NextResponse.json({ data: updated })
}, 'manage:users')

// ─── GET /api/settings/departments ───────────

export const GET_DEPARTMENTS = withAuth(async (req: NextRequest, session: SessionUser) => {
  const departments = await prisma.department.findMany({
    where: { organizationId: session.currentOrganizationId, isActive: true },
    include: { _count: { select: { memberships: true } } },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ data: departments })
})

// ─── POST /api/settings/departments ──────────

export const POST_DEPARTMENT = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const data = z.object({
    name: z.string().min(1).max(100),
    code: z.string().max(20).optional(),
    budgetMonthly: z.number().positive().optional(),
    parentId: z.string().cuid().optional(),
  }).parse(body)

  const dept = await prisma.department.create({
    data: { ...data, organizationId: session.currentOrganizationId },
  })

  return NextResponse.json({ data: dept }, { status: 201 })
}, 'manage:organization')

// ─── GET /api/settings/integrations ──────────

export const GET_INTEGRATIONS = withAuth(async (req: NextRequest, session: SessionUser) => {
  const connections = await prisma.integrationConnection.findMany({
    where: { organizationId: session.currentOrganizationId },
    orderBy: { provider: 'asc' },
  })

  // Available integrations catalog
  const catalog = [
    { provider: 'datev_export', name: 'DATEV Export', description: 'Generate DATEV Buchungsstapel CSV files', category: 'accounting', status: 'available', icon: '📊' },
    { provider: 'lexoffice', name: 'Lexoffice', description: 'Sync invoices and expenses with Lexoffice', category: 'accounting', status: 'coming_soon', icon: '📋' },
    { provider: 'sevdesk', name: 'sevDesk', description: 'Automatic bookkeeping sync with sevDesk', category: 'accounting', status: 'coming_soon', icon: '📚' },
    { provider: 'stripe', name: 'Stripe', description: 'Sync payments and invoices from Stripe', category: 'payments', status: 'coming_soon', icon: '💳' },
    { provider: 'tink', name: 'Tink (Open Banking)', description: 'Real-time bank account sync via Tink PSD2', category: 'banking', status: 'coming_soon', icon: '🏦' },
    { provider: 'plaid', name: 'Plaid', description: 'Connect bank accounts and sync transactions', category: 'banking', status: 'coming_soon', icon: '🔗' },
    { provider: 'mindee', name: 'Mindee OCR', description: 'AI-powered receipt and invoice data extraction', category: 'ocr', status: 'coming_soon', icon: '🔍' },
    { provider: 'slack', name: 'Slack', description: 'Approval notifications and expense alerts in Slack', category: 'notifications', status: 'coming_soon', icon: '💬' },
  ]

  const enriched = catalog.map((item) => {
    const connection = connections.find((c) => c.provider === item.provider)
    return { ...item, connection: connection ?? null, isConnected: !!connection?.isActive }
  })

  return NextResponse.json({ data: { catalog: enriched, connections } })
})

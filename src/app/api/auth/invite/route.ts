import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/db/prisma'
import { withAuth, signToken, setSessionCookie } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

// ─── POST /api/auth/invite — send invitation ─────────

const SendInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['COMPANY_ADMIN', 'FINANCE_MANAGER', 'EMPLOYEE', 'APPROVER']),
  departmentId: z.string().cuid().optional(),
})

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()

  // Handle accept-invite (token in body)
  if (body.token) {
    return handleAcceptInvite(body)
  }

  // Handle send-invite
  const { email, role, departmentId } = SendInviteSchema.parse(body)

  if (!['manage:users'].some((p) => session.permissions.includes(p as never))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Check if user already a member
  const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (existingUser) {
    const existingMembership = await prisma.organizationMembership.findFirst({
      where: { userId: existingUser.id, organizationId: session.currentOrganizationId },
    })
    if (existingMembership) {
      return NextResponse.json({ error: 'User is already a member of this organization' }, { status: 409 })
    }
  }

  // Create or update invitation
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  const invitation = await prisma.invitation.create({
    data: {
      organizationId: session.currentOrganizationId,
      email: email.toLowerCase(),
      role,
      invitedById: session.id,
      expiresAt,
    },
    include: { organization: { select: { name: true } } },
  })

  // TODO: Send email via notification service
  // await sendInvitationEmail({ to: email, token: invitation.token, organizationName: invitation.organization.name, role })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'CREATE',
      entityType: 'invitation',
      entityId: invitation.id,
      after: { email, role },
    },
  })

  return NextResponse.json({
    data: {
      id: invitation.id,
      email,
      role,
      expiresAt,
      inviteUrl: `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite?token=${invitation.token}`,
    },
  }, { status: 201 })
})

// ─── ACCEPT INVITE ──────────────────────────────────

const AcceptInviteSchema = z.object({
  token: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  password: z.string().min(8),
})

async function handleAcceptInvite(body: unknown): Promise<NextResponse> {
  const { token, firstName, lastName, password } = AcceptInviteSchema.parse(body)

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { organization: true },
  })

  if (!invitation) return NextResponse.json({ error: 'Invalid invitation token' }, { status: 400 })
  if (invitation.acceptedAt) return NextResponse.json({ error: 'Invitation already accepted' }, { status: 400 })
  if (invitation.expiresAt < new Date()) return NextResponse.json({ error: 'Invitation has expired' }, { status: 400 })

  const passwordHash = await bcrypt.hash(password, 12)

  const result = await prisma.$transaction(async (tx) => {
    // Upsert user
    let user = await tx.user.findUnique({ where: { email: invitation.email } })
    if (!user) {
      user = await tx.user.create({
        data: { email: invitation.email, passwordHash, firstName, lastName, isActive: true },
      })
    }

    // Create membership
    await tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: invitation.organizationId, userId: user.id } },
      update: { role: invitation.role, status: 'ACTIVE' },
      create: { organizationId: invitation.organizationId, userId: user.id, role: invitation.role, status: 'ACTIVE' },
    })

    // Mark invitation accepted
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } })

    return user
  })

  const sessionToken = await signToken({
    sub: result.id,
    email: result.email,
    firstName: result.firstName,
    lastName: result.lastName,
    role: invitation.role,
    organizationId: invitation.organizationId,
    isSuperAdmin: false,
    isTaxAdvisor: false,
  })

  setSessionCookie(sessionToken)

  return NextResponse.json({
    data: {
      user: { id: result.id, email: result.email, firstName: result.firstName },
      organization: { id: invitation.organization.id, name: invitation.organization.name },
    },
  })
}

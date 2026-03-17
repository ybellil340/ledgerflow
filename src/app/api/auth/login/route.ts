import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/db/prisma'
import { signToken, setSessionCookie } from '@/lib/auth/session'
import { getPermissionsForRole } from '@/lib/auth/rbac'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  organizationId: z.string().cuid().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password, organizationId } = LoginSchema.parse(body)

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: { organization: { select: { id: true, name: true, isActive: true } } },
          orderBy: { joinedAt: 'desc' },
        },
        taxAdvisorProfile: { include: { firm: true } },
      },
    })

    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Verify password
    if (!user.passwordHash) {
      return NextResponse.json({ error: 'Password login not available for this account. Use magic link.' }, { status: 401 })
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash)
    if (!passwordValid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Determine which organization to log into
    const activeOrgId = organizationId ?? user.memberships[0]?.organization.id
    if (!activeOrgId && !user.taxAdvisorProfile) {
      return NextResponse.json({ error: 'No organization access found' }, { status: 403 })
    }

    const membership = user.memberships.find((m) => m.organizationId === activeOrgId)
    const isSuperAdmin = user.memberships.some((m) => m.role === 'SUPER_ADMIN')
    const isTaxAdvisor = !!user.taxAdvisorProfile

    // Build token
    const token = await signToken({
      sub: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: membership?.role ?? (isTaxAdvisor ? 'TAX_ADVISOR' : 'EMPLOYEE'),
      organizationId: activeOrgId ?? '',
      isSuperAdmin,
      isTaxAdvisor,
      taxAdvisorFirmId: user.taxAdvisorProfile?.firmId,
    })

    // Set cookie
    setSessionCookie(token)

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: req.headers.get('x-forwarded-for') ?? undefined },
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        organizationId: activeOrgId,
        actorId: user.id,
        action: 'LOGIN',
        entityType: 'user',
        entityId: user.id,
        ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
        userAgent: req.headers.get('user-agent') ?? undefined,
      },
    })

    return NextResponse.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          currentOrganizationId: activeOrgId,
          currentRole: membership?.role,
          isSuperAdmin,
          isTaxAdvisor,
          organizations: user.memberships.map((m) => ({
            id: m.organization.id,
            name: m.organization.name,
            role: m.role,
          })),
        },
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: err.errors }, { status: 400 })
    }
    console.error('[POST /api/auth/login]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/db/prisma'
import { signToken } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  organizationId: z.string().optional(),
})

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'ledgerflow_session'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password, organizationId } = LoginSchema.parse(body)

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: { organization: { select: { id: true, name: true, isActive: true } } },
          orderBy: { joinedAt: 'desc' },
        },
      },
    })

    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    if (!user.passwordHash) {
      return NextResponse.json({ error: 'Password login not available for this account' }, { status: 401 })
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash)
    if (!passwordValid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    const activeOrgId = organizationId ?? user.memberships[0]?.organization.id
    if (!activeOrgId) {
      return NextResponse.json({ error: 'No organization access found' }, { status: 403 })
    }

    const membership = user.memberships.find((m) => m.organizationId === activeOrgId)
    const isSuperAdmin = user.memberships.some((m) => m.role === 'SUPER_ADMIN')

    const token = await signToken({
      sub: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: membership?.role ?? 'EMPLOYEE',
      organizationId: activeOrgId,
      isSuperAdmin,
      isTaxAdvisor: false,
    })

    // Update last login (fire and forget)
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }).catch(() => {})

    const response = NextResponse.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          currentOrganizationId: activeOrgId,
          currentRole: membership?.role,
          isSuperAdmin,
          organizations: user.memberships.map((m) => ({
            id: m.organization.id,
            name: m.organization.name,
            role: m.role,
          })),
        },
      },
    })

    // Set cookie via response header (works in all Next.js 14 contexts)
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })

    return response
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: err.errors }, { status: 400 })
    }
    console.error('[POST /api/auth/login]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

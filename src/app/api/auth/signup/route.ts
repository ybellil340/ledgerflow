export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/db/prisma'
import { signToken } from '@/lib/auth/session'

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  organizationName: z.string().min(1).max(200),
  legalForm: z.string().optional(),
  country: z.string().length(2).default('DE'),
  vatId: z.string().optional(),
  industry: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = SignupSchema.parse(body)

    // Check email not taken
    const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(data.password, 12)

    // Create user + organization in transaction
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email.toLowerCase().trim(),
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          isActive: true,
        },
      })

      const org = await tx.organization.create({
        data: {
          name: data.organizationName,
          legalName: data.organizationName,
          legalForm: data.legalForm,
          country: data.country,
          vatId: data.vatId,
          industry: data.industry,
          ownerId: user.id,
          onboardingComplete: false,
          onboardingStep: 1,
        },
      })

      await tx.organizationMembership.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          role: 'COMPANY_ADMIN',
          status: 'ACTIVE',
        },
      })

      // Seed default VAT codes
      const vatCodes = [
        { code: 'VSt19', description: 'Vorsteuer 19%', rate: 19, datevCode: '9', isDeductible: true },
        { code: 'VSt7', description: 'Vorsteuer 7%', rate: 7, datevCode: '8', isDeductible: true },
        { code: 'VSt0', description: 'Steuerfrei', rate: 0, datevCode: '', isDeductible: false },
        { code: 'USt19', description: 'Umsatzsteuer 19%', rate: 19, datevCode: '3', isDeductible: false },
        { code: 'USt7', description: 'Umsatzsteuer 7%', rate: 7, datevCode: '2', isDeductible: false },
      ]
      await tx.vATCode.createMany({ data: vatCodes.map((v) => ({ ...v, organizationId: org.id })) })

      // Default subscription (trial)
      await tx.subscription.create({
        data: {
          organizationId: org.id,
          plan: 'STARTER',
          status: 'TRIALING',
          maxUsers: 5,
          maxCards: 10,
          maxMonthlyExpenses: 100,
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId: user.id,
          action: 'CREATE',
          entityType: 'organization',
          entityId: org.id,
        },
      })

      return { user, org }
    })

    const token = await signToken({
      sub: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      role: 'COMPANY_ADMIN',
      organizationId: result.org.id,
      isSuperAdmin: false,
      isTaxAdvisor: false,
    })

    const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'ledgerflow_session'
    const response = NextResponse.json({
      data: {
        user: { id: result.user.id, email: result.user.email, firstName: result.user.firstName },
        organization: { id: result.org.id, name: result.org.name },
      },
    }, { status: 201 })
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
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 400 })
    }
    console.error('[POST /api/auth/signup]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

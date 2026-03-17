export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db/prisma'
import bcrypt from 'bcryptjs'

const SEED_SECRET = process.env.SEED_SECRET ?? 'seed-ledgerflow-demo'

export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get('secret')
  if (secret !== SEED_SECRET) {
    return NextResponse.json({ error: 'Add ?secret=seed-ledgerflow-demo to the URL' }, { status: 401 })
  }

  const existing = await prisma.user.findFirst({ where: { email: 'katrin.mueller@mueller-consulting.de' } })
  if (existing) {
    return NextResponse.json({ message: 'Already seeded — go to /auth/login', email: existing.email })
  }

  try {
    const hash = await bcrypt.hash('demo123', 10)

    // Create owner user first (needed for org.ownerId)
    const katrin = await prisma.user.create({
      data: { email: 'katrin.mueller@mueller-consulting.de', firstName: 'Katrin', lastName: 'Müller', passwordHash: hash, isActive: true },
    })

    const org = await prisma.organization.create({
      data: {
        name: 'Müller Consulting GmbH',
        legalName: 'Müller Consulting GmbH',
        legalForm: 'GmbH',
        industry: 'Management Consulting',
        city: 'München',
        country: 'DE',
        vatId: 'DE123456789',
        ownerId: katrin.id,
        isActive: true,
        onboardingComplete: true,
      },
    })

    // Create subscription
    await prisma.subscription.create({
      data: {
        organizationId: org.id,
        plan: 'GROWTH',
        status: 'ACTIVE',
        
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    // Add katrin membership
    await prisma.organizationMembership.create({
      data: { userId: katrin.id, organizationId: org.id, role: 'COMPANY_ADMIN', status: 'ACTIVE', joinedAt: new Date() },
    })

    // Create other users
    const thomas = await prisma.user.create({
      data: { email: 'thomas.huber@mueller-consulting.de', firstName: 'Thomas', lastName: 'Huber', passwordHash: hash, isActive: true },
    })
    const sara = await prisma.user.create({
      data: { email: 'sara.mayer@mueller-consulting.de', firstName: 'Sara', lastName: 'Mayer', passwordHash: hash, isActive: true },
    })
    const anna = await prisma.user.create({
      data: { email: 'anna.becker@mueller-consulting.de', firstName: 'Anna', lastName: 'Becker', passwordHash: hash, isActive: true },
    })
    const weber = await prisma.user.create({
      data: { email: 'weber@weber-partner.de', firstName: 'Klaus', lastName: 'Weber', passwordHash: hash, isActive: true },
    })

    await prisma.organizationMembership.createMany({
      data: [
        { userId: thomas.id, organizationId: org.id, role: 'EMPLOYEE',        status: 'ACTIVE', joinedAt: new Date() },
        { userId: sara.id,   organizationId: org.id, role: 'FINANCE_MANAGER', status: 'ACTIVE', joinedAt: new Date() },
        { userId: anna.id,   organizationId: org.id, role: 'EMPLOYEE',        status: 'ACTIVE', joinedAt: new Date() },
      ],
    })

    // Tax advisor
    const firm = await prisma.taxAdvisorFirm.create({
      data: { name: 'Weber & Partner', city: 'München' },
    })
    await prisma.taxAdvisorProfile.create({
      data: { userId: weber.id, firmId: firm.id, licenseNumber: 'STB-2024-001', isActive: true },
    })
    await prisma.taxAdvisorClientLink.create({
      data: { firmId: firm.id, organizationId: org.id, status: 'ACTIVE' },
    })

    // Sample expenses
    await prisma.expense.createMany({
      data: [
        { organizationId: org.id, userId: thomas.id, merchant: 'Lufthansa',        expenseDate: new Date('2025-03-14'), currency: 'EUR', grossAmount: 842,  vatRate: 19, vatAmount: 134.42, netAmount: 707.58, status: 'APPROVED',          notes: 'Business travel Frankfurt' },
        { organizationId: org.id, userId: thomas.id, merchant: 'Marriott Berlin',  expenseDate: new Date('2025-03-07'), currency: 'EUR', grossAmount: 420,  vatRate: 7,  vatAmount: 27.57,  netAmount: 392.43, status: 'PENDING_APPROVAL',   notes: 'Hotel for client meeting' },
        { organizationId: org.id, userId: anna.id,   merchant: 'Conrad Electronics',expenseDate: new Date('2025-03-10'), currency: 'EUR', grossAmount: 249,  vatRate: 19, vatAmount: 39.75,  netAmount: 209.25, status: 'SUBMITTED',          notes: 'Office headphones' },
        { organizationId: org.id, userId: sara.id,   merchant: 'AWS Frankfurt',    expenseDate: new Date('2025-03-13'), currency: 'EUR', grossAmount: 1240, vatRate: 0,  vatAmount: 0,      netAmount: 1240,   status: 'PENDING_APPROVAL',   notes: 'Cloud infrastructure' },
      ],
    })

    return NextResponse.json({
      success: true,
      message: '✅ Seeded! Go to /auth/login',
      logins: [
        { email: 'katrin.mueller@mueller-consulting.de', password: 'demo123', role: 'Company Admin' },
        { email: 'thomas.huber@mueller-consulting.de',   password: 'demo123', role: 'Employee' },
        { email: 'sara.mayer@mueller-consulting.de',     password: 'demo123', role: 'Finance Manager' },
        { email: 'anna.becker@mueller-consulting.de',    password: 'demo123', role: 'Employee' },
        { email: 'weber@weber-partner.de',               password: 'demo123', role: 'Tax Advisor' },
      ],
    })
  } catch (err: any) {
    console.error('[Seed]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

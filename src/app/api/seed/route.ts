export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db/prisma'
import bcrypt from 'bcryptjs'

// Simple secret check so random people can't reseed your DB
const SEED_SECRET = process.env.SEED_SECRET ?? 'seed-ledgerflow-demo'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')

  if (secret !== SEED_SECRET) {
    return NextResponse.json({ error: 'Invalid secret. Add ?secret=YOUR_SEED_SECRET to the URL' }, { status: 401 })
  }

  // Check if already seeded
  const existing = await prisma.organization.findFirst()
  if (existing) {
    return NextResponse.json({ message: 'Already seeded', org: existing.name })
  }

  try {
    const passwordHash = await bcrypt.hash('demo123', 10)

    // ── Create organization ────────────────────────────────────────────────────
    const org = await prisma.organization.create({
      data: {
        name: 'Müller Consulting GmbH',
        legalForm: 'GmbH',
        industry: 'Management Consulting',
        city: 'München',
        country: 'DE',
        vatId: 'DE123456789',
        plan: 'GROWTH',
        isActive: true,
        trialEndsAt: null,
      },
    })

    // ── Create users ───────────────────────────────────────────────────────────
    const katrin = await prisma.user.create({
      data: {
        email: 'katrin.mueller@mueller-consulting.de',
        firstName: 'Katrin',
        lastName: 'Müller',
        passwordHash,
        isActive: true,
      },
    })

    const thomas = await prisma.user.create({
      data: {
        email: 'thomas.huber@mueller-consulting.de',
        firstName: 'Thomas',
        lastName: 'Huber',
        passwordHash,
        isActive: true,
      },
    })

    const sara = await prisma.user.create({
      data: {
        email: 'sara.mayer@mueller-consulting.de',
        firstName: 'Sara',
        lastName: 'Mayer',
        passwordHash,
        isActive: true,
      },
    })

    const weber = await prisma.user.create({
      data: {
        email: 'weber@weber-partner.de',
        firstName: 'Klaus',
        lastName: 'Weber',
        passwordHash,
        isActive: true,
      },
    })

    const anna = await prisma.user.create({
      data: {
        email: 'anna.becker@mueller-consulting.de',
        firstName: 'Anna',
        lastName: 'Becker',
        passwordHash,
        isActive: true,
      },
    })

    // ── Create memberships ─────────────────────────────────────────────────────
    await prisma.membership.createMany({
      data: [
        { userId: katrin.id, organizationId: org.id, role: 'COMPANY_ADMIN',    status: 'ACTIVE', joinedAt: new Date() },
        { userId: thomas.id, organizationId: org.id, role: 'EMPLOYEE',         status: 'ACTIVE', joinedAt: new Date() },
        { userId: sara.id,   organizationId: org.id, role: 'FINANCE_MANAGER',  status: 'ACTIVE', joinedAt: new Date() },
        { userId: anna.id,   organizationId: org.id, role: 'EMPLOYEE',         status: 'ACTIVE', joinedAt: new Date() },
      ],
    })

    // ── Create tax advisor ─────────────────────────────────────────────────────
    const firm = await prisma.taxAdvisorFirm.create({
      data: {
        name: 'Weber & Partner',
        city: 'München',
      },
    })

    await prisma.taxAdvisorProfile.create({
      data: {
        userId: weber.id,
        firmId: firm.id,
        licenseNumber: 'STB-2024-001',
        isActive: true,
      },
    })

    await prisma.taxAdvisorClient.create({
      data: {
        taxAdvisorFirmId: firm.id,
        organizationId: org.id,
        status: 'ACTIVE',
      },
    })

    // ── Create a department ────────────────────────────────────────────────────
    const dept = await prisma.department.create({
      data: {
        organizationId: org.id,
        name: 'Sales',
        code: 'SBD',
      },
    })

    // ── Create some expenses ───────────────────────────────────────────────────
    await prisma.expense.createMany({
      data: [
        {
          organizationId: org.id,
          userId: thomas.id,
          merchant: 'Lufthansa',
          expenseDate: new Date('2025-03-14'),
          currency: 'EUR',
          grossAmount: 842,
          vatRate: 19,
          vatAmount: 134.42,
          netAmount: 707.58,
          status: 'APPROVED',
          notes: 'Business travel Frankfurt',
        },
        {
          organizationId: org.id,
          userId: thomas.id,
          merchant: 'Marriott Berlin',
          expenseDate: new Date('2025-03-07'),
          currency: 'EUR',
          grossAmount: 420,
          vatRate: 7,
          vatAmount: 27.57,
          netAmount: 392.43,
          status: 'PENDING_APPROVAL',
          notes: 'Hotel for client meeting',
        },
        {
          organizationId: org.id,
          userId: anna.id,
          merchant: 'Conrad Electronics',
          expenseDate: new Date('2025-03-10'),
          currency: 'EUR',
          grossAmount: 249,
          vatRate: 19,
          vatAmount: 39.75,
          netAmount: 209.25,
          status: 'SUBMITTED',
          notes: 'Office headphones',
        },
        {
          organizationId: org.id,
          userId: sara.id,
          merchant: 'AWS Frankfurt',
          expenseDate: new Date('2025-03-13'),
          currency: 'EUR',
          grossAmount: 1240,
          vatRate: 0,
          vatAmount: 0,
          netAmount: 1240,
          status: 'PENDING_APPROVAL',
          notes: 'Cloud infrastructure March',
        },
      ],
    })

    // ── Create a supplier ──────────────────────────────────────────────────────
    await prisma.supplier.create({
      data: {
        organizationId: org.id,
        name: 'KPMG Germany',
        vatId: 'DE987654321',
        email: 'invoice@kpmg.de',
        city: 'Frankfurt',
        paymentTermsDays: 14,
      },
    })

    // ── Create a customer ──────────────────────────────────────────────────────
    await prisma.customer.create({
      data: {
        organizationId: org.id,
        name: 'Techcorp Berlin GmbH',
        vatId: 'DE111222333',
        email: 'ap@techcorp-berlin.de',
        city: 'Berlin',
        paymentTermsDays: 30,
      },
    })

    return NextResponse.json({
      success: true,
      message: '✅ Database seeded successfully!',
      data: {
        organization: org.name,
        users: [
          { email: 'katrin.mueller@mueller-consulting.de', role: 'Company Admin', password: 'demo123' },
          { email: 'thomas.huber@mueller-consulting.de',   role: 'Employee',      password: 'demo123' },
          { email: 'sara.mayer@mueller-consulting.de',     role: 'Finance Manager', password: 'demo123' },
          { email: 'anna.becker@mueller-consulting.de',    role: 'Employee',      password: 'demo123' },
          { email: 'weber@weber-partner.de',               role: 'Tax Advisor',   password: 'demo123' },
        ],
      },
    })
  } catch (err: any) {
    console.error('[Seed]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

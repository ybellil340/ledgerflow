export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db/prisma'
import bcrypt from 'bcryptjs'

const SEED_SECRET = process.env.SEED_SECRET ?? 'seed-ledgerflow-demo'

async function wipeAll() {
  // Delete in FK-safe order — deepest children first
  const ops = [
    'approvalAction','approvalStep','approvalRule','approvalPolicy',
    'exportRecord','exportBatch',
    'comment','attachment','notification','auditLog',
    'invoiceLineItem','customerInvoice','supplierInvoice',
    'receipt','expense','reimbursement','spendRequest',
    'cardLimitRule','card','transaction',
    'accountingMapping','vATCode',
    'customer','supplier',
    'taxAdvisorClientLink','taxAdvisorProfile','taxAdvisorFirm',
    'organizationFeatureFlag','integrationConnection','integration',
    'invitation','organizationMembership','subscription',
    'costCenter','department','organization',
    'session','user',
  ]
  for (const model of ops) {
    try {
      await (prisma as any)[model].deleteMany({})
    } catch (e: any) {
      // Skip if table doesn't exist yet
      if (!e.message?.includes('does not exist')) console.warn(`[wipe] ${model}:`, e.message)
    }
  }
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams
  if (params.get('secret') !== SEED_SECRET) {
    return NextResponse.json({ error: 'Add ?secret=seed-ledgerflow-demo' }, { status: 401 })
  }
  const force = params.get('force') === '1'

  // Check if already seeded
  if (!force) {
    const existing = await prisma.organizationMembership.findFirst({
      include: { user: { select: { email: true } }, organization: { select: { name: true } } }
    })
    if (existing) {
      return NextResponse.json({
        message: 'Already seeded',
        user: existing.user.email,
        org: existing.organization.name,
        hint: 'Add &force=1 to reseed'
      })
    }
  }

  try {
    await wipeAll()

    const hash = await bcrypt.hash('demo123', 10)

    // 1. Owner
    const katrin = await prisma.user.create({
      data: { email: 'katrin.mueller@mueller-consulting.de', firstName: 'Katrin', lastName: 'Müller', passwordHash: hash, isActive: true },
    })

    // 2. Org
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

    // 3. Subscription
    await prisma.subscription.create({
      data: {
        organizationId: org.id,
        plan: 'GROWTH',
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    // 4. Katrin membership
    await prisma.organizationMembership.create({
      data: { userId: katrin.id, organizationId: org.id, role: 'COMPANY_ADMIN', status: 'ACTIVE' },
    })

    // 5. Other users
    for (const u of [
      { email: 'thomas.huber@mueller-consulting.de',  firstName: 'Thomas', lastName: 'Huber',  role: 'EMPLOYEE' },
      { email: 'sara.mayer@mueller-consulting.de',    firstName: 'Sara',   lastName: 'Mayer',  role: 'FINANCE_MANAGER' },
      { email: 'anna.becker@mueller-consulting.de',   firstName: 'Anna',   lastName: 'Becker', role: 'EMPLOYEE' },
    ]) {
      const user = await prisma.user.create({
        data: { email: u.email, firstName: u.firstName, lastName: u.lastName, passwordHash: hash, isActive: true },
      })
      await prisma.organizationMembership.create({
        data: { userId: user.id, organizationId: org.id, role: u.role as any, status: 'ACTIVE' },
      })
    }

    // 6. Tax advisor
    const weber = await prisma.user.create({
      data: { email: 'weber@weber-partner.de', firstName: 'Klaus', lastName: 'Weber', passwordHash: hash, isActive: true },
    })
    const firm = await prisma.taxAdvisorFirm.create({
      data: { name: 'Weber & Partner', city: 'München' },
    })
    await prisma.taxAdvisorProfile.create({
      data: { userId: weber.id, firmId: firm.id, licenseNumber: 'STB-2024-001', isActive: true },
    })
    await prisma.taxAdvisorClientLink.create({
      data: { firmId: firm.id, organizationId: org.id },
    })

    // 7. Sample expenses
    const thomas = await prisma.user.findUnique({ where: { email: 'thomas.huber@mueller-consulting.de' } })
    await prisma.expense.createMany({
      data: [
        { organizationId: org.id, userId: thomas!.id, merchant: 'Lufthansa',          expenseDate: new Date('2025-03-14'), currency: 'EUR', grossAmount: 842,  vatRate: 19, vatAmount: 134.42, netAmount: 707.58, status: 'APPROVED' },
        { organizationId: org.id, userId: thomas!.id, merchant: 'Marriott Berlin',    expenseDate: new Date('2025-03-07'), currency: 'EUR', grossAmount: 420,  vatRate: 7,  vatAmount: 27.57,  netAmount: 392.43, status: 'PENDING_APPROVAL' },
        { organizationId: org.id, userId: katrin.id,  merchant: 'AWS Frankfurt',      expenseDate: new Date('2025-03-13'), currency: 'EUR', grossAmount: 1240, vatRate: 0,  vatAmount: 0,      netAmount: 1240,   status: 'PENDING_APPROVAL' },
        { organizationId: org.id, userId: katrin.id,  merchant: 'Conrad Electronics', expenseDate: new Date('2025-03-10'), currency: 'EUR', grossAmount: 249,  vatRate: 19, vatAmount: 39.75,  netAmount: 209.25, status: 'SUBMITTED' },
      ],
    })

    return NextResponse.json({
      success: true,
      message: '✅ Seeded! Go to /auth/login',
      logins: [
        { email: 'katrin.mueller@mueller-consulting.de', password: 'demo123', role: 'Company Admin' },
        { email: 'sara.mayer@mueller-consulting.de',     password: 'demo123', role: 'Finance Manager' },
        { email: 'weber@weber-partner.de',               password: 'demo123', role: 'Tax Advisor' },
      ],
    })
  } catch (err: any) {
    console.error('[Seed]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

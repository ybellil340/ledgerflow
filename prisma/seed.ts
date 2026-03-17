/**
 * LedgerFlow Demo Seed Data
 * Creates 3 realistic German SME companies + tax advisor firm
 * for investor-ready demo presentation
 */

import { PrismaClient } from '@prisma/client'
import { DEFAULT_VAT_CODES, SKR03_EXPENSE_ACCOUNTS } from '../lib/services/datev-export'

const prisma = new PrismaClient()

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function randomBetween(min: number, max: number) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100
}

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function daysFromNow(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

// ─────────────────────────────────────────────
// SEED
// ─────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding LedgerFlow demo data...')

  // ── SUPER ADMIN ──────────────────────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@ledgerflow.de' },
    update: {},
    create: {
      email: 'admin@ledgerflow.de',
      firstName: 'Platform',
      lastName: 'Admin',
      passwordHash: '$2b$12$placeholder_hash', // bcrypt hash of 'demo123'
      isActive: true,
    },
  })

  // ── TAX ADVISOR FIRM ─────────────────────────
  const taxFirm = await prisma.taxAdvisorFirm.create({
    data: {
      name: 'Steuerberatung Weber & Partner',
      registrationNumber: 'StB-12345-DE',
      email: 'kanzlei@weber-partner.de',
      phone: '+49 89 123456',
      city: 'München',
      country: 'DE',
    },
  })

  const taxAdvisorUser = await prisma.user.upsert({
    where: { email: 'weber@weber-partner.de' },
    update: {},
    create: {
      email: 'weber@weber-partner.de',
      firstName: 'Dr. Klaus',
      lastName: 'Weber',
      passwordHash: '$2b$12$placeholder_hash',
      isActive: true,
      taxAdvisorProfile: {
        create: { firmId: taxFirm.id, title: 'Steuerberater', isLead: true },
      },
    },
  })

  // ─────────────────────────────────────────────
  // COMPANY 1: Consulting Firm
  // ─────────────────────────────────────────────

  const adminUser1 = await prisma.user.upsert({
    where: { email: 'katrin.mueller@mueller-consulting.de' },
    update: {},
    create: {
      email: 'katrin.mueller@mueller-consulting.de',
      firstName: 'Katrin',
      lastName: 'Müller',
      passwordHash: '$2b$12$placeholder_hash',
      phone: '+49 89 555001',
      isActive: true,
    },
  })

  const org1 = await prisma.organization.create({
    data: {
      name: 'Müller Consulting GmbH',
      legalName: 'Müller Consulting Gesellschaft mit beschränkter Haftung',
      vatId: 'DE123456789',
      legalForm: 'GmbH',
      registrationNumber: 'HRB 123456',
      country: 'DE',
      city: 'München',
      postalCode: '80331',
      addressLine1: 'Maximilianstraße 45',
      industry: 'Management Consulting',
      companySize: '11-50',
      expectedMonthlySpend: 50000,
      accountingSoftware: 'DATEV',
      ownerId: adminUser1.id,
      onboardingComplete: true,
    },
  })

  // Memberships
  await prisma.organizationMembership.create({
    data: { organizationId: org1.id, userId: adminUser1.id, role: 'COMPANY_ADMIN', status: 'ACTIVE' },
  })

  // Departments
  const dept1Sales = await prisma.department.create({
    data: { organizationId: org1.id, name: 'Sales & Business Development', code: 'SBD', budgetMonthly: 15000 },
  })
  const dept1Tech = await prisma.department.create({
    data: { organizationId: org1.id, name: 'Technology', code: 'TECH', budgetMonthly: 12000 },
  })
  const dept1Mkt = await prisma.department.create({
    data: { organizationId: org1.id, name: 'Marketing', code: 'MKT', budgetMonthly: 8000 },
  })
  const dept1Admin = await prisma.department.create({
    data: { organizationId: org1.id, name: 'Administration', code: 'ADM', budgetMonthly: 5000 },
  })

  // Cost Centers
  const cc1 = await prisma.costCenter.create({
    data: { organizationId: org1.id, departmentId: dept1Sales.id, name: 'Client Projects', code: 'CC-201' },
  })
  const cc2 = await prisma.costCenter.create({
    data: { organizationId: org1.id, departmentId: dept1Tech.id, name: 'Infrastructure', code: 'CC-105' },
  })
  const cc3 = await prisma.costCenter.create({
    data: { organizationId: org1.id, departmentId: dept1Mkt.id, name: 'Growth', code: 'CC-310' },
  })

  // VAT Codes
  for (const vat of DEFAULT_VAT_CODES) {
    await prisma.vATCode.create({
      data: { organizationId: org1.id, ...vat },
    })
  }

  // Accounting Mappings
  const mappings = [
    { categoryName: 'Travel', accountingCode: '4670', description: 'Reisekosten' },
    { categoryName: 'Meals', accountingCode: '4674', description: 'Bewirtungskosten' },
    { categoryName: 'Software', accountingCode: '4980', description: 'EDV-Kosten' },
    { categoryName: 'Equipment', accountingCode: '4830', description: 'Kleingeräte' },
    { categoryName: 'Office', accountingCode: '4910', description: 'Bürobedarf' },
    { categoryName: 'Marketing', accountingCode: '4600', description: 'Werbung' },
    { categoryName: 'Consulting', accountingCode: '4970', description: 'Beratung' },
    { categoryName: 'Banking', accountingCode: '4970', description: 'Bankgebühren' },
  ]
  for (const m of mappings) {
    await prisma.accountingMapping.create({ data: { organizationId: org1.id, ...m } })
  }

  // Employees
  const emp1 = await prisma.user.create({
    data: {
      email: 'thomas.huber@mueller-consulting.de',
      firstName: 'Thomas', lastName: 'Huber',
      passwordHash: '$2b$12$placeholder_hash', isActive: true,
    },
  })
  const emp2 = await prisma.user.create({
    data: {
      email: 'sara.mayer@mueller-consulting.de',
      firstName: 'Sara', lastName: 'Mayer',
      passwordHash: '$2b$12$placeholder_hash', isActive: true,
    },
  })
  const emp3 = await prisma.user.create({
    data: {
      email: 'jonas.pfeiffer@mueller-consulting.de',
      firstName: 'Jonas', lastName: 'Pfeiffer',
      passwordHash: '$2b$12$placeholder_hash', isActive: true,
    },
  })
  const emp4 = await prisma.user.create({
    data: {
      email: 'anna.becker@mueller-consulting.de',
      firstName: 'Anna', lastName: 'Becker',
      passwordHash: '$2b$12$placeholder_hash', isActive: true,
    },
  })

  for (const [u, dept, role] of [
    [emp1, dept1Sales, 'EMPLOYEE'],
    [emp2, dept1Tech, 'EMPLOYEE'],
    [emp3, dept1Sales, 'EMPLOYEE'],
    [emp4, dept1Mkt, 'APPROVER'],
  ] as const) {
    await prisma.organizationMembership.create({
      data: { organizationId: org1.id, userId: (u as typeof emp1).id, role, status: 'ACTIVE', departmentId: (dept as typeof dept1Sales).id },
    })
  }

  // Cards
  const card1 = await prisma.card.create({
    data: {
      organizationId: org1.id, userId: emp1.id, type: 'VIRTUAL',
      status: 'ACTIVE', lastFour: '4821', cardholderName: 'Thomas Huber',
      purpose: 'Travel Card', issuedAt: daysAgo(60),
      limitRules: {
        create: {
          period: 'MONTHLY', limitAmount: 5000, spentAmount: 3350,
          allowedMerchantCategories: ['3000', '3001', '7011', '7514'], // airlines, hotels, car rental
          blockedMerchantCategories: [],
        },
      },
    },
  })

  const card2 = await prisma.card.create({
    data: {
      organizationId: org1.id, userId: emp2.id, type: 'VIRTUAL',
      status: 'ACTIVE', lastFour: '7734', cardholderName: 'Sara Mayer',
      purpose: 'Software Subscriptions', issuedAt: daysAgo(90),
      limitRules: {
        create: { period: 'MONTHLY', limitAmount: 3000, spentAmount: 2640 },
      },
    },
  })

  const card3 = await prisma.card.create({
    data: {
      organizationId: org1.id, userId: emp3.id, type: 'PHYSICAL',
      status: 'FROZEN', lastFour: '2290', cardholderName: 'Jonas Pfeiffer',
      purpose: 'General Expenses', issuedAt: daysAgo(120), frozenAt: daysAgo(5),
      limitRules: {
        create: { period: 'MONTHLY', limitAmount: 2000, spentAmount: 440 },
      },
    },
  })

  // Transactions
  const txData = [
    { merchant: 'Lufthansa', amount: -842, category: 'Travel', cardId: card1.id, daysAgo: 2 },
    { merchant: 'AWS Frankfurt', amount: -1240, category: 'Software', cardId: card2.id, daysAgo: 3 },
    { merchant: 'Restaurant Zur Post', amount: -387, category: 'Meals', cardId: card3.id, daysAgo: 4 },
    { merchant: 'Kunde GmbH - Zahlung', amount: 8500, category: 'Revenue', cardId: null, daysAgo: 5 },
    { merchant: 'Conrad Electronics', amount: -249, category: 'Equipment', cardId: card3.id, daysAgo: 6 },
    { merchant: 'Commerzbank Gebühr', amount: -24, category: 'Banking', cardId: null, daysAgo: 8 },
    { merchant: 'Marriott Berlin', amount: -420, category: 'Travel', cardId: card1.id, daysAgo: 9 },
    { merchant: 'Microsoft 365', amount: -299, category: 'Software', cardId: card2.id, daysAgo: 12 },
    { merchant: 'Tank & Rast', amount: -65, category: 'Travel', cardId: card1.id, daysAgo: 14 },
    { merchant: 'Techcorp Berlin GmbH', amount: 24000, category: 'Revenue', cardId: null, daysAgo: 15 },
  ]

  for (const tx of txData) {
    await prisma.transaction.create({
      data: {
        organizationId: org1.id,
        cardId: tx.cardId ?? undefined,
        merchant: tx.merchant,
        merchantCategory: tx.category,
        amount: tx.amount,
        currency: 'EUR',
        transactionDate: daysAgo(tx.daysAgo),
        status: tx.amount > 0 ? 'MATCHED' : (Math.random() > 0.4 ? 'MATCHED' : 'UNCATEGORIZED'),
      },
    })
  }

  // Expenses (with various statuses)
  const expenseData = [
    { merchant: 'Lufthansa', amount: 842, vatRate: 19, category: 'Travel', deptId: dept1Sales.id, ccId: cc1.id, userId: emp1.id, status: 'APPROVED', daysAgo: 2 },
    { merchant: 'AWS Frankfurt', amount: 1240, vatRate: 0, category: 'Software', deptId: dept1Tech.id, ccId: cc2.id, userId: emp2.id, status: 'PENDING_APPROVAL', daysAgo: 3 },
    { merchant: 'Restaurant Zur Post', amount: 387, vatRate: 7, category: 'Meals', deptId: dept1Sales.id, ccId: cc1.id, userId: emp3.id, status: 'SUBMITTED', daysAgo: 4 },
    { merchant: 'Conrad Electronics', amount: 249, vatRate: 19, category: 'Equipment', deptId: dept1Mkt.id, ccId: cc3.id, userId: emp4.id, status: 'FLAGGED', daysAgo: 6 },
    { merchant: 'Commerzbank Gebühr', amount: 24, vatRate: 0, category: 'Banking', deptId: dept1Admin.id, ccId: null, userId: adminUser1.id, status: 'EXPORTED', daysAgo: 8 },
    { merchant: 'Marriott Berlin', amount: 420, vatRate: 7, category: 'Travel', deptId: dept1Sales.id, ccId: cc1.id, userId: emp1.id, status: 'APPROVED', daysAgo: 9 },
  ]

  for (const e of expenseData) {
    const vatAmount = e.vatRate > 0 ? Math.round(e.amount - (e.amount / (1 + e.vatRate / 100)) * 100) / 100 : 0
    await prisma.expense.create({
      data: {
        organizationId: org1.id,
        userId: e.userId,
        merchant: e.merchant,
        expenseDate: daysAgo(e.daysAgo),
        currency: 'EUR',
        grossAmount: e.amount,
        vatRate: e.vatRate,
        vatAmount,
        netAmount: e.amount - vatAmount,
        categoryId: e.category,
        departmentId: e.deptId,
        costCenterId: e.ccId ?? undefined,
        paymentMethod: 'card',
        status: e.status as ExpenseStatus,
      },
    })
  }

  // Suppliers
  const supplier1 = await prisma.supplier.create({
    data: {
      organizationId: org1.id, name: 'Siemens AG', legalName: 'Siemens Aktiengesellschaft',
      vatId: 'DE123456781', email: 'rechnungen@siemens.com',
      city: 'München', country: 'DE', paymentTerms: 30,
    },
  })
  const supplier2 = await prisma.supplier.create({
    data: {
      organizationId: org1.id, name: 'KPMG Germany', vatId: 'DE987654321',
      email: 'invoice@kpmg.de', city: 'Frankfurt', country: 'DE', paymentTerms: 14,
    },
  })
  const supplier3 = await prisma.supplier.create({
    data: {
      organizationId: org1.id, name: 'DHL Logistics', vatId: 'DE555666777',
      email: 'billing@dhl.de', city: 'Bonn', country: 'DE', paymentTerms: 30,
    },
  })

  // Supplier Invoices
  await prisma.supplierInvoice.createMany({
    data: [
      {
        organizationId: org1.id, supplierId: supplier1.id,
        invoiceNumber: 'INV-2025-0085', invoiceDate: daysAgo(10),
        dueDate: daysFromNow(20), currency: 'EUR',
        grossAmount: 8330, vatAmount: 1330, netAmount: 7000,
        status: 'PENDING_APPROVAL', notes: 'IT equipment Q1',
      },
      {
        organizationId: org1.id, supplierId: supplier2.id,
        invoiceNumber: 'INV-2025-0077', invoiceDate: daysAgo(20),
        dueDate: daysFromNow(5), currency: 'EUR',
        grossAmount: 12000, vatAmount: 1916, netAmount: 10084,
        status: 'APPROVED',
      },
      {
        organizationId: org1.id, supplierId: supplier3.id,
        invoiceNumber: 'INV-2025-0083', invoiceDate: daysAgo(8),
        dueDate: daysFromNow(18), currency: 'EUR',
        grossAmount: 2140, vatAmount: 342, netAmount: 1798,
        status: 'PENDING_APPROVAL',
      },
      {
        organizationId: org1.id, supplierId: supplier1.id,
        invoiceNumber: 'INV-2025-0068', invoiceDate: daysAgo(30),
        dueDate: daysAgo(15), currency: 'EUR',
        grossAmount: 340, vatAmount: 54, netAmount: 286,
        status: 'OVERDUE',
      },
    ],
  })

  // Customers
  const cust1 = await prisma.customer.create({
    data: {
      organizationId: org1.id, name: 'Techcorp Berlin GmbH',
      vatId: 'DE111222333', email: 'ap@techcorp-berlin.de',
      city: 'Berlin', country: 'DE', paymentTerms: 30,
    },
  })
  const cust2 = await prisma.customer.create({
    data: {
      organizationId: org1.id, name: 'Innovate AG',
      vatId: 'DE444555666', email: 'buchhaltung@innovate.de',
      city: 'Hamburg', country: 'DE', paymentTerms: 14,
    },
  })

  // Customer Invoices
  await prisma.customerInvoice.createMany({
    data: [
      {
        organizationId: org1.id, customerId: cust1.id,
        invoiceNumber: 'RE-2025-042', issueDate: daysAgo(5),
        dueDate: daysFromNow(25), currency: 'EUR',
        subtotal: 20168, vatAmount: 3832, total: 24000,
        status: 'SENT', sentAt: daysAgo(5),
      },
      {
        organizationId: org1.id, customerId: cust2.id,
        invoiceNumber: 'RE-2025-041', issueDate: daysAgo(10),
        dueDate: daysFromNow(4), currency: 'EUR',
        subtotal: 15546, vatAmount: 2954, total: 18500,
        status: 'VIEWED', sentAt: daysAgo(10), viewedAt: daysAgo(8),
      },
    ],
  })

  // Tax Advisor Link
  await prisma.taxAdvisorClientLink.create({
    data: {
      firmId: taxFirm.id, organizationId: org1.id,
      assignedToId: taxAdvisorUser.id,
      canExport: true, canComment: true, canLockPeriods: true,
    },
  })

  // Subscription
  await prisma.subscription.create({
    data: {
      organizationId: org1.id, plan: 'GROWTH', status: 'ACTIVE',
      maxUsers: 25, maxCards: 50, maxMonthlyExpenses: 1000,
      currentPeriodStart: daysAgo(15), currentPeriodEnd: daysFromNow(15),
    },
  })

  // Notifications
  await prisma.notification.createMany({
    data: [
      {
        userId: adminUser1.id, organizationId: org1.id,
        type: 'missing_receipt', title: 'Missing receipt',
        message: 'Jonas Pfeiffer has 3 expenses without receipts totalling €652',
        entityType: 'expense', isRead: false,
      },
      {
        userId: adminUser1.id, organizationId: org1.id,
        type: 'invoice_overdue', title: 'Invoice overdue',
        message: 'DHL Logistics INV-2025-0068 is 15 days past due (€340)',
        entityType: 'supplier_invoice', isRead: false,
      },
      {
        userId: adminUser1.id, organizationId: org1.id,
        type: 'tax_deadline', title: 'USt-Voranmeldung due in 25 days',
        message: 'Q1 2025 VAT return must be submitted by 10 April 2025',
        isRead: false,
      },
    ],
  })

  // ─────────────────────────────────────────────
  // COMPANY 2: Logistics SME
  // ─────────────────────────────────────────────

  const adminUser2 = await prisma.user.upsert({
    where: { email: 'cfo@schnell-logistik.de' },
    update: {},
    create: {
      email: 'cfo@schnell-logistik.de',
      firstName: 'Hans', lastName: 'Schneider',
      passwordHash: '$2b$12$placeholder_hash', isActive: true,
    },
  })

  const org2 = await prisma.organization.create({
    data: {
      name: 'Schnell Logistik GmbH',
      legalName: 'Schnell Logistik GmbH',
      vatId: 'DE987654320',
      legalForm: 'GmbH',
      country: 'DE', city: 'Hamburg', postalCode: '20095',
      addressLine1: 'Speicherstadt 12',
      industry: 'Logistics & Transport',
      companySize: '51-200',
      expectedMonthlySpend: 120000,
      accountingSoftware: 'DATEV',
      ownerId: adminUser2.id,
      onboardingComplete: true,
    },
  })

  await prisma.organizationMembership.create({
    data: { organizationId: org2.id, userId: adminUser2.id, role: 'COMPANY_ADMIN', status: 'ACTIVE' },
  })

  await prisma.taxAdvisorClientLink.create({
    data: {
      firmId: taxFirm.id, organizationId: org2.id,
      assignedToId: taxAdvisorUser.id, canExport: true, canComment: true,
    },
  })

  await prisma.subscription.create({
    data: {
      organizationId: org2.id, plan: 'PRO', status: 'ACTIVE',
      maxUsers: 100, maxCards: 200, maxMonthlyExpenses: 5000,
      currentPeriodStart: daysAgo(5), currentPeriodEnd: daysFromNow(25),
    },
  })

  // ─────────────────────────────────────────────
  // COMPANY 3: Marketing Agency
  // ─────────────────────────────────────────────

  const adminUser3 = await prisma.user.upsert({
    where: { email: 'admin@kreativ-agentur.de' },
    update: {},
    create: {
      email: 'admin@kreativ-agentur.de',
      firstName: 'Lena', lastName: 'Fischer',
      passwordHash: '$2b$12$placeholder_hash', isActive: true,
    },
  })

  const org3 = await prisma.organization.create({
    data: {
      name: 'Kreativ Agentur Berlin',
      legalName: 'Kreativ Agentur Berlin GmbH',
      vatId: 'DE555444333',
      legalForm: 'GmbH',
      country: 'DE', city: 'Berlin', postalCode: '10178',
      addressLine1: 'Alexanderplatz 5',
      industry: 'Marketing & Creative',
      companySize: '11-50',
      expectedMonthlySpend: 35000,
      ownerId: adminUser3.id,
      onboardingComplete: false,
      onboardingStep: 3,
    },
  })

  await prisma.organizationMembership.create({
    data: { organizationId: org3.id, userId: adminUser3.id, role: 'COMPANY_ADMIN', status: 'ACTIVE' },
  })

  await prisma.subscription.create({
    data: {
      organizationId: org3.id, plan: 'STARTER', status: 'TRIALING',
      maxUsers: 5, maxCards: 10, maxMonthlyExpenses: 100,
      trialEndsAt: daysFromNow(14),
    },
  })

  // ── FEATURE FLAGS ─────────────────────────────
  const flags = [
    { key: 'ocr_receipt_extraction', description: 'AI-powered OCR for receipt data extraction', isEnabled: false },
    { key: 'ai_cash_flow_forecast', description: 'ML-based cash flow forecasting', isEnabled: false },
    { key: 'embedded_financing', description: 'Embedded lending products', isEnabled: false },
    { key: 'datev_live_sync', description: 'Real-time DATEV sync (requires integration)', isEnabled: false },
    { key: 'multi_currency', description: 'Multi-currency support', isEnabled: true },
    { key: 'sso', description: 'Single Sign-On (SSO)', isEnabled: false },
    { key: 'duplicate_invoice_detection', description: 'ML duplicate detection for AP', isEnabled: true },
    { key: 'smart_categorization', description: 'Auto-categorization of transactions', isEnabled: true },
  ]

  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: {},
      create: flag,
    })
  }

  console.log('✅ Demo seed complete!')
  console.log('\n📋 Demo credentials:')
  console.log('   Platform Admin:   admin@ledgerflow.de / demo123')
  console.log('   Company Admin:    katrin.mueller@mueller-consulting.de / demo123')
  console.log('   Finance Manager:  thomas.huber@mueller-consulting.de / demo123')
  console.log('   Tax Advisor:      weber@weber-partner.de / demo123')
  console.log('\n🏢 Demo companies:')
  console.log('   1. Müller Consulting GmbH (München) — Full data, Growth plan')
  console.log('   2. Schnell Logistik GmbH (Hamburg) — Pro plan')
  console.log('   3. Kreativ Agentur Berlin — Trial, onboarding incomplete')
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())

type ExpenseStatus = 'DRAFT' | 'SUBMITTED' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXPORTED' | 'FLAGGED'

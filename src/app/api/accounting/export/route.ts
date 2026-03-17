export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import {
  buildDATEVHeader,
  buildDATEVExport,
  expenseToDATEV,
  supplierInvoiceToDATEV,
  customerInvoiceToDATEV,
} from '@/lib/services/datev-export'
import type { SessionUser } from '@/types'

const CreateExportSchema = z.object({
  format: z.enum(['DATEV', 'CSV', 'XLSX']),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  includeExpenses: z.boolean().default(true),
  includeSupplierInvoices: z.boolean().default(true),
  includeCustomerInvoices: z.boolean().default(true),
  includeReimbursements: z.boolean().default(true),
  lockPeriod: z.boolean().default(false),
  chartOfAccounts: z.enum(['SKR03', 'SKR04']).default('SKR03'),
  beraterNummer: z.number().optional(),
  mandantNummer: z.number().optional(),
})

// ─── GET /api/accounting/export ──────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  
  if (type === 'readiness') {
    const orgId = session.currentOrganizationId
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    
    const [total, categorized, withReceipt, withVat] = await Promise.all([
      prisma.expense.count({ where: { organizationId: orgId, deletedAt: null, expenseDate: { gte: monthStart } } }),
      prisma.expense.count({ where: { organizationId: orgId, deletedAt: null, expenseDate: { gte: monthStart }, categoryId: { not: null } } }),
      prisma.expense.count({ where: { organizationId: orgId, deletedAt: null, expenseDate: { gte: monthStart }, receipt: { isNot: null } } }),
      prisma.expense.count({ where: { organizationId: orgId, deletedAt: null, expenseDate: { gte: monthStart }, vatCodeId: { not: null } } }),
    ])
    
    const score = total > 0 ? Math.round(((categorized + withReceipt + withVat) / (total * 3)) * 100) : 100
    
    return NextResponse.json({ data: {
      period: now.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
      totalRecords: total,
      categorized,
      receiptMatched: withReceipt,
      vatAssigned: withVat,
      score,
      issues: [
        ...(total - categorized > 0 ? [{ type: 'uncategorized', count: total - categorized, description: `${total - categorized} expenses need categorization` }] : []),
        ...(total - withReceipt > 0 ? [{ type: 'missing_receipt', count: total - withReceipt, description: `${total - withReceipt} expenses missing receipts` }] : []),
      ],
    }})
  }

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '20'), 50)

  const [total, batches] = await Promise.all([
    prisma.exportBatch.count({ where: { organizationId: session.currentOrganizationId } }),
    prisma.exportBatch.findMany({
      where: { organizationId: session.currentOrganizationId },
      include: {
        _count: { select: { expenses: true, supplierInvoices: true, customerInvoices: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  // Readiness check for current period
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  const readiness = await getExportReadiness(session.currentOrganizationId, monthStart, monthEnd)

  return NextResponse.json({
    data: batches,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    readiness,
  })
}, 'export:accounting')

// ─── POST /api/accounting/export ─────────────

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const params = CreateExportSchema.parse(body)

  const periodStart = new Date(params.periodStart)
  const periodEnd = new Date(params.periodEnd)

  // Check period not already locked
  const existingLocked = await prisma.exportBatch.findFirst({
    where: {
      organizationId: session.currentOrganizationId,
      isLocked: true,
      periodStart: { lte: periodEnd },
      periodEnd: { gte: periodStart },
    },
  })
  if (existingLocked) {
    return NextResponse.json({
      error: `Period overlaps with locked export batch from ${existingLocked.createdAt.toLocaleDateString('de-DE')}`,
    }, { status: 409 })
  }

  // Gather data for export
  const [expenses, supplierInvoices, customerInvoices, reimbursements] = await Promise.all([
    params.includeExpenses ? prisma.expense.findMany({
      where: {
        organizationId: session.currentOrganizationId,
        status: { in: ['APPROVED', 'EXPORTED'] },
        expenseDate: { gte: periodStart, lte: periodEnd },
        deletedAt: null,
        exportBatchId: null, // not already exported
      },
      include: { vatCode: true, department: true, costCenter: true },
    }) : Promise.resolve([]),

    params.includeSupplierInvoices ? prisma.supplierInvoice.findMany({
      where: {
        organizationId: session.currentOrganizationId,
        status: { in: ['APPROVED', 'PAID'] },
        invoiceDate: { gte: periodStart, lte: periodEnd },
        deletedAt: null,
        exportBatchId: null,
      },
      include: { supplier: true, vatCode: true },
    }) : Promise.resolve([]),

    params.includeCustomerInvoices ? prisma.customerInvoice.findMany({
      where: {
        organizationId: session.currentOrganizationId,
        status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID', 'PAID'] },
        issueDate: { gte: periodStart, lte: periodEnd },
        deletedAt: null,
        exportBatchId: null,
      },
      include: { customer: true },
    }) : Promise.resolve([]),

    params.includeReimbursements ? prisma.reimbursement.findMany({
      where: {
        organizationId: session.currentOrganizationId,
        status: 'PAID',
        createdAt: { gte: periodStart, lte: periodEnd },
        exportBatchId: null,
      },
    }) : Promise.resolve([]),
  ])

  const totalRecords = expenses.length + supplierInvoices.length + customerInvoices.length + reimbursements.length

  if (totalRecords === 0) {
    return NextResponse.json({ error: 'No records found for the specified period and criteria' }, { status: 400 })
  }

  // Get accounting mappings for the org
  const mappings = await prisma.accountingMapping.findMany({
    where: { organizationId: session.currentOrganizationId, isActive: true },
  })
  const mappingMap = Object.fromEntries(mappings.map((m) => [m.categoryName, m.accountingCode]))

  // Get org info for DATEV header
  const org = await prisma.organization.findUnique({ where: { id: session.currentOrganizationId } })

  // Create export batch record
  const exportBatch = await prisma.exportBatch.create({
    data: {
      organizationId: session.currentOrganizationId,
      createdById: session.id,
      format: params.format as never,
      status: 'PROCESSING',
      periodStart,
      periodEnd,
      recordCount: totalRecords,
      totalAmount: [
        ...expenses.map((e) => Number(e.grossAmount)),
        ...supplierInvoices.map((i) => Number(i.grossAmount)),
        ...customerInvoices.map((i) => Number(i.total)),
      ].reduce((s, a) => s + a, 0),
    },
  })

  let exportContent: string
  let fileName: string
  let recordCount = 0

  if (params.format === 'DATEV') {
    const header = buildDATEVHeader({
      organizationName: org?.name ?? 'Unknown',
      exportedBy: `${session.firstName} ${session.lastName}`,
      dateFrom: periodStart,
      dateTo: periodEnd,
      fiscalYearStart: new Date(periodStart.getFullYear(), 0, 1),
      chartOfAccounts: params.chartOfAccounts,
      beraterNummer: params.beraterNummer,
      mandantNummer: params.mandantNummer,
    })

    const buchungen = [
      ...expenses.map((e) => {
        const accountCode = mappingMap[e.categoryId ?? ''] ?? '4970'
        return expenseToDATEV(e as Parameters<typeof expenseToDATEV>[0], accountCode)
      }),
      ...supplierInvoices.map((inv) => {
        const accountCode = mappingMap[inv.categoryId ?? ''] ?? '4970'
        const creditorCode = `70${String(supplierInvoices.indexOf(inv)).padStart(3, '0')}`
        return supplierInvoiceToDATEV(inv as Parameters<typeof supplierInvoiceToDATEV>[0], accountCode, creditorCode)
      }),
      ...customerInvoices.map((inv) => {
        const debtorCode = `10${String(customerInvoices.indexOf(inv)).padStart(3, '0')}`
        return customerInvoiceToDATEV(inv as Parameters<typeof customerInvoiceToDATEV>[0], '8400', debtorCode)
      }),
    ]

    const exportPackage = buildDATEVExport(header, buchungen)
    exportContent = exportPackage.content
    fileName = exportPackage.filename
    recordCount = exportPackage.recordCount
  } else {
    // Generic CSV export
    const csvRows = [
      'Type,Date,Description,Amount,VAT Rate,VAT Amount,Net Amount,Account Code,Status',
      ...expenses.map((e) => [
        'Expense', e.expenseDate.toISOString().slice(0, 10), `"${e.merchant}"`,
        e.grossAmount, e.vatRate ?? 0, e.vatAmount ?? 0, e.netAmount ?? 0,
        mappingMap[e.categoryId ?? ''] ?? '', e.status,
      ].join(',')),
      ...supplierInvoices.map((inv) => [
        'SupplierInvoice', inv.invoiceDate.toISOString().slice(0, 10), `"${inv.invoiceNumber}"`,
        inv.grossAmount, 0, inv.vatAmount ?? 0, inv.netAmount ?? 0, '', inv.status,
      ].join(',')),
      ...customerInvoices.map((inv) => [
        'CustomerInvoice', inv.issueDate.toISOString().slice(0, 10), `"${inv.invoiceNumber}"`,
        inv.total, 0, inv.vatAmount ?? 0, inv.subtotal, '8400', inv.status,
      ].join(',')),
    ]
    exportContent = csvRows.join('\r\n')
    fileName = `LedgerFlow_Export_${periodStart.toISOString().slice(0, 10)}_${periodEnd.toISOString().slice(0, 10)}.csv`
    recordCount = expenses.length + supplierInvoices.length + customerInvoices.length
  }

  // In production: upload to S3 and store URL
  // For now: store content hash and mark complete
  const fileUrl = `/api/accounting/export/${exportBatch.id}/download`

  // Mark records as exported + link to batch
  await Promise.all([
    expenses.length > 0 && prisma.expense.updateMany({
      where: { id: { in: expenses.map((e) => e.id) } },
      data: { status: 'EXPORTED', exportedAt: new Date(), exportBatchId: exportBatch.id },
    }),
    supplierInvoices.length > 0 && prisma.supplierInvoice.updateMany({
      where: { id: { in: supplierInvoices.map((i) => i.id) } },
      data: { status: 'EXPORTED', exportBatchId: exportBatch.id },
    }),
    customerInvoices.length > 0 && prisma.customerInvoice.updateMany({
      where: { id: { in: customerInvoices.map((i) => i.id) } },
      data: { exportBatchId: exportBatch.id },
    }),
    reimbursements.length > 0 && prisma.reimbursement.updateMany({
      where: { id: { in: reimbursements.map((r) => r.id) } },
      data: { exportBatchId: exportBatch.id },
    }),
  ])

  // Create immutable export records (snapshots)
  await prisma.exportRecord.createMany({
    data: [
      ...expenses.map((e) => ({
        batchId: exportBatch.id,
        entityType: 'expense',
        entityId: e.id,
        accountingCode: mappingMap[e.categoryId ?? ''] ?? '4970',
        snapshotData: e as unknown as Record<string, unknown>,
      })),
      ...supplierInvoices.map((inv) => ({
        batchId: exportBatch.id,
        entityType: 'supplier_invoice',
        entityId: inv.id,
        accountingCode: mappingMap[inv.categoryId ?? ''] ?? '4970',
        snapshotData: inv as unknown as Record<string, unknown>,
      })),
    ],
  })

  // Update batch to completed
  const completedBatch = await prisma.exportBatch.update({
    where: { id: exportBatch.id },
    data: {
      status: 'COMPLETED',
      fileUrl,
      fileName,
      recordCount,
      isLocked: params.lockPeriod,
      lockedAt: params.lockPeriod ? new Date() : undefined,
      metadata: { exportContent: exportContent.slice(0, 500) + '...' }, // store preview
    },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId, actorId: session.id,
      action: 'EXPORT', entityType: 'export_batch', entityId: exportBatch.id,
      after: {
        format: params.format, recordCount, periodStart: params.periodStart,
        periodEnd: params.periodEnd, locked: params.lockPeriod,
      },
    },
  })

  return NextResponse.json({
    data: completedBatch,
    preview: exportContent.slice(0, 2000),
    downloadUrl: fileUrl,
    message: `Export complete: ${recordCount} records exported as ${params.format}`,
  }, { status: 201 })
}, 'export:accounting')

// ─── EXPORT READINESS ────────────────────────

async function getExportReadiness(orgId: string, from: Date, to: Date) {
  const [expenses, categorized, receiptMatched, vatAssigned] = await Promise.all([
    prisma.expense.count({ where: { organizationId: orgId, status: { in: ['APPROVED'] }, expenseDate: { gte: from, lte: to }, deletedAt: null } }),
    prisma.expense.count({ where: { organizationId: orgId, status: { in: ['APPROVED'] }, categoryId: { not: null }, expenseDate: { gte: from, lte: to }, deletedAt: null } }),
    prisma.expense.count({ where: { organizationId: orgId, status: { in: ['APPROVED'] }, receipt: { isNot: null }, expenseDate: { gte: from, lte: to }, deletedAt: null } }),
    prisma.expense.count({ where: { organizationId: orgId, status: { in: ['APPROVED'] }, vatCodeId: { not: null }, expenseDate: { gte: from, lte: to }, deletedAt: null } }),
  ])

  return {
    totalExpenses: expenses,
    categorized,
    receiptMatched,
    vatAssigned,
    readyToExport: Math.min(categorized, receiptMatched, vatAssigned),
    percentage: expenses > 0 ? Math.round((Math.min(categorized, receiptMatched, vatAssigned) / expenses) * 100) : 100,
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import { getApprovalEngine } from '@/lib/services/approval-engine'
import type { SessionUser } from '@/types'

// ─── SCHEMAS ─────────────────────────────────

const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number(),
  vatRate: z.number().min(0).max(100),
  costCenterId: z.string().cuid().optional(),
  accountingCode: z.string().optional(),
})

const CreateAPInvoiceSchema = z.object({
  supplierId: z.string().cuid(),
  invoiceNumber: z.string().min(1).max(100),
  invoiceDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  currency: z.string().length(3).default('EUR'),
  grossAmount: z.number().positive(),
  vatAmount: z.number().min(0).optional(),
  netAmount: z.number().min(0).optional(),
  vatCodeId: z.string().cuid().optional(),
  categoryId: z.string().optional(),
  notes: z.string().max(2000).optional(),
  lineItems: z.array(LineItemSchema).optional(),
})

const UpdateAPInvoiceSchema = CreateAPInvoiceSchema.partial().omit({ supplierId: true })

// ─── GET /api/invoices/ap ────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '25'), 100)
  const status = searchParams.getAll('status')
  const supplierId = searchParams.get('supplierId')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')
  const isOverdue = searchParams.get('isOverdue')
  const search = searchParams.get('search')

  const where: Record<string, unknown> = {
    organizationId: session.currentOrganizationId,
    deletedAt: null,
  }

  if (status.length > 0) where.status = { in: status }
  if (supplierId) where.supplierId = supplierId
  if (isOverdue === 'true') {
    where.dueDate = { lt: new Date() }
    where.status = { notIn: ['PAID', 'CANCELLED'] }
  }
  if (dateFrom || dateTo) {
    where.invoiceDate = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo) } : {}),
    }
  }
  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { supplier: { name: { contains: search, mode: 'insensitive' } } },
      { notes: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [total, items] = await Promise.all([
    prisma.supplierInvoice.count({ where }),
    prisma.supplierInvoice.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true, vatId: true, email: true } },
        vatCode: { select: { id: true, code: true, rate: true, description: true } },
        lineItems: true,
        _count: { select: { comments: true, attachments: true } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  // Status summary for kanban counts
  const statusSummary = await prisma.supplierInvoice.groupBy({
    by: ['status'],
    where: { organizationId: session.currentOrganizationId, deletedAt: null },
    _count: { status: true },
    _sum: { grossAmount: true },
  })

  // Overdue count
  const overdueCount = await prisma.supplierInvoice.count({
    where: {
      organizationId: session.currentOrganizationId,
      deletedAt: null,
      dueDate: { lt: new Date() },
      status: { notIn: ['PAID', 'CANCELLED', 'EXPORTED'] },
    },
  })

  return NextResponse.json({
    data: items,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    summary: {
      byStatus: statusSummary.map((s) => ({
        status: s.status,
        count: s._count.status,
        totalAmount: Number(s._sum.grossAmount ?? 0),
      })),
      overdueCount,
    },
  })
})

// ─── POST /api/invoices/ap ───────────────────

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const data = CreateAPInvoiceSchema.parse(body)

  // Verify supplier belongs to org
  const supplier = await prisma.supplier.findFirst({
    where: { id: data.supplierId, organizationId: session.currentOrganizationId },
  })
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })

  // Duplicate detection — same supplier + invoice number
  const duplicate = await prisma.supplierInvoice.findFirst({
    where: {
      organizationId: session.currentOrganizationId,
      supplierId: data.supplierId,
      invoiceNumber: data.invoiceNumber,
      deletedAt: null,
    },
  })

  // Compute VAT if not supplied
  let vatAmount = data.vatAmount
  let netAmount = data.netAmount
  if (!vatAmount && data.lineItems) {
    vatAmount = data.lineItems.reduce((sum, li) => {
      const net = li.quantity * li.unitPrice
      return sum + net * (li.vatRate / 100)
    }, 0)
    netAmount = data.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0)
  } else if (!vatAmount) {
    vatAmount = 0
    netAmount = data.grossAmount - (vatAmount ?? 0)
  }

  const invoice = await prisma.supplierInvoice.create({
    data: {
      organizationId: session.currentOrganizationId,
      supplierId: data.supplierId,
      invoiceNumber: data.invoiceNumber,
      invoiceDate: new Date(data.invoiceDate),
      dueDate: new Date(data.dueDate),
      currency: data.currency,
      grossAmount: data.grossAmount,
      vatAmount: vatAmount ?? 0,
      netAmount: netAmount ?? data.grossAmount - (vatAmount ?? 0),
      vatCodeId: data.vatCodeId,
      categoryId: data.categoryId,
      notes: data.notes,
      status: 'DRAFT',
      isDuplicate: !!duplicate,
      duplicateOfId: duplicate?.id,
      lineItems: data.lineItems ? {
        create: data.lineItems.map((li, idx) => {
          const net = li.quantity * li.unitPrice
          const vatAmt = net * (li.vatRate / 100)
          return {
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            vatRate: li.vatRate,
            vatAmount: vatAmt,
            netAmount: net,
            grossAmount: net + vatAmt,
            costCenterId: li.costCenterId,
            accountingCode: li.accountingCode,
            sortOrder: idx,
          }
        }),
      } : undefined,
    },
    include: {
      supplier: true,
      vatCode: true,
      lineItems: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'CREATE',
      entityType: 'supplier_invoice',
      entityId: invoice.id,
      after: { invoiceNumber: invoice.invoiceNumber, grossAmount: Number(invoice.grossAmount), supplierId: invoice.supplierId },
    },
  })

  // Trigger approval workflow automatically
  const engine = await getApprovalEngine()
  await engine.initiate({
    entityType: 'supplier_invoice',
    entityId: invoice.id,
    organizationId: session.currentOrganizationId,
    amount: data.grossAmount,
    userId: session.id,
  })

  return NextResponse.json({
    data: invoice,
    warnings: duplicate ? [`Possible duplicate of invoice ${duplicate.invoiceNumber} from ${supplier.name}`] : [],
  }, { status: 201 })
}, 'manage:invoices')

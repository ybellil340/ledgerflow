export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

const ARLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number(),
  vatRate: z.number().min(0).max(100),
  costCenterId: z.string().cuid().optional(),
  accountingCode: z.string().optional(),
})

const CreateARInvoiceSchema = z.object({
  customerId: z.string().cuid(),
  invoiceNumber: z.string().min(1).max(100).optional(), // auto-generated if omitted
  issueDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  currency: z.string().length(3).default('EUR'),
  paymentTerms: z.number().int().min(0).default(30),
  notes: z.string().max(2000).optional(),
  isRecurring: z.boolean().default(false),
  recurringRule: z.object({
    frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
    endDate: z.string().optional(),
  }).optional(),
  lineItems: z.array(ARLineItemSchema).min(1),
})

// ─── GET /api/invoices/ar ────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '25'), 100)
  const status = searchParams.getAll('status')
  const customerId = searchParams.get('customerId')
  const isOverdue = searchParams.get('isOverdue')
  const search = searchParams.get('search')

  const where: Record<string, unknown> = {
    organizationId: session.currentOrganizationId,
    deletedAt: null,
  }

  if (status.length > 0) where.status = { in: status }
  if (customerId) where.customerId = customerId
  if (isOverdue === 'true') {
    where.dueDate = { lt: new Date() }
    where.status = { notIn: ['PAID', 'CANCELLED'] }
  }
  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [total, items] = await Promise.all([
    prisma.customerInvoice.count({ where }),
    prisma.customerInvoice.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, email: true, vatId: true } },
        lineItems: true,
        _count: { select: { comments: true } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  const statusSummary = await prisma.customerInvoice.groupBy({
    by: ['status'],
    where: { organizationId: session.currentOrganizationId, deletedAt: null },
    _count: { status: true },
    _sum: { total: true },
  })

  const overdueAmount = await prisma.customerInvoice.aggregate({
    where: {
      organizationId: session.currentOrganizationId,
      deletedAt: null,
      dueDate: { lt: new Date() },
      status: { notIn: ['PAID', 'CANCELLED'] },
    },
    _sum: { total: true },
    _count: { id: true },
  })

  return NextResponse.json({
    data: items,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    summary: {
      byStatus: statusSummary.map((s) => ({
        status: s.status,
        count: s._count.status,
        totalAmount: Number(s._sum.total ?? 0),
      })),
      overdueCount: overdueAmount._count.id,
      overdueAmount: Number(overdueAmount._sum.total ?? 0),
    },
  })
})

// ─── POST /api/invoices/ar ───────────────────

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const data = CreateARInvoiceSchema.parse(body)

  // Verify customer
  const customer = await prisma.customer.findFirst({
    where: { id: data.customerId, organizationId: session.currentOrganizationId },
  })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // Auto-generate invoice number if not provided
  let invoiceNumber = data.invoiceNumber
  if (!invoiceNumber) {
    const count = await prisma.customerInvoice.count({
      where: { organizationId: session.currentOrganizationId },
    })
    const year = new Date().getFullYear()
    invoiceNumber = `RE-${year}-${String(count + 1).padStart(4, '0')}`
  }

  // Check uniqueness
  const exists = await prisma.customerInvoice.findFirst({
    where: { organizationId: session.currentOrganizationId, invoiceNumber },
  })
  if (exists) return NextResponse.json({ error: `Invoice number ${invoiceNumber} already exists` }, { status: 409 })

  // Calculate totals from line items
  const lineItemsCalc = data.lineItems.map((li) => {
    const net = Math.round(li.quantity * li.unitPrice * 100) / 100
    const vatAmt = Math.round(net * (li.vatRate / 100) * 100) / 100
    return { ...li, net, vatAmt, gross: net + vatAmt }
  })

  const subtotal = lineItemsCalc.reduce((s, li) => s + li.net, 0)
  const vatAmount = lineItemsCalc.reduce((s, li) => s + li.vatAmt, 0)
  const invoiceTotal = Math.round((subtotal + vatAmount) * 100) / 100

  const invoice = await prisma.customerInvoice.create({
    data: {
      organizationId: session.currentOrganizationId,
      customerId: data.customerId,
      invoiceNumber,
      issueDate: new Date(data.issueDate),
      dueDate: new Date(data.dueDate),
      currency: data.currency,
      subtotal,
      vatAmount,
      total: invoiceTotal,
      paidAmount: 0,
      paymentTerms: data.paymentTerms,
      notes: data.notes,
      isRecurring: data.isRecurring,
      recurringRule: data.recurringRule ?? undefined,
      status: 'DRAFT',
      lineItems: {
        create: lineItemsCalc.map((li, idx) => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          vatRate: li.vatRate,
          vatAmount: li.vatAmt,
          netAmount: li.net,
          grossAmount: li.gross,
          costCenterId: li.costCenterId,
          accountingCode: li.accountingCode,
          sortOrder: idx,
        })),
      },
    },
    include: { customer: true, lineItems: true },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'CREATE',
      entityType: 'customer_invoice',
      entityId: invoice.id,
      after: { invoiceNumber: invoice.invoiceNumber, total: Number(invoice.total), customerId: invoice.customerId },
    },
  })

  return NextResponse.json({ data: invoice }, { status: 201 })
}, 'manage:invoices')

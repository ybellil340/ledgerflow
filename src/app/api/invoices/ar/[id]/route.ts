import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

type Params = { id: string }

export const GET = withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
  const invoice = await prisma.customerInvoice.findFirst({
    where: { id: params!.id, organizationId: session.currentOrganizationId, deletedAt: null },
    include: {
      customer: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      comments: {
        include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'asc' },
      },
      exportBatch: { select: { id: true, format: true, createdAt: true } },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  return NextResponse.json({ data: invoice })
})

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send') }),
  z.object({ action: z.literal('mark_viewed') }),
  z.object({ action: z.literal('record_payment'), amount: z.number().positive(), paymentDate: z.string().optional(), reference: z.string().optional() }),
  z.object({ action: z.literal('cancel'), reason: z.string().optional() }),
  z.object({ action: z.literal('create_credit_note'), amount: z.number().positive(), reason: z.string() }),
])

export const PATCH = withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
  const invoice = await prisma.customerInvoice.findFirst({
    where: { id: params!.id, organizationId: session.currentOrganizationId, deletedAt: null },
    include: { customer: true, lineItems: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  const body = await req.json()

  if (!body.action) {
    // Plain field update (draft only)
    if (invoice.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Only draft invoices can be edited' }, { status: 400 })
    }
    const UpdateSchema = z.object({
      dueDate: z.string().datetime().optional(),
      notes: z.string().optional(),
      paymentTerms: z.number().optional(),
    })
    const data = UpdateSchema.parse(body)
    const updated = await prisma.customerInvoice.update({
      where: { id: params!.id },
      data: { ...data, ...(data.dueDate ? { dueDate: new Date(data.dueDate) } : {}) },
      include: { customer: true, lineItems: true },
    })
    return NextResponse.json({ data: updated })
  }

  const parsed = ActionSchema.parse(body)

  switch (parsed.action) {
    case 'send': {
      if (!['DRAFT', 'OVERDUE'].includes(invoice.status)) {
        return NextResponse.json({ error: 'Invoice cannot be sent in current status' }, { status: 400 })
      }
      // TODO: generate PDF and email to customer
      const updated = await prisma.customerInvoice.update({
        where: { id: params!.id },
        data: { status: 'SENT', sentAt: new Date() },
        include: { customer: true, lineItems: true },
      })
      await prisma.auditLog.create({
        data: {
          organizationId: session.currentOrganizationId, actorId: session.id,
          action: 'UPDATE', entityType: 'customer_invoice', entityId: params!.id,
          before: { status: invoice.status }, after: { status: 'SENT' },
        },
      })
      return NextResponse.json({ data: updated, message: `Invoice sent to ${invoice.customer.email}` })
    }

    case 'mark_viewed': {
      const updated = await prisma.customerInvoice.update({
        where: { id: params!.id },
        data: { status: 'VIEWED', viewedAt: new Date() },
      })
      return NextResponse.json({ data: updated })
    }

    case 'record_payment': {
      const { amount, paymentDate, reference } = parsed
      const newPaid = Number(invoice.paidAmount) + amount
      const totalAmount = Number(invoice.total)
      const newStatus = newPaid >= totalAmount ? 'PAID' : 'PARTIALLY_PAID'

      const updated = await prisma.customerInvoice.update({
        where: { id: params!.id },
        data: {
          paidAmount: newPaid,
          status: newStatus,
          paidAt: newStatus === 'PAID' ? new Date() : undefined,
        },
        include: { customer: true, lineItems: true },
      })

      await prisma.auditLog.create({
        data: {
          organizationId: session.currentOrganizationId, actorId: session.id,
          action: 'UPDATE', entityType: 'customer_invoice', entityId: params!.id,
          before: { status: invoice.status, paidAmount: invoice.paidAmount },
          after: { status: newStatus, paidAmount: newPaid },
          metadata: { paymentAmount: amount, reference },
        },
      })

      // Notify on full payment
      if (newStatus === 'PAID') {
        const admins = await prisma.organizationMembership.findMany({
          where: { organizationId: session.currentOrganizationId, role: { in: ['COMPANY_ADMIN', 'FINANCE_MANAGER'] }, status: 'ACTIVE' },
        })
        for (const admin of admins) {
          await prisma.notification.create({
            data: {
              userId: admin.userId, organizationId: session.currentOrganizationId,
              type: 'invoice_paid', title: 'Invoice paid',
              message: `${invoice.customer.name} paid invoice ${invoice.invoiceNumber} (€${totalAmount.toFixed(2)})`,
              entityType: 'customer_invoice', entityId: params!.id,
            },
          })
        }
      }

      return NextResponse.json({ data: updated })
    }

    case 'cancel': {
      if (['PAID', 'CANCELLED'].includes(invoice.status)) {
        return NextResponse.json({ error: 'Cannot cancel this invoice' }, { status: 400 })
      }
      const updated = await prisma.customerInvoice.update({
        where: { id: params!.id },
        data: { status: 'CANCELLED' },
      })
      if (parsed.reason) {
        await prisma.comment.create({
          data: {
            authorId: session.id, content: `Cancelled: ${parsed.reason}`,
            entityType: 'customer_invoice', entityId: params!.id,
            customerInvoiceId: params!.id,
          },
        })
      }
      return NextResponse.json({ data: updated })
    }

    case 'create_credit_note': {
      // Generate a credit note (negative invoice)
      const count = await prisma.customerInvoice.count({ where: { organizationId: session.currentOrganizationId } })
      const year = new Date().getFullYear()
      const creditNumber = `KR-${year}-${String(count + 1).padStart(4, '0')}`

      const vatRate = invoice.lineItems[0]?.vatRate ? Number(invoice.lineItems[0].vatRate) : 19
      const net = Math.round((parsed.amount / (1 + vatRate / 100)) * 100) / 100
      const vatAmt = parsed.amount - net

      const creditNote = await prisma.customerInvoice.create({
        data: {
          organizationId: session.currentOrganizationId,
          customerId: invoice.customerId,
          invoiceNumber: creditNumber,
          issueDate: new Date(),
          dueDate: new Date(),
          currency: invoice.currency,
          subtotal: -net,
          vatAmount: -vatAmt,
          total: -parsed.amount,
          paidAmount: 0,
          paymentTerms: 0,
          notes: `Credit note for ${invoice.invoiceNumber}: ${parsed.reason}`,
          status: 'DRAFT',
          lineItems: {
            create: [{
              description: `Credit note for ${invoice.invoiceNumber}: ${parsed.reason}`,
              quantity: 1,
              unitPrice: -net,
              vatRate,
              vatAmount: -vatAmt,
              netAmount: -net,
              grossAmount: -parsed.amount,
              sortOrder: 0,
            }],
          },
        },
        include: { customer: true, lineItems: true },
      })

      return NextResponse.json({ data: creditNote, message: `Credit note ${creditNumber} created` }, { status: 201 })
    }
  }
}, 'manage:invoices')

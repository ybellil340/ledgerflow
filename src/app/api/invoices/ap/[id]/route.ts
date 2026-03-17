import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

type Params = { id: string }

// ─── GET /api/invoices/ap/[id] ───────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
  const invoice = await prisma.supplierInvoice.findFirst({
    where: { id: params!.id, organizationId: session.currentOrganizationId, deletedAt: null },
    include: {
      supplier: true,
      vatCode: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      attachments: true,
      comments: {
        include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'asc' },
      },
      exportBatch: { select: { id: true, format: true, createdAt: true, status: true } },
    },
  })

  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  return NextResponse.json({ data: invoice })
})

// ─── PATCH /api/invoices/ap/[id] ────────────

const ActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'mark_paid', 'schedule_payment', 'cancel']),
  reason: z.string().optional(),
  paidAmount: z.number().optional(),
  paymentRef: z.string().optional(),
  comment: z.string().optional(),
})

export const PATCH = withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
  const invoice = await prisma.supplierInvoice.findFirst({
    where: { id: params!.id, organizationId: session.currentOrganizationId, deletedAt: null },
    include: { supplier: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  const body = await req.json()

  // If it's an action, handle it
  if (body.action) {
    const { action, reason, paidAmount, paymentRef, comment } = ActionSchema.parse(body)
    return handleInvoiceAction({ invoice, action, reason, paidAmount, paymentRef, comment, session })
  }

  // Otherwise, update fields
  if (!['DRAFT', 'PENDING_APPROVAL'].includes(invoice.status)) {
    return NextResponse.json({ error: 'Cannot edit invoice in current status' }, { status: 400 })
  }

  const UpdateSchema = z.object({
    invoiceDate: z.string().datetime().optional(),
    dueDate: z.string().datetime().optional(),
    grossAmount: z.number().positive().optional(),
    vatAmount: z.number().min(0).optional(),
    netAmount: z.number().min(0).optional(),
    vatCodeId: z.string().cuid().optional(),
    categoryId: z.string().optional(),
    notes: z.string().max(2000).optional(),
  })

  const data = UpdateSchema.parse(body)
  const before = { grossAmount: invoice.grossAmount, status: invoice.status }

  const updated = await prisma.supplierInvoice.update({
    where: { id: params!.id },
    data: {
      ...data,
      ...(data.invoiceDate ? { invoiceDate: new Date(data.invoiceDate) } : {}),
      ...(data.dueDate ? { dueDate: new Date(data.dueDate) } : {}),
    },
    include: { supplier: true, vatCode: true, lineItems: true },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'UPDATE',
      entityType: 'supplier_invoice',
      entityId: params!.id,
      before,
      after: { grossAmount: updated.grossAmount, status: updated.status },
    },
  })

  return NextResponse.json({ data: updated })
}, 'manage:invoices')

// ─── DELETE /api/invoices/ap/[id] ────────────

export const DELETE = withAuth(async (req: NextRequest, session: SessionUser, params?: Params) => {
  const invoice = await prisma.supplierInvoice.findFirst({
    where: { id: params!.id, organizationId: session.currentOrganizationId, deletedAt: null },
  })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (['PAID', 'EXPORTED'].includes(invoice.status)) {
    return NextResponse.json({ error: 'Cannot delete a paid or exported invoice' }, { status: 400 })
  }

  await prisma.supplierInvoice.update({ where: { id: params!.id }, data: { deletedAt: new Date() } })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'DELETE',
      entityType: 'supplier_invoice',
      entityId: params!.id,
    },
  })

  return NextResponse.json({ data: { success: true } })
}, 'manage:invoices')

// ─── ACTION HANDLER ──────────────────────────

async function handleInvoiceAction({
  invoice, action, reason, paidAmount, paymentRef, comment, session,
}: {
  invoice: { id: string; status: string; grossAmount: unknown; supplierId: string; supplier: { name: string }; organizationId: string }
  action: string
  reason?: string
  paidAmount?: number
  paymentRef?: string
  comment?: string
  session: SessionUser
}): Promise<NextResponse> {

  const requiresApproverRole = ['approve', 'reject'].includes(action)
  if (requiresApproverRole && !['COMPANY_ADMIN', 'FINANCE_MANAGER', 'APPROVER', 'SUPER_ADMIN'].includes(session.currentRole)) {
    return NextResponse.json({ error: 'Forbidden — approval role required' }, { status: 403 })
  }

  let newStatus: string
  let auditAction: 'APPROVE' | 'REJECT' | 'UPDATE' = 'UPDATE'

  switch (action) {
    case 'approve':
      if (!['DRAFT', 'PENDING_APPROVAL'].includes(invoice.status)) {
        return NextResponse.json({ error: `Cannot approve invoice with status ${invoice.status}` }, { status: 400 })
      }
      newStatus = 'APPROVED'
      auditAction = 'APPROVE'
      break

    case 'reject':
      newStatus = 'DRAFT' // Send back to draft for revision
      auditAction = 'REJECT'
      if (reason) {
        await prisma.comment.create({
          data: {
            authorId: session.id,
            content: `Rejected: ${reason}`,
            entityType: 'supplier_invoice',
            entityId: invoice.id,
            supplierInvoiceId: invoice.id,
            visibility: 'INTERNAL',
          },
        })
      }
      break

    case 'schedule_payment':
      if (invoice.status !== 'APPROVED') {
        return NextResponse.json({ error: 'Invoice must be approved before scheduling payment' }, { status: 400 })
      }
      newStatus = 'SCHEDULED_PAYMENT'
      break

    case 'mark_paid':
      newStatus = 'PAID'
      break

    case 'cancel':
      if (['PAID', 'EXPORTED'].includes(invoice.status)) {
        return NextResponse.json({ error: 'Cannot cancel a paid or exported invoice' }, { status: 400 })
      }
      newStatus = 'CANCELLED'
      break

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const updated = await prisma.supplierInvoice.update({
    where: { id: invoice.id },
    data: {
      status: newStatus as never,
      approvalStatus: auditAction === 'APPROVE' ? 'APPROVED' : auditAction === 'REJECT' ? 'REJECTED' : undefined,
      ...(action === 'mark_paid' ? {
        paidAt: new Date(),
        paidAmount: paidAmount ?? Number(invoice.grossAmount),
        paymentRef,
      } : {}),
    },
    include: { supplier: true, vatCode: true, lineItems: true },
  })

  if (comment) {
    await prisma.comment.create({
      data: {
        authorId: session.id,
        content: comment,
        entityType: 'supplier_invoice',
        entityId: invoice.id,
        supplierInvoiceId: invoice.id,
      },
    })
  }

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: auditAction,
      entityType: 'supplier_invoice',
      entityId: invoice.id,
      before: { status: invoice.status },
      after: { status: newStatus },
      metadata: { reason, paymentRef },
    },
  })

  // Notify finance team of payment
  if (action === 'mark_paid') {
    const admins = await prisma.organizationMembership.findMany({
      where: { organizationId: session.currentOrganizationId, role: { in: ['COMPANY_ADMIN', 'FINANCE_MANAGER'] }, status: 'ACTIVE' },
    })
    for (const admin of admins) {
      await prisma.notification.create({
        data: {
          userId: admin.userId,
          organizationId: session.currentOrganizationId,
          type: 'invoice_paid',
          title: `Invoice paid — ${invoice.supplier.name}`,
          message: `Invoice marked as paid: ${invoice.supplier.name} — €${Number(invoice.grossAmount).toFixed(2)}`,
          entityType: 'supplier_invoice',
          entityId: invoice.id,
        },
      })
    }
  }

  return NextResponse.json({ data: updated })
}

/**
 * GET /api/invoices/ar/[id]/pdf
 *
 * Returns a PDF (or HTML) of the customer invoice.
 *
 * Query params:
 *   ?format=pdf   (default) — PDF binary, triggers download
 *   ?format=html  — HTML for browser preview / print
 *   ?format=preview — HTML with print button injected
 *
 * The HTML response is used when puppeteer is unavailable (dev mode, no Chrome).
 * The client should fall back gracefully: try PDF, if 501 show HTML.
 *
 * Auth: session user must belong to the organization that owns the invoice.
 * Tax advisors with access to the org can also download.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { generateInvoiceHTML, generateInvoicePDF, buildInvoiceData } from '@/lib/services/pdf-invoice'
import type { SessionUser } from '@/types'

export const GET = withAuth(async (
  req: NextRequest,
  session: SessionUser,
  { params }: { params: { id: string } }
) => {
  const { searchParams } = new URL(req.url)
  const format = searchParams.get('format') ?? 'pdf'

  // Fetch invoice with all required relations
  const invoice = await prisma.customerInvoice.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      lineItems: {
        include: { vatCode: true },
        orderBy: { position: 'asc' },
      },
      organization: {
        select: {
          id: true, name: true, legalForm: true, street: true, city: true,
          postalCode: true, country: true, vatId: true, taxNumber: true,
          email: true, phone: true, website: true,
          // Banking details for payment block
          bankName: true, iban: true, bic: true,
          isSmallBusiness: true,
        },
      },
    },
  })

  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  // Org access check
  if (invoice.organizationId !== session.currentOrganizationId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Build typed invoice data
  const invoiceData = buildInvoiceData({
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    serviceDate: invoice.serviceDate,
    currency: invoice.currency,
    notes: invoice.notes,
    totalAmount: Number(invoice.totalAmount),
    netAmount: Number(invoice.netAmount),
    vatAmount: Number(invoice.vatAmount),
    paidAmount: Number(invoice.paidAmount ?? 0),
    lineItems: invoice.lineItems.map(li => ({
      position: li.position,
      description: li.description,
      quantity: Number(li.quantity),
      unit: li.unit,
      unitPrice: Number(li.unitNetPrice),
      netAmount: Number(li.netAmount),
      vatRate: Number(li.vatRate),
      vatAmount: Number(li.vatAmount),
      grossAmount: Number(li.grossAmount),
      serviceDate: li.serviceDate,
    })),
    organization: invoice.organization,
    customer: invoice.customer,
  })

  const filename = `${invoice.invoiceNumber.replace(/[^A-Za-z0-9-_]/g, '_')}.pdf`

  // HTML preview mode
  if (format === 'html' || format === 'preview') {
    let html = generateInvoiceHTML(invoiceData)

    if (format === 'preview') {
      // Inject print button + back button for browser preview
      html = html.replace('</body>', `
      <div style="position:fixed;top:16px;right:16px;display:flex;gap:8px;z-index:100">
        <button onclick="window.print()" style="padding:8px 18px;border:none;border-radius:8px;background:#1a1a2e;color:#eaeaf8;font-size:13px;font-weight:500;cursor:pointer">🖨 Print / Save as PDF</button>
        <button onclick="window.close()" style="padding:8px 14px;border:.5px solid #e0e0e0;border-radius:8px;background:#fff;font-size:13px;cursor:pointer">✕ Close</button>
      </div>
      </body>`)
    }

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }

  // PDF mode
  const pdfBuffer = await generateInvoicePDF(invoiceData)

  if (!pdfBuffer) {
    // Puppeteer unavailable — return HTML with instructions
    return new Response(generateInvoiceHTML(invoiceData), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-PDF-Fallback': 'true',
        'X-PDF-Fallback-Reason': 'puppeteer-unavailable',
      },
    })
  }

  // Track that invoice was downloaded (for delivery confirmation in AR workflow)
  await prisma.customerInvoice.update({
    where: { id: params.id },
    data: { lastDownloadedAt: new Date() },
  }).catch(() => {}) // Non-critical, don't fail the response

  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length.toString(),
      'Cache-Control': 'no-store',
    },
  })
})

// ─────────────────────────────────────────────
// POST /api/invoices/ar/[id]/pdf — send via email
// ─────────────────────────────────────────────

export const POST = withAuth(async (
  req: NextRequest,
  session: SessionUser,
  { params }: { params: { id: string } }
) => {
  const { action } = await req.json()

  if (action === 'send_by_email') {
    const invoice = await prisma.customerInvoice.findUnique({
      where: { id: params.id },
      include: {
        customer: { select: { name: true, email: true } },
        organization: { select: { name: true, email: true } },
      },
    })

    if (!invoice || invoice.organizationId !== session.currentOrganizationId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (!invoice.customer.email) {
      return NextResponse.json({ error: 'Customer has no email address' }, { status: 400 })
    }

    // Generate PDF
    const pdfData = buildInvoiceData({
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      serviceDate: null,
      currency: invoice.currency,
      notes: invoice.notes,
      totalAmount: Number(invoice.totalAmount),
      netAmount: Number(invoice.netAmount),
      vatAmount: Number(invoice.vatAmount),
      paidAmount: Number(invoice.paidAmount ?? 0),
      lineItems: [],
      organization: invoice.organization as Parameters<typeof buildInvoiceData>[0]['organization'],
      customer: invoice.customer,
    })

    const pdfBuffer = await generateInvoicePDF(pdfData)

    // Use email adapter
    const { emailAdapter } = await import('@/lib/integrations/adapters')
    await emailAdapter.sendInvoice({
      to: invoice.customer.email,
      fromName: invoice.organization.name,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customer.name,
      amount: Number(invoice.totalAmount),
      currency: invoice.currency,
      dueDate: invoice.dueDate.toISOString().split('T')[0],
      pdfBuffer: pdfBuffer ?? undefined,
    })

    // Update status to SENT if still DRAFT
    if (invoice.status === 'DRAFT') {
      await prisma.customerInvoice.update({
        where: { id: params.id },
        data: { status: 'SENT', sentAt: new Date() },
      })
    }

    return NextResponse.json({ data: { success: true, sentTo: invoice.customer.email } })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
})

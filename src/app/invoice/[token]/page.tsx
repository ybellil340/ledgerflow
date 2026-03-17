export const dynamic = 'force-dynamic'


export async function generateStaticParams() { return [] }
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Metadata } from 'next'

// ─── Data fetcher ──────────────────────────────────────────────────────────────

async function getInvoiceByToken(token: string) {
  const invoice = await prisma.customerInvoice.findFirst({
    where: { publicToken: token },
    include: {
      organization: {
        select: {
          name: true,
          address: true,
          city: true,
          postalCode: true,
          country: true,
          vatId: true,
          email: true,
          phone: true,
          website: true,
          iban: true,
          bankName: true,
          bic: true,
          logoUrl: true,
        },
      },
      customer: {
        select: {
          name: true,
          address: true,
          city: true,
          postalCode: true,
          country: true,
          vatId: true,
        },
      },
      lineItems: true,
    },
  })

  if (!invoice) return null

  // Mark as viewed (fire-and-forget)
  if (invoice.status === 'SENT') {
    prisma.customerInvoice
      .update({
        where: { id: invoice.id },
        data: { status: 'VIEWED', viewedAt: new Date() },
      })
      .catch(() => {})
  }

  return invoice
}

// ─── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: { token: string }
}): Promise<Metadata> {
  const invoice = await getInvoiceByToken(params.token)
  if (!invoice) return { title: 'Invoice not found' }
  return {
    title: `Invoice ${invoice.invoiceNumber} from ${invoice.organization.name}`,
    robots: { index: false, follow: false },
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatEUR(amount: number | string | { toNumber(): number }): string {
  const n = typeof amount === 'object' ? amount.toNumber() : Number(amount)
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(n)
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

// ─── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  SENT: 'bg-blue-100 text-blue-700',
  VIEWED: 'bg-blue-100 text-blue-700',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-700',
  PAID: 'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-100 text-red-700',
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function InvoicePortalPage({
  params,
}: {
  params: { token: string }
}) {
  const invoice = await getInvoiceByToken(params.token)
  if (!invoice) notFound()

  const org = invoice.organization
  const cust = invoice.customer
  const outstanding = Number(invoice.totalAmount) - Number(invoice.paidAmount)
  const isPaid = invoice.status === 'PAID' || outstanding <= 0
  const isOverdue = invoice.status === 'OVERDUE'

  // Compute VAT breakdown
  const vatBreakdown = invoice.lineItems.reduce(
    (acc: Record<number, { net: number; vat: number }>, item) => {
      const rate = Number(item.vatRate)
      const net = Number(item.quantity) * Number(item.unitPrice)
      const vat = (net * rate) / 100
      if (!acc[rate]) acc[rate] = { net: 0, vat: 0 }
      acc[rate].net += net
      acc[rate].vat += vat
      return acc
    },
    {}
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div
        className="h-1.5 w-full"
        style={{ background: isPaid ? '#3B6D11' : isOverdue ? '#A32D2D' : '#185FA5' }}
      />

      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Header — issuer branding */}
        <div className="flex items-center justify-between mb-8">
          <div>
            {org.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logoUrl} alt={org.name} className="h-10 object-contain" />
            ) : (
              <div className="text-xl font-semibold text-gray-900">{org.name}</div>
            )}
          </div>
          <div>
            <span
              className={`text-xs font-semibold px-3 py-1 rounded-full ${STATUS_STYLES[invoice.status] ?? STATUS_STYLES.SENT}`}
            >
              {isPaid ? '✓ Paid' : isOverdue ? '⚠ Overdue' : invoice.status.charAt(0) + invoice.status.slice(1).toLowerCase()}
            </span>
          </div>
        </div>

        {/* Invoice card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Invoice header */}
          <div className="px-8 pt-8 pb-6 border-b border-gray-100">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Invoice</div>
                <div className="text-2xl font-medium text-gray-900">{invoice.invoiceNumber}</div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-medium" style={{ color: isPaid ? '#3B6D11' : isOverdue ? '#A32D2D' : '#185FA5' }}>
                  {formatEUR(invoice.totalAmount)}
                </div>
                {!isPaid && (
                  <div className="text-sm text-gray-400 mt-0.5">
                    {isOverdue ? 'Was due' : 'Due'}: {formatDate(invoice.dueDate)}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Addresses */}
          <div className="grid grid-cols-2 gap-6 px-8 py-6 border-b border-gray-100">
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">From</div>
              <div className="text-sm font-medium text-gray-800">{org.name}</div>
              {org.address && <div className="text-sm text-gray-500">{org.address}</div>}
              {(org.postalCode || org.city) && (
                <div className="text-sm text-gray-500">{[org.postalCode, org.city].filter(Boolean).join(' ')}</div>
              )}
              {org.vatId && <div className="text-xs text-gray-400 mt-1">VAT ID: {org.vatId}</div>}
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">To</div>
              <div className="text-sm font-medium text-gray-800">{cust?.name ?? invoice.customerName}</div>
              {cust?.city && <div className="text-sm text-gray-500">{cust.city}</div>}
              {cust?.vatId && <div className="text-xs text-gray-400 mt-1">VAT ID: {cust.vatId}</div>}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-4 px-8 py-4 bg-gray-50 border-b border-gray-100 text-sm">
            <div>
              <div className="text-xs text-gray-400 mb-0.5">Invoice date</div>
              <div className="font-medium">{formatDate(invoice.issueDate)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-0.5">Due date</div>
              <div className={`font-medium ${isOverdue ? 'text-red-600' : ''}`}>
                {formatDate(invoice.dueDate)}
              </div>
            </div>
            {invoice.paidAmount > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-0.5">Paid</div>
                <div className="font-medium text-green-700">{formatEUR(invoice.paidAmount)}</div>
              </div>
            )}
          </div>

          {/* Line items */}
          <div className="px-8 py-6 border-b border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wide">
                  <th className="text-left pb-3 font-medium">Description</th>
                  <th className="text-right pb-3 font-medium w-16">Qty</th>
                  <th className="text-right pb-3 font-medium w-24">Unit price</th>
                  <th className="text-right pb-3 font-medium w-12">VAT</th>
                  <th className="text-right pb-3 font-medium w-24">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoice.lineItems.map((item, i) => {
                  const net = Number(item.quantity) * Number(item.unitPrice)
                  const gross = net * (1 + Number(item.vatRate) / 100)
                  return (
                    <tr key={i}>
                      <td className="py-3 text-gray-800">{item.description}</td>
                      <td className="py-3 text-right text-gray-500">{Number(item.quantity)}</td>
                      <td className="py-3 text-right text-gray-500">{formatEUR(item.unitPrice)}</td>
                      <td className="py-3 text-right text-gray-500">{Number(item.vatRate)}%</td>
                      <td className="py-3 text-right font-medium">{formatEUR(gross)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="px-8 py-5 border-b border-gray-100">
            <div className="max-w-xs ml-auto space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Net total</span>
                <span>{formatEUR(invoice.netAmount)}</span>
              </div>

              {/* VAT breakdown */}
              {Object.entries(vatBreakdown).map(([rate, amounts]) => (
                <div key={rate} className="flex justify-between text-gray-500">
                  <span>VAT {rate}%</span>
                  <span>{formatEUR(amounts.vat)}</span>
                </div>
              ))}

              <div className="flex justify-between font-semibold text-base pt-2 border-t border-gray-200">
                <span>Total</span>
                <span>{formatEUR(invoice.totalAmount)}</span>
              </div>

              {!isPaid && outstanding < Number(invoice.totalAmount) && (
                <div className="flex justify-between text-blue-700 font-medium">
                  <span>Outstanding</span>
                  <span>{formatEUR(outstanding)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Payment block */}
          {!isPaid && (
            <div
              className="px-8 py-6 border-b border-gray-100"
              style={{ background: isOverdue ? '#FEF2F2' : '#F0F7FF' }}
            >
              <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: isOverdue ? '#A32D2D' : '#0C447C' }}>
                {isOverdue ? '⚠ Payment overdue' : 'Payment details'}
              </div>

              {org.iban ? (
                <div className="space-y-1.5 text-sm">
                  {[
                    ['Account holder', org.name],
                    ['IBAN', org.iban],
                    ['BIC', org.bic ?? '—'],
                    ['Bank', org.bankName ?? '—'],
                    ['Reference', invoice.invoiceNumber],
                    ['Amount due', formatEUR(outstanding)],
                    ['Due date', formatDate(invoice.dueDate)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex gap-4">
                      <span className="text-gray-400 w-32 flex-shrink-0">{label}</span>
                      <span className={`font-medium font-mono ${label === 'IBAN' ? 'tracking-wide' : ''}`}>{value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  Please contact {org.email ?? org.name} for payment details.
                </p>
              )}

              {isOverdue && (
                <div className="mt-3 text-xs text-red-600">
                  Pursuant to §286 BGB, statutory default interest applies from the due date.
                  Please arrange payment as soon as possible or contact us to discuss.
                </div>
              )}
            </div>
          )}

          {/* Paid state */}
          {isPaid && (
            <div className="px-8 py-6 border-b border-gray-100 bg-green-50 text-center">
              <div className="text-2xl mb-1">✅</div>
              <div className="font-semibold text-green-700">Invoice fully paid</div>
              <div className="text-sm text-gray-500 mt-1">Thank you for your payment.</div>
            </div>
          )}

          {/* Footer — notes, actions */}
          <div className="px-8 py-5">
            {invoice.notes && (
              <p className="text-xs text-gray-400 mb-4 leading-relaxed">{invoice.notes}</p>
            )}

            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="text-xs text-gray-400">
                <span className="font-medium">{org.name}</span>
                {org.address && ` - ${org.address}`}
                {org.city && `, ${org.city}`}
                {org.vatId && ` - VAT ${org.vatId}`}
              </div>

              <a
                href={`/api/invoices/ar/${invoice.id}/pdf?token=${params.token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1v8M4 6l3 3 3-3M2 11h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download PDF
              </a>
            </div>
          </div>
        </div>

        {/* Powered by LedgerFlow */}
        <div className="text-center mt-8 text-xs text-gray-300">
          Sent via{' '}
          <a href="https://ledgerflow.de" target="_blank" rel="noopener noreferrer" className="hover:text-gray-500 transition-colors">
            LedgerFlow
          </a>
          {' '}- Financial OS for German SMEs
        </div>
      </div>
    </div>
  )
}

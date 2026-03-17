'use client'

import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { arInvoicesApi } from '@/lib/api/endpoints'
import { useAuth } from '@/lib/store/auth'
import { useToast } from '@/components/providers/error-system'
import {
  Button, Badge, Modal, Input, Select, Textarea, Card,
  Spinner, EmptyState, Amount, Table,
} from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

type ARStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED'

interface LineItem {
  description: string
  quantity: number
  unitPrice: number
  vatRate: number
}

interface ARInvoice {
  id: string
  invoiceNumber: string
  customer: { id: string; name: string; email?: string; vatId?: string }
  issueDate: string
  dueDate: string
  lineItems: LineItem[]
  netAmount: number
  vatAmount: number
  totalAmount: number
  paidAmount: number
  currency: string
  status: ARStatus
  notes?: string
  sentAt?: string
  viewedAt?: string
  publicToken?: string
}

const VAT_RATES = [
  { value: 19, label: '19%' },
  { value: 7, label: '7%' },
  { value: 0, label: '0% (exempt)' },
]

// ─── Line item builder ─────────────────────────────────────────────────────────

function LineItemBuilder({
  items,
  onChange,
}: {
  items: LineItem[]
  onChange(items: LineItem[]): void
}) {
  function update(idx: number, field: keyof LineItem, val: string | number) {
    const next = items.map((item, i) => i === idx ? { ...item, [field]: val } : item)
    onChange(next)
  }

  function addItem() {
    onChange([...items, { description: '', quantity: 1, unitPrice: 0, vatRate: 19 }])
  }

  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const vat = items.reduce((s, i) => s + (i.quantity * i.unitPrice * i.vatRate) / 100, 0)
  const total = subtotal + vat

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="f-label">Line items *</span>
        <button className="text-xs text-blue-600 hover:underline" onClick={addItem}>+ Add line</button>
      </div>

      <div className="space-y-1.5 mb-3">
        {items.map((item, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
            <div className="col-span-5">
              <Input
                value={item.description}
                onChange={(v) => update(idx, 'description', v)}
                placeholder="Description..."
                size="sm"
              />
            </div>
            <div className="col-span-1">
              <Input
                type="number"
                value={String(item.quantity)}
                onChange={(v) => update(idx, 'quantity', parseFloat(v) || 0)}
                placeholder="Qty"
                size="sm"
              />
            </div>
            <div className="col-span-2">
              <Input
                type="number"
                value={String(item.unitPrice)}
                onChange={(v) => update(idx, 'unitPrice', parseFloat(v) || 0)}
                placeholder="Unit €"
                size="sm"
              />
            </div>
            <div className="col-span-2">
              <Select
                value={String(item.vatRate)}
                onChange={(v) => update(idx, 'vatRate', parseFloat(v))}
                options={VAT_RATES.map((r) => ({ value: String(r.value), label: r.label }))}
                size="sm"
              />
            </div>
            <div className="col-span-1 text-right text-xs text-gray-500 font-medium">
              €{((item.quantity * item.unitPrice) * (1 + item.vatRate / 100)).toFixed(0)}
            </div>
            <div className="col-span-1 flex justify-end">
              <button
                onClick={() => removeItem(idx)}
                className="text-gray-300 hover:text-red-400 text-sm"
              >✕</button>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t pt-2 space-y-0.5 text-xs text-right text-gray-500">
        <div>Subtotal: <span className="font-medium text-gray-700">€{subtotal.toFixed(2)}</span></div>
        <div>VAT: <span className="font-medium text-gray-700">€{vat.toFixed(2)}</span></div>
        <div className="text-sm font-semibold text-gray-800 mt-1">
          Total: €{total.toFixed(2)}
        </div>
      </div>
    </div>
  )
}

// ─── New AR invoice modal ──────────────────────────────────────────────────────

function NewARInvoiceModal({ onClose, onSuccess }: { onClose(): void; onSuccess(): void }) {
  const [form, setForm] = useState({
    customerId: '',
    customerName: '',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    notes: '',
  })
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: '', quantity: 1, unitPrice: 0, vatRate: 19 },
  ])
  const { toast } = useToast()
  const mutation = useMutation()

  // Auto-compute due date (30 days default)
  useEffect(() => {
    if (form.issueDate) {
      const due = new Date(form.issueDate)
      due.setDate(due.getDate() + 30)
      setForm((f) => ({ ...f, dueDate: due.toISOString().slice(0, 10) }))
    }
  }, [form.issueDate])

  async function submit(asDraft = false) {
    if (!form.customerName || lineItems.every((i) => !i.description)) {
      toast({ type: 'error', message: 'Customer name and at least one line item are required' })
      return
    }
    try {
      await mutation.mutate(() =>
        arInvoicesApi.create({
          customerName: form.customerName,
          issueDate: form.issueDate,
          dueDate: form.dueDate,
          lineItems,
          notes: form.notes || undefined,
          status: asDraft ? 'DRAFT' : 'DRAFT', // transitions to SENT on send action
        })
      )
      toast({ type: 'success', message: asDraft ? 'Invoice saved as draft' : 'Invoice created — ready to send' })
      invalidateQuery('ar-invoices')
      onSuccess()
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <Modal title="New customer invoice" subtitle="Auto-numbered on save (RE-YYYY-NNNN)" onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <label className="f-label">Customer *</label>
          <Input
            value={form.customerName}
            onChange={(v) => setForm((f) => ({ ...f, customerName: v }))}
            placeholder="Search customer or enter name..."
          />
        </div>
        <div className="f-row f-2">
          <div>
            <label className="f-label">Issue date</label>
            <Input type="date" value={form.issueDate} onChange={(v) => setForm((f) => ({ ...f, issueDate: v }))} />
          </div>
          <div>
            <label className="f-label">Due date</label>
            <Input type="date" value={form.dueDate} onChange={(v) => setForm((f) => ({ ...f, dueDate: v }))} />
          </div>
        </div>

        <LineItemBuilder items={lineItems} onChange={setLineItems} />

        <div>
          <label className="f-label">Notes / payment instructions</label>
          <Textarea value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} rows={2} placeholder="IBAN: DE89 3704 0044 0532 0130 00 - Reference: please include invoice number" />
        </div>
      </div>
      <div className="flex gap-2 mt-5 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="ghost" onClick={() => submit(true)} loading={mutation.isLoading}>Save draft</Button>
        <Button variant="primary" onClick={() => submit(false)} loading={mutation.isLoading}>Create invoice</Button>
      </div>
    </Modal>
  )
}

// ─── Record payment modal ──────────────────────────────────────────────────────

function RecordPaymentModal({ invoice, onClose }: { invoice: ARInvoice; onClose(): void }) {
  const outstanding = invoice.totalAmount - invoice.paidAmount
  const [amount, setAmount] = useState(String(outstanding.toFixed(2)))
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState('')
  const { toast } = useToast()
  const mutation = useMutation()

  async function submit() {
    try {
      await mutation.mutate(() =>
        arInvoicesApi.recordPayment(invoice.id, {
          amount: parseFloat(amount),
          paymentDate,
          reference: reference || undefined,
        })
      )
      const isFullPay = parseFloat(amount) >= outstanding
      toast({ type: 'success', message: isFullPay ? 'Invoice marked as paid' : `Partial payment of €${amount} recorded` })
      invalidateQuery('ar-invoices')
      onClose()
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <Modal title="Record payment" subtitle={`${invoice.customer.name} - ${invoice.invoiceNumber}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="p-3 bg-gray-50 rounded-lg text-sm">
          <div className="flex justify-between mb-1">
            <span className="text-gray-500">Invoice total</span>
            <span className="font-medium"><Amount value={invoice.totalAmount} /></span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-gray-500">Already paid</span>
            <span className="font-medium text-green-700"><Amount value={invoice.paidAmount} /></span>
          </div>
          <div className="flex justify-between border-t pt-1">
            <span className="text-gray-600 font-medium">Outstanding</span>
            <span className="font-semibold text-blue-700"><Amount value={outstanding} /></span>
          </div>
        </div>
        <div>
          <label className="f-label">Amount received (€)</label>
          <Input type="number" value={amount} onChange={setAmount} />
        </div>
        <div>
          <label className="f-label">Payment date</label>
          <Input type="date" value={paymentDate} onChange={setPaymentDate} />
        </div>
        <div>
          <label className="f-label">Reference / transaction ID</label>
          <Input value={reference} onChange={setReference} placeholder="Bank transaction reference..." />
        </div>
      </div>
      <div className="flex gap-2 mt-4 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={mutation.isLoading}>Record payment</Button>
      </div>
    </Modal>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function ARInvoicesPage() {
  const { can } = useAuth()
  const { toast } = useToast()
  const [showNewModal, setShowNewModal] = useState(false)
  const [payingInvoice, setPayingInvoice] = useState<ARInvoice | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const { data: invoices, isLoading } = useQuery<ARInvoice[]>(
    'ar-invoices',
    () => arInvoicesApi.list({ limit: 100 })
  )

  const handleSend = useCallback(async (id: string) => {
    try {
      await arInvoicesApi.send(id)
      toast({ type: 'success', message: 'Invoice sent to customer' })
      invalidateQuery('ar-invoices')
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }, [toast])

  const filtered = statusFilter === 'all'
    ? (invoices ?? [])
    : (invoices ?? []).filter((i) => i.status === statusFilter)

  const totalRevenue = (invoices ?? []).filter(i => i.status === 'PAID').reduce((s, i) => s + i.totalAmount, 0)
  const outstanding = (invoices ?? []).filter(i => !['PAID', 'CANCELLED', 'DRAFT'].includes(i.status)).reduce((s, i) => s + (i.totalAmount - i.paidAmount), 0)
  const overdueCount = (invoices ?? []).filter(i => i.status === 'OVERDUE').length

  const statusFilters: { label: string; value: string }[] = [
    { label: 'All', value: 'all' },
    { label: 'Draft', value: 'DRAFT' },
    { label: 'Sent', value: 'SENT' },
    { label: 'Partially paid', value: 'PARTIALLY_PAID' },
    { label: 'Paid', value: 'PAID' },
    { label: 'Overdue', value: 'OVERDUE' },
  ]

  return (
    <AppShell
      title="Customer Invoices (AR)"
      subtitle="Accounts receivable"
      action={<Button variant="primary" onClick={() => setShowNewModal(true)}>+ New invoice</Button>}
    >
      {/* KPIs */}
      <div className="krow k4 mb-4">
        <Card kpi label="Revenue collected" value={<Amount value={totalRevenue} />} valueColor="green" />
        <Card kpi label="Outstanding" value={<Amount value={outstanding} />} valueColor="blue" />
        <Card kpi label="Overdue invoices" value={overdueCount} valueColor="red" />
        <Card kpi label="Total invoices" value={(invoices ?? []).length} />
      </div>

      {/* Filters */}
      <div className="filter-row mb-3">
        {statusFilters.map((f) => (
          <button
            key={f.value}
            className={`fchip${statusFilter === f.value ? ' on' : ''}`}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !filtered.length ? (
        <EmptyState
          title={statusFilter === 'all' ? 'No invoices yet' : `No ${statusFilter.toLowerCase()} invoices`}
          description="Create your first customer invoice to start tracking AR."
          action={statusFilter === 'all' ? <Button variant="primary" onClick={() => setShowNewModal(true)}>+ New invoice</Button> : undefined}
        />
      ) : (
        <Card className="p-0">
          <Table
            columns={['Customer', 'Invoice #', 'Issued', 'Due date', 'VAT', 'Net', 'Total', 'Paid', 'Status', '']}
            rows={filtered.map((inv) => [
              <span key="cust" className="font-medium text-sm">{inv.customer.name}</span>,
              <span key="num" className="font-mono text-xs text-gray-500">{inv.invoiceNumber}</span>,
              inv.issueDate,
              <span key="due" className={inv.status === 'OVERDUE' ? 'text-red-500 font-medium' : 'text-gray-400'}>
                {inv.dueDate}
              </span>,
              <Amount key="vat" value={inv.vatAmount} className="text-gray-400" />,
              <Amount key="net" value={inv.netAmount} />,
              <Amount key="total" value={inv.totalAmount} className="font-medium" />,
              <Amount
                key="paid"
                value={inv.paidAmount}
                className={inv.paidAmount >= inv.totalAmount ? 'text-green-600' : inv.paidAmount > 0 ? 'text-blue-600' : 'text-gray-400'}
              />,
              <Badge key="st" status={inv.status as any} />,
              <div key="act" className="flex gap-1">
                {inv.status === 'DRAFT' && (
                  <button className="apb apb-y text-xs" onClick={() => handleSend(inv.id)}>Send</button>
                )}
                {['SENT', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status) && (
                  <button className="apb apb-y text-xs" onClick={() => setPayingInvoice(inv)}>
                    Record payment
                  </button>
                )}
                {inv.publicToken && (
                  <a
                    href={`/invoice/${inv.publicToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="apb text-xs"
                  >
                    View portal
                  </a>
                )}
              </div>,
            ])}
          />
        </Card>
      )}

      {showNewModal && (
        <NewARInvoiceModal
          onClose={() => setShowNewModal(false)}
          onSuccess={() => setShowNewModal(false)}
        />
      )}

      {payingInvoice && (
        <RecordPaymentModal
          invoice={payingInvoice}
          onClose={() => setPayingInvoice(null)}
        />
      )}
    </AppShell>
  )
}

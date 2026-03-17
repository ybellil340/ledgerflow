'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { customersApi } from '@/lib/api/endpoints'
import { useToast } from '@/components/providers/error-system'
import {
  Button, Badge, Modal, Input, Select, Card,
  Spinner, EmptyState, Amount, Table,
} from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Customer {
  id: string
  name: string
  vatId?: string
  email?: string
  phone?: string
  city?: string
  country: string
  paymentTermsDays: number
  iban?: string
  totalRevenue: number
  outstandingAmount: number
  invoiceCount: number
  lastInvoiceDate?: string
  isActive: boolean
  notes?: string
}

// ─── Customer modal ────────────────────────────────────────────────────────────

function CustomerModal({
  customer,
  onClose,
  onSuccess,
}: {
  customer?: Customer
  onClose(): void
  onSuccess(): void
}) {
  const editing = !!customer
  const [form, setForm] = useState({
    name: customer?.name ?? '',
    vatId: customer?.vatId ?? '',
    email: customer?.email ?? '',
    phone: customer?.phone ?? '',
    city: customer?.city ?? '',
    country: customer?.country ?? 'DE',
    paymentTermsDays: String(customer?.paymentTermsDays ?? 30),
    notes: customer?.notes ?? '',
  })
  const { toast } = useToast()
  const mutation = useMutation()
  const set = (field: string) => (v: string) => setForm((f) => ({ ...f, [field]: v }))

  async function submit() {
    if (!form.name) { toast({ type: 'error', message: 'Customer name is required' }); return }
    try {
      if (editing) {
        await mutation.mutate(() => customersApi.update(customer!.id, form))
        toast({ type: 'success', message: 'Customer updated' })
      } else {
        await mutation.mutate(() => customersApi.create(form))
        toast({ type: 'success', message: 'Customer added' })
      }
      invalidateQuery('customers')
      onSuccess()
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <Modal title={editing ? 'Edit customer' : 'Add customer'} subtitle="Customer details are used on AR invoices" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="f-label">Company name *</label>
          <Input value={form.name} onChange={set('name')} placeholder="Techcorp Berlin GmbH" />
        </div>
        <div className="f-row f-2">
          <div>
            <label className="f-label">VAT ID</label>
            <Input value={form.vatId} onChange={set('vatId')} placeholder="DE111222333" />
          </div>
          <div>
            <label className="f-label">Email</label>
            <Input type="email" value={form.email} onChange={set('email')} placeholder="ap@customer.de" />
          </div>
        </div>
        <div className="f-row f-2">
          <div>
            <label className="f-label">City</label>
            <Input value={form.city} onChange={set('city')} placeholder="Berlin" />
          </div>
          <div>
            <label className="f-label">Payment terms (days)</label>
            <Input type="number" value={form.paymentTermsDays} onChange={set('paymentTermsDays')} />
          </div>
        </div>
        <div>
          <label className="f-label">Notes</label>
          <Input value={form.notes} onChange={set('notes')} placeholder="Internal notes about this customer..." />
        </div>
      </div>
      <div className="flex gap-2 mt-5 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={mutation.isLoading}>
          {editing ? 'Save changes' : 'Add customer'}
        </Button>
      </div>
    </Modal>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | undefined>()

  const { data: customers, isLoading } = useQuery<Customer[]>(
    'customers',
    () => customersApi.list({ limit: 200 })
  )

  const filtered = useMemo(() => {
    if (!customers) return []
    const q = search.toLowerCase()
    return q
      ? customers.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.vatId?.toLowerCase().includes(q) ||
            c.city?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q)
        )
      : customers
  }, [customers, search])

  const handleEdit = (c: Customer) => { setEditingCustomer(c); setShowModal(true) }
  const handleClose = () => { setShowModal(false); setEditingCustomer(undefined) }

  const totalRevenue = (customers ?? []).reduce((s, c) => s + c.totalRevenue, 0)
  const totalOutstanding = (customers ?? []).reduce((s, c) => s + c.outstandingAmount, 0)

  return (
    <AppShell
      title="Customers"
      subtitle="Manage your customer directory"
      action={<Button variant="primary" onClick={() => setShowModal(true)}>+ New customer</Button>}
    >
      <div className="krow k3 mb-4">
        <Card kpi label="Total customers" value={(customers ?? []).length} />
        <Card kpi label="Total revenue (YTD)" value={<Amount value={totalRevenue} />} valueColor="green" />
        <Card kpi label="Outstanding AR" value={<Amount value={totalOutstanding} />} valueColor="blue" />
      </div>

      <div className="filter-row mb-3">
        <input
          className="search-box"
          placeholder="Search customers by name, VAT ID, city..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="ghost" size="sm" onClick={() => router.push('/invoices/ar')}>
          View AR invoices →
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !filtered.length ? (
        <EmptyState
          title={search ? 'No customers match your search' : 'No customers yet'}
          description="Add your first customer to start creating AR invoices."
          action={!search ? <Button variant="primary" onClick={() => setShowModal(true)}>+ New customer</Button> : undefined}
        />
      ) : (
        <Card className="p-0">
          <Table
            columns={['Customer name', 'VAT ID', 'Email', 'City', 'Payment terms', 'Total revenue', 'Outstanding', 'Invoices', '']}
            rows={filtered.map((c) => [
              <div key="name">
                <div className="font-medium text-sm">{c.name}</div>
                {!c.isActive && <Badge label="Inactive" variant="gray" size="sm" />}
              </div>,
              <span key="vat" className="font-mono text-xs text-gray-500">{c.vatId || '—'}</span>,
              <a key="email" href={`mailto:${c.email}`} className="text-blue-600 text-xs hover:underline">{c.email || '—'}</a>,
              c.city || '—',
              <span key="terms" className="text-gray-400">{c.paymentTermsDays} days</span>,
              <Amount key="rev" value={c.totalRevenue} className="font-medium text-green-700" />,
              <Amount key="out" value={c.outstandingAmount} className={c.outstandingAmount > 0 ? 'text-blue-600' : 'text-gray-400'} />,
              c.invoiceCount,
              <button key="edit" className="apb text-xs" onClick={() => handleEdit(c)}>Edit</button>,
            ])}
          />
        </Card>
      )}

      {showModal && (
        <CustomerModal
          customer={editingCustomer}
          onClose={handleClose}
          onSuccess={handleClose}
        />
      )}
    </AppShell>
  )
}

'use client'

import { useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { suppliersApi } from '@/lib/api/endpoints'
import { useToast } from '@/components/providers/error-system'
import {
  Button, Badge, Modal, Input, Select, Card,
  Spinner, EmptyState, Amount, Table,
} from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Supplier {
  id: string
  name: string
  vatId?: string
  email?: string
  phone?: string
  city?: string
  country: string
  paymentTermsDays: number
  iban?: string
  bankName?: string
  defaultVatCode?: string
  defaultAccountCode?: string
  invoiceCount: number
  totalInvoiced: number
  lastInvoiceDate?: string
  isActive: boolean
}

// ─── Add/Edit supplier modal ───────────────────────────────────────────────────

function SupplierModal({
  supplier,
  onClose,
  onSuccess,
}: {
  supplier?: Supplier
  onClose(): void
  onSuccess(): void
}) {
  const editing = !!supplier
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    vatId: supplier?.vatId ?? '',
    email: supplier?.email ?? '',
    phone: supplier?.phone ?? '',
    city: supplier?.city ?? '',
    country: supplier?.country ?? 'DE',
    paymentTermsDays: String(supplier?.paymentTermsDays ?? 30),
    iban: supplier?.iban ?? '',
    bankName: supplier?.bankName ?? '',
    defaultVatCode: supplier?.defaultVatCode ?? 'VST19',
    defaultAccountCode: supplier?.defaultAccountCode ?? '',
  })
  const { toast } = useToast()
  const mutation = useMutation()

  const set = (field: string) => (v: string) => setForm((f) => ({ ...f, [field]: v }))

  async function submit() {
    if (!form.name) {
      toast({ type: 'error', message: 'Supplier name is required' })
      return
    }
    try {
      if (editing) {
        await mutation.mutate(() => suppliersApi.update(supplier!.id, form))
        toast({ type: 'success', message: 'Supplier updated' })
      } else {
        await mutation.mutate(() => suppliersApi.create(form))
        toast({ type: 'success', message: 'Supplier added' })
      }
      invalidateQuery('suppliers')
      onSuccess()
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <Modal title={editing ? 'Edit supplier' : 'Add supplier'} subtitle="Supplier details are used for AP invoices and DATEV exports" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="f-label">Company name *</label>
          <Input value={form.name} onChange={set('name')} placeholder="Siemens AG" />
        </div>
        <div className="f-row f-2">
          <div>
            <label className="f-label">VAT ID (Steuernummer)</label>
            <Input value={form.vatId} onChange={set('vatId')} placeholder="DE123456789" />
          </div>
          <div>
            <label className="f-label">Email</label>
            <Input type="email" value={form.email} onChange={set('email')} placeholder="rechnungen@supplier.de" />
          </div>
        </div>
        <div className="f-row f-2">
          <div>
            <label className="f-label">City</label>
            <Input value={form.city} onChange={set('city')} placeholder="München" />
          </div>
          <div>
            <label className="f-label">Payment terms (days)</label>
            <Input type="number" value={form.paymentTermsDays} onChange={set('paymentTermsDays')} />
          </div>
        </div>
        <div className="f-row f-2">
          <div>
            <label className="f-label">IBAN</label>
            <Input value={form.iban} onChange={set('iban')} placeholder="DE89 3704 0044..." />
          </div>
          <div>
            <label className="f-label">Bank name</label>
            <Input value={form.bankName} onChange={set('bankName')} placeholder="Deutsche Bank" />
          </div>
        </div>
        <div className="f-row f-2">
          <div>
            <label className="f-label">Default VAT code</label>
            <Select
              value={form.defaultVatCode}
              onChange={set('defaultVatCode')}
              options={[
                { value: 'VST19', label: 'VSt19 — 19%' },
                { value: 'VST7', label: 'VSt7 — 7%' },
                { value: 'EUV', label: 'EUV — EU reverse charge' },
                { value: 'DRITTLAND', label: 'Drittland' },
                { value: 'STFREI', label: 'Steuerfrei' },
              ]}
            />
          </div>
          <div>
            <label className="f-label">Default account (SKR03)</label>
            <Input value={form.defaultAccountCode} onChange={set('defaultAccountCode')} placeholder="4230" />
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-5 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={mutation.isLoading}>
          {editing ? 'Save changes' : 'Add supplier'}
        </Button>
      </div>
    </Modal>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function SuppliersPage() {
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | undefined>()

  const { data: suppliers, isLoading } = useQuery<Supplier[]>(
    'suppliers',
    () => suppliersApi.list({ limit: 200 })
  )

  const filtered = useMemo(() => {
    if (!suppliers) return []
    const q = search.toLowerCase()
    return q
      ? suppliers.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.vatId?.toLowerCase().includes(q) ||
            s.city?.toLowerCase().includes(q) ||
            s.email?.toLowerCase().includes(q)
        )
      : suppliers
  }, [suppliers, search])

  const handleEdit = (s: Supplier) => {
    setEditingSupplier(s)
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingSupplier(undefined)
  }

  const totalInvoiced = (suppliers ?? []).reduce((s, sup) => s + sup.totalInvoiced, 0)

  return (
    <AppShell
      title="Suppliers"
      subtitle="Manage your supplier directory"
      action={<Button variant="primary" onClick={() => setShowModal(true)}>+ New supplier</Button>}
    >
      <div className="krow k3 mb-4">
        <Card kpi label="Total suppliers" value={(suppliers ?? []).length} />
        <Card kpi label="Active suppliers" value={(suppliers ?? []).filter(s => s.isActive).length} />
        <Card kpi label="Total invoiced (YTD)" value={<Amount value={totalInvoiced} />} />
      </div>

      <div className="filter-row mb-3">
        <input
          className="search-box"
          placeholder="Search by name, VAT ID, city, or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !filtered.length ? (
        <EmptyState
          title={search ? 'No suppliers match your search' : 'No suppliers yet'}
          description="Add your first supplier to start managing AP invoices."
          action={!search ? <Button variant="primary" onClick={() => setShowModal(true)}>+ New supplier</Button> : undefined}
        />
      ) : (
        <Card className="p-0">
          <Table
            columns={['Supplier name', 'VAT ID', 'Email', 'City', 'Payment terms', 'Total invoiced', 'Invoices', '']}
            rows={filtered.map((s) => [
              <div key="name">
                <div className="font-medium text-sm">{s.name}</div>
                {!s.isActive && <Badge label="Inactive" variant="gray" size="sm" />}
              </div>,
              <span key="vat" className="font-mono text-xs text-gray-500">{s.vatId || '—'}</span>,
              <a key="email" href={`mailto:${s.email}`} className="text-blue-600 text-xs hover:underline">{s.email || '—'}</a>,
              s.city || '—',
              <span key="terms" className="text-gray-400">{s.paymentTermsDays} days</span>,
              <Amount key="total" value={s.totalInvoiced} className="font-medium" />,
              s.invoiceCount,
              <button key="edit" className="apb text-xs" onClick={() => handleEdit(s)}>Edit</button>,
            ])}
          />
        </Card>
      )}

      {showModal && (
        <SupplierModal
          supplier={editingSupplier}
          onClose={handleCloseModal}
          onSuccess={handleCloseModal}
        />
      )}
    </AppShell>
  )
}

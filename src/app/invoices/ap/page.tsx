'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, usePaginated, invalidateQuery } from '@/lib/hooks'
import { apInvoicesApi } from '@/lib/api/endpoints'
import { useAuth } from '@/lib/store/auth'
import { useToast } from '@/components/providers/error-system'
import {
  Button, Badge, Modal, Input, Select, Textarea, Card,
  Spinner, EmptyState, Amount, Table,
} from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

type APStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID' | 'REJECTED' | 'OVERDUE'

interface APInvoice {
  id: string
  invoiceNumber: string
  supplier: { id: string; name: string; vatId?: string }
  issueDate: string
  dueDate: string
  netAmount: number
  vatAmount: number
  grossAmount: number
  currency: string
  status: APStatus
  isDuplicate?: boolean
  duplicateOfId?: string
  vatCode?: string
  accountCode?: string
  notes?: string
  paidAt?: string
  createdAt: string
}

type ViewMode = 'kanban' | 'list'

const KANBAN_COLS: { status: APStatus; label: string; color: string }[] = [
  { status: 'DRAFT',            label: 'Draft',           color: 'gray' },
  { status: 'PENDING_APPROVAL', label: 'Pending approval',color: 'blue' },
  { status: 'APPROVED',         label: 'Approved',        color: 'green' },
  { status: 'OVERDUE',          label: 'Overdue',         color: 'red' },
]

// ─── Kanban column ─────────────────────────────────────────────────────────────

function KanbanCol({
  col, invoices, onApprove, onReject, onMarkPaid,
}: {
  col: typeof KANBAN_COLS[0]
  invoices: APInvoice[]
  onApprove(id: string): void
  onReject(id: string): void
  onMarkPaid(id: string): void
}) {
  const colorMap: Record<string, string> = {
    gray: 'bg-gray-50 border-gray-200',
    blue: 'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
    red: 'bg-red-50 border-red-200',
  }
  return (
    <div className={`rounded-xl border p-2 ${colorMap[col.color]}`}>
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <span className="text-xs font-semibold text-gray-600">{col.label}</span>
        <span className="text-xs font-medium bg-white border rounded-full px-2 py-0.5">{invoices.length}</span>
      </div>
      <div className="space-y-2">
        {invoices.map((inv) => (
          <div
            key={inv.id}
            className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm"
          >
            <div className="font-medium text-xs text-gray-700 mb-0.5">{inv.supplier.name}</div>
            <div className="text-[10.5px] text-gray-400 font-mono mb-1">{inv.invoiceNumber}</div>
            <div className="text-sm font-semibold mb-1">
              <Amount value={inv.grossAmount} currency={inv.currency} />
            </div>
            <div className={`text-[10.5px] mb-1.5 ${col.status === 'OVERDUE' ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
              Due: {inv.dueDate}
            </div>
            {inv.isDuplicate && (
              <div className="mb-1.5">
                <Badge label="⚠ Possible duplicate" variant="amber" size="sm" />
              </div>
            )}
            {col.status === 'PENDING_APPROVAL' && (
              <div className="flex gap-1 mt-1">
                <button className="apb apb-y flex-1 text-center text-[10px]" onClick={() => onApprove(inv.id)}>Approve</button>
                <button className="apb apb-n flex-1 text-center text-[10px]" onClick={() => onReject(inv.id)}>Reject</button>
              </div>
            )}
            {col.status === 'APPROVED' && (
              <button className="apb apb-y w-full text-center text-[10px] mt-1" onClick={() => onMarkPaid(inv.id)}>
                Mark paid
              </button>
            )}
          </div>
        ))}
        {invoices.length === 0 && (
          <div className="text-center py-6 text-xs text-gray-300">Empty</div>
        )}
      </div>
    </div>
  )
}

// ─── Upload invoice modal ──────────────────────────────────────────────────────

function UploadInvoiceModal({ onClose, onSuccess }: { onClose(): void; onSuccess(): void }) {
  const [form, setForm] = useState({
    supplierId: '',
    invoiceNumber: '',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    grossAmount: '',
    vatCode: 'VST19',
    notes: '',
  })
  const { toast } = useToast()
  const mutation = useMutation()

  async function submit() {
    if (!form.invoiceNumber || !form.grossAmount || !form.dueDate) {
      toast({ type: 'error', message: 'Invoice number, due date, and amount are required' })
      return
    }
    try {
      await mutation.mutate(() =>
        apInvoicesApi.create({
          invoiceNumber: form.invoiceNumber,
          issueDate: form.issueDate,
          dueDate: form.dueDate,
          grossAmount: parseFloat(form.grossAmount),
          currency: 'EUR',
          vatCode: form.vatCode,
          notes: form.notes || undefined,
          // supplierId would come from a supplier search component in production
        })
      )
      toast({ type: 'success', message: 'Invoice uploaded — ready for approval' })
      invalidateQuery('ap-invoices')
      onSuccess()
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <Modal title="Upload supplier invoice" subtitle="AP invoice will enter the approval queue" onClose={onClose}>
      <div className="space-y-3">
        <div className="f-row f-2">
          <div>
            <label className="f-label">Invoice number *</label>
            <Input value={form.invoiceNumber} onChange={(v) => setForm((f) => ({ ...f, invoiceNumber: v }))} placeholder="INV-2025-001" />
          </div>
          <div>
            <label className="f-label">Gross amount (€) *</label>
            <Input type="number" value={form.grossAmount} onChange={(v) => setForm((f) => ({ ...f, grossAmount: v }))} placeholder="1190.00" />
          </div>
        </div>
        <div className="f-row f-2">
          <div>
            <label className="f-label">Issue date</label>
            <Input type="date" value={form.issueDate} onChange={(v) => setForm((f) => ({ ...f, issueDate: v }))} />
          </div>
          <div>
            <label className="f-label">Due date *</label>
            <Input type="date" value={form.dueDate} onChange={(v) => setForm((f) => ({ ...f, dueDate: v }))} />
          </div>
        </div>
        <div>
          <label className="f-label">VAT code</label>
          <Select
            value={form.vatCode}
            onChange={(v) => setForm((f) => ({ ...f, vatCode: v }))}
            options={[
              { value: 'VST19', label: 'VSt19 — 19% domestic purchase' },
              { value: 'VST7', label: 'VSt7 — 7% reduced rate' },
              { value: 'EUV', label: 'EUV — EU reverse charge' },
              { value: 'DRITTLAND', label: 'Drittland — third-country import' },
              { value: 'STFREI', label: 'Steuerfrei — VAT exempt' },
            ]}
          />
        </div>
        <div>
          <label className="f-label">Notes</label>
          <Textarea value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} placeholder="Internal notes..." rows={2} />
        </div>
      </div>
      <div className="flex gap-2 mt-5 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={mutation.isLoading}>Upload invoice</Button>
      </div>
    </Modal>
  )
}

// ─── Reject modal ──────────────────────────────────────────────────────────────

function RejectModal({ invoiceId, onClose }: { invoiceId: string; onClose(): void }) {
  const [reason, setReason] = useState('')
  const { toast } = useToast()
  const mutation = useMutation()

  async function submit() {
    if (!reason.trim()) {
      toast({ type: 'error', message: 'A rejection reason is required' })
      return
    }
    try {
      await mutation.mutate(() => apInvoicesApi.reject(invoiceId, reason))
      toast({ type: 'info', message: 'Invoice rejected' })
      invalidateQuery('ap-invoices')
      onClose()
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <Modal title="Reject invoice" subtitle="The supplier will be notified" onClose={onClose}>
      <div>
        <label className="f-label">Reason for rejection *</label>
        <Textarea value={reason} onChange={setReason} placeholder="e.g. Duplicate invoice, incorrect amount, missing VAT ID..." rows={3} />
      </div>
      <div className="flex gap-2 mt-4 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={submit} loading={mutation.isLoading}>Reject invoice</Button>
      </div>
    </Modal>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function APInvoicesPage() {
  const { can } = useAuth()
  const { toast } = useToast()
  const [view, setView] = useState<ViewMode>('kanban')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [rejectingId, setRejectingId] = useState<string | null>(null)

  const { data: invoices, isLoading, refetch } = useQuery<APInvoice[]>(
    'ap-invoices',
    () => apInvoicesApi.list({ limit: 100 })
  )

  const handleApprove = useCallback(async (id: string) => {
    try {
      await apInvoicesApi.approve(id)
      toast({ type: 'success', message: 'Invoice approved' })
      invalidateQuery('ap-invoices')
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }, [toast])

  const handleReject = useCallback((id: string) => {
    setRejectingId(id)
  }, [])

  const handleMarkPaid = useCallback(async (id: string) => {
    try {
      await apInvoicesApi.recordPayment(id, {
        amount: 0, // full amount from invoice
        paymentDate: new Date().toISOString().slice(0, 10),
        reference: `PAY-${Date.now()}`,
      })
      toast({ type: 'success', message: 'Invoice marked as paid' })
      invalidateQuery('ap-invoices')
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }, [toast])

  // Group invoices by status for kanban
  const byStatus = (status: APStatus) =>
    (invoices ?? []).filter((i) => i.status === status)

  const pendingCount = byStatus('PENDING_APPROVAL').length
  const overdueCount = byStatus('OVERDUE').length
  const duplicates = (invoices ?? []).filter((i) => i.isDuplicate)

  return (
    <AppShell
      title="Supplier Invoices (AP)"
      subtitle="Accounts payable"
      action={
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setView(v => v === 'kanban' ? 'list' : 'kanban')}>
            {view === 'kanban' ? '☰ List view' : '⊞ Kanban view'}
          </Button>
          <Button variant="ghost" size="sm">Export DATEV</Button>
          <Button variant="primary" onClick={() => setShowUploadModal(true)}>+ Upload invoice</Button>
        </div>
      }
    >
      {/* Status summary */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {KANBAN_COLS.map((col) => {
          const count = byStatus(col.status).length
          const colorClass: Record<string, string> = {
            gray: 'border-gray-200 bg-gray-50',
            blue: 'border-blue-200 bg-blue-50',
            green: 'border-green-200 bg-green-50',
            red: 'border-red-200 bg-red-50',
          }
          const textClass: Record<string, string> = {
            gray: 'text-gray-600',
            blue: 'text-blue-700',
            green: 'text-green-700',
            red: 'text-red-700',
          }
          return (
            <div key={col.status} className={`rounded-lg border p-3 ${colorClass[col.color]}`}>
              <div className={`text-xs mb-1 ${textClass[col.color]}`}>{col.label}</div>
              <div className={`text-2xl font-medium ${textClass[col.color]}`}>{count}</div>
            </div>
          )
        })}
      </div>

      {/* Duplicate warning banner */}
      {duplicates.length > 0 && (
        <div className="info-box amber mb-4">
          <strong>⚠ {duplicates.length} possible duplicate{duplicates.length > 1 ? 's' : ''} detected</strong>
          {' '}— Review flagged invoices before approving.
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !invoices?.length ? (
        <EmptyState
          title="No invoices yet"
          description="Upload your first supplier invoice to get started with AP management."
          action={<Button variant="primary" onClick={() => setShowUploadModal(true)}>+ Upload invoice</Button>}
        />
      ) : view === 'kanban' ? (
        /* ── KANBAN VIEW ── */
        <div className="grid grid-cols-4 gap-3">
          {KANBAN_COLS.map((col) => (
            <KanbanCol
              key={col.status}
              col={col}
              invoices={byStatus(col.status)}
              onApprove={handleApprove}
              onReject={handleReject}
              onMarkPaid={handleMarkPaid}
            />
          ))}
        </div>
      ) : (
        /* ── LIST VIEW ── */
        <Card className="p-0">
          <Table
            columns={['Supplier', 'Invoice #', 'Issue date', 'Due date', 'VAT', 'Net', 'Gross', 'Status', '']}
            rows={(invoices ?? []).map((inv) => [
              <div key="sup">
                <div className="font-medium text-sm">{inv.supplier.name}</div>
                {inv.isDuplicate && <Badge label="Duplicate?" variant="amber" size="sm" />}
              </div>,
              <span key="num" className="font-mono text-xs text-gray-500">{inv.invoiceNumber}</span>,
              inv.issueDate,
              <span key="due" className={inv.status === 'OVERDUE' ? 'text-red-500 font-medium' : 'text-gray-400'}>
                {inv.dueDate}
              </span>,
              <Badge key="vat" label={inv.vatCode ?? '—'} variant="purple" size="sm" />,
              <Amount key="net" value={inv.netAmount} />,
              <Amount key="gross" value={inv.grossAmount} className="font-medium" />,
              <Badge key="status" status={inv.status as any} />,
              can('invoices:approve') && inv.status === 'PENDING_APPROVAL' ? (
                <div key="act" className="flex gap-1">
                  <button className="apb apb-y text-xs" onClick={() => handleApprove(inv.id)}>Approve</button>
                  <button className="apb apb-n text-xs" onClick={() => handleReject(inv.id)}>Reject</button>
                </div>
              ) : inv.status === 'APPROVED' ? (
                <button key="pay" className="apb apb-y text-xs" onClick={() => handleMarkPaid(inv.id)}>Mark paid</button>
              ) : null,
            ])}
          />
        </Card>
      )}

      {showUploadModal && (
        <UploadInvoiceModal
          onClose={() => setShowUploadModal(false)}
          onSuccess={() => setShowUploadModal(false)}
        />
      )}

      {rejectingId && (
        <RejectModal
          invoiceId={rejectingId}
          onClose={() => setRejectingId(null)}
        />
      )}
    </AppShell>
  )
}

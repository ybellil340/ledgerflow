'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Button, Badge, FilterChip, Card, Table, Th, Td, Avatar, Modal, Input, Textarea, Spinner, EmptyState, statusBadge } from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'

interface Reimbursement {
  id: string
  title: string
  description?: string
  amount: number
  currency: string
  status: string
  createdAt: string
  paidAt?: string
  user: { id: string; firstName: string; lastName: string; avatarUrl?: string }
  attachments: Array<{ id: string; fileUrl: string; fileName: string }>
  _count: { comments: number }
}

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Submitted', value: 'SUBMITTED' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Rejected', value: 'REJECTED' },
]

export default function ReimbursementsPage() {
  const [items, setItems] = useState<Reimbursement[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [actionTarget, setActionTarget] = useState<{ id: string; action: 'approve' | 'reject' | 'pay' } | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const fetch_ = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ perPage: '30' })
    if (statusFilter) params.append('status', statusFilter)
    const res = await fetch(`/api/reimbursements?${params}`)
    const data = await res.json()
    setItems(data.data ?? [])
    setTotal(data.meta?.total ?? 0)
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { fetch_() }, [fetch_])

  async function handleAction() {
    if (!actionTarget) return
    const body: Record<string, unknown> = { action: actionTarget.action }
    if (actionTarget.action === 'reject') body.reason = rejectReason

    await fetch(`/api/reimbursements/${actionTarget.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setActionTarget(null)
    setRejectReason('')
    fetch_()
  }

  const totalAmount = items.reduce((s, r) => s + r.amount, 0)
  const pendingAmount = items.filter((r) => ['SUBMITTED', 'APPROVED'].includes(r.status)).reduce((s, r) => s + r.amount, 0)

  return (
    <AppShell
      title="Reimbursements"
      subtitle={`${total} requests · out-of-pocket expenses`}
      action={
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          + New request
        </Button>
      }
    >
      <div className="space-y-4">

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total requests', value: total },
            { label: 'Pending payout', value: `€${pendingAmount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`, color: 'text-amber-600' },
            { label: 'Total amount', value: `€${totalAmount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}` },
          ].map((kpi) => (
            <Card key={kpi.label} className="p-4">
              <div className="text-xs text-gray-500 mb-1">{kpi.label}</div>
              <div className={`text-xl font-semibold ${kpi.color ?? 'text-gray-900'}`}>{kpi.value}</div>
            </Card>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <FilterChip key={f.value} label={f.label} active={statusFilter === f.value} onClick={() => setStatusFilter(f.value)} />
          ))}
        </div>

        <Card padding="none">
          {loading ? (
            <div className="flex items-center justify-center h-48"><Spinner size="lg" /></div>
          ) : items.length === 0 ? (
            <EmptyState
              title="No reimbursements"
              description="Employees can submit out-of-pocket expenses for reimbursement"
              action={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>+ New request</Button>}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Description</Th>
                  <Th>Submitted</Th>
                  <Th>Attachments</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                  <Th className="w-32" />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <Td>
                      <div className="flex items-center gap-2">
                        <Avatar firstName={r.user.firstName} lastName={r.user.lastName} size="sm" />
                        <span className="text-sm font-medium text-gray-900">{r.user.firstName} {r.user.lastName}</span>
                      </div>
                    </Td>
                    <Td>
                      <div className="text-sm font-medium text-gray-900">{r.title}</div>
                      {r.description && <div className="text-xs text-gray-400 truncate max-w-[220px]">{r.description}</div>}
                    </Td>
                    <Td>
                      <span className="text-xs text-gray-600">
                        {new Date(r.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-xs text-gray-500">
                        {r.attachments.length} file{r.attachments.length !== 1 ? 's' : ''}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <span className="text-sm font-semibold text-gray-900">
                        €{r.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                      </span>
                    </Td>
                    <Td>{statusBadge(r.status)}</Td>
                    <Td>
                      <div className="flex gap-1">
                        {r.status === 'SUBMITTED' && (
                          <>
                            <button
                              onClick={() => setActionTarget({ id: r.id, action: 'approve' })}
                              className="px-2 py-1 text-[10px] font-medium rounded-md bg-green-50 text-green-700 hover:bg-green-100"
                            >Approve</button>
                            <button
                              onClick={() => setActionTarget({ id: r.id, action: 'reject' })}
                              className="px-2 py-1 text-[10px] font-medium rounded-md bg-red-50 text-red-700 hover:bg-red-100"
                            >Reject</button>
                          </>
                        )}
                        {r.status === 'APPROVED' && (
                          <button
                            onClick={() => setActionTarget({ id: r.id, action: 'pay' })}
                            className="px-2 py-1 text-[10px] font-medium rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100"
                          >Mark paid</button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {/* Action confirmation modal */}
      <Modal
        open={!!actionTarget}
        onClose={() => { setActionTarget(null); setRejectReason('') }}
        title={
          actionTarget?.action === 'approve' ? 'Approve reimbursement' :
          actionTarget?.action === 'reject' ? 'Reject reimbursement' : 'Mark as paid'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => { setActionTarget(null); setRejectReason('') }}>Cancel</Button>
            <Button
              variant={actionTarget?.action === 'reject' ? 'danger' : 'primary'}
              onClick={handleAction}
              disabled={actionTarget?.action === 'reject' && !rejectReason.trim()}
            >
              {actionTarget?.action === 'approve' ? 'Approve' :
               actionTarget?.action === 'reject' ? 'Reject' : 'Mark as paid'}
            </Button>
          </>
        }
      >
        {actionTarget?.action === 'reject' ? (
          <Textarea
            label="Reason for rejection"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Please provide a reason..."
            rows={3}
          />
        ) : (
          <p className="text-sm text-gray-600">
            {actionTarget?.action === 'pay'
              ? 'Confirm you have transferred the reimbursement to the employee\'s bank account.'
              : 'This reimbursement will be approved and the employee will be notified.'}
          </p>
        )}
      </Modal>

      {/* Create modal */}
      <CreateReimbursementModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); fetch_() }}
      />
    </>
  )
}

function CreateReimbursementModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', amount: '', currency: 'EUR' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(field: string, value: string) { setForm((p) => ({ ...p, [field]: value })) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/reimbursements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      onCreated()
    } catch { setError('Network error') } finally { setLoading(false) }
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title="New reimbursement request"
      description="Submit your out-of-pocket expenses for reimbursement"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={loading}>Submit request</Button>
        </>
      }
    >
      {error && <div className="mb-4 p-3 bg-red-50 rounded-lg text-sm text-red-700">{error}</div>}
      <div className="space-y-4">
        <Input label="Title / Purpose" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Client dinner, taxi to airport..." required />
        <Input label="Amount" type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} leftAddon="€" placeholder="0.00" required />
        <Textarea label="Description (optional)" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Additional context, project code, attendees..." rows={3} />
        <div className="p-3 bg-amber-50 rounded-xl text-xs text-amber-700">
          Attach receipts on the next screen. Requests without receipts may be delayed.
        </div>
      </div>
    </Modal>
  )
}

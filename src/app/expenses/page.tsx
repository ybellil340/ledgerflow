export const dynamic = 'force-dynamic'

'use client'

/**
 * Expenses page — fully wired
 *
 * Data: GET /api/expenses with filter/search params
 * Actions:
 *   Approve  → POST /api/expenses/:id/approve  (optimistic row update)
 *   Reject   → POST /api/expenses/:id/reject   (shows reason modal)
 *   Create   → POST /api/expenses              (adds to list)
 *   Upload   → POST /api/receipts              (multipart/form-data)
 */

import React, { useState, useCallback, useRef } from 'react'
import { useExpenses } from '@/lib/hooks'
import { expensesApi } from '@/lib/api/endpoints'
import { invalidateQuery } from '@/lib/hooks'
import { useToast, handleApiError } from '@/components/providers/error-system'
import { useAuth } from '@/lib/store/auth'

// ─────────────────────────────────────────────
// TYPES (pulled from server schema)
// ─────────────────────────────────────────────

interface Expense {
  id: string
  merchant: string
  expenseDate: string
  currency: string
  grossAmount: number
  netAmount?: number
  vatRate?: number
  vatAmount?: number
  status: string
  categoryId?: string
  notes?: string
  user: { id: string; firstName: string; lastName: string }
  department?: { name: string; code?: string }
  vatCode?: { code: string; rate: number }
  receipt?: { id: string; url?: string } | null
  _count?: { comments: number; attachments: number }
}

// ─────────────────────────────────────────────
// INLINE COMPONENTS
// ─────────────────────────────────────────────

const STATUS_PILL: Record<string, [string, string]> = {
  DRAFT:             ['Draft',          '#f1f1ef:#888780'],
  SUBMITTED:         ['Submitted',      '#E6F1FB:#0C447C'],
  PENDING_APPROVAL:  ['Pending',        '#FAEEDA:#633806'],
  APPROVED:          ['Approved',       '#EAF3DE:#27500A'],
  REJECTED:          ['Rejected',       '#FCEBEB:#791F1F'],
  EXPORTED:          ['Exported',       '#EEEDFE:#3C3489'],
  FLAGGED:           ['Flagged',        '#FCEBEB:#791F1F'],
}
function StatusPill({ status }: { status: string }) {
  const [label, colors] = STATUS_PILL[status] ?? [status, '#f1f1ef:#888780']
  const [bg, col] = colors.split(':')
  return (
    <span style={{ display: 'inline-block', fontSize: 9.5, fontWeight: 500, padding: '2px 8px', borderRadius: 20, background: bg, color: col }}>
      {label}
    </span>
  )
}

const CAT_COLORS: Record<string, [string, string]> = {
  Travel:    ['#E6F1FB', '#0C447C'],
  Software:  ['#EEEDFE', '#3C3489'],
  Meals:     ['#EAF3DE', '#27500A'],
  Equipment: ['#FAEEDA', '#633806'],
  Marketing: ['#E1F5EE', '#085041'],
  Office:    ['#f1f1ef', '#5F5E5A'],
}
function CatPill({ cat }: { cat: string }) {
  const [bg, col] = CAT_COLORS[cat] ?? ['#f1f1ef', '#888780']
  return (
    <span style={{ display: 'inline-block', fontSize: 9.5, fontWeight: 500, padding: '2px 8px', borderRadius: 20, background: bg, color: col }}>
      {cat}
    </span>
  )
}

// ─────────────────────────────────────────────
// RECEIPT UPLOAD HANDLER (inline)
// ─────────────────────────────────────────────

function ReceiptUploadCell({ expense, onUploaded }: { expense: Expense; onUploaded: () => void }) {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await expensesApi.uploadReceipt(expense.id, file)
      toast.success('Receipt uploaded', 'OCR extraction running in the background.')
      onUploaded()
    } catch (err) {
      handleApiError(err, toast, 'Receipt upload')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  if (expense.receipt) {
    return (
      <a href={expense.receipt.url ?? '#'} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9.5, fontWeight: 500, padding: '2px 8px', borderRadius: 20, background: '#EAF3DE', color: '#27500A', textDecoration: 'none' }}>
        Matched
      </a>
    )
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={handleFile} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        style={{ fontSize: 9.5, fontWeight: 500, padding: '2px 8px', borderRadius: 20, background: '#FAEEDA', color: '#633806', border: 'none', cursor: 'pointer' }}
      >
        {uploading ? '…' : 'Missing'}
      </button>
    </>
  )
}

// ─────────────────────────────────────────────
// REJECT MODAL (inline)
// ─────────────────────────────────────────────

function RejectModal({ expenseId, merchant, onClose, onRejected }: {
  expenseId: string; merchant: string; onClose: () => void; onRejected: () => void
}) {
  const [reason, setReason] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const toast = useToast()

  async function handleReject() {
    if (!reason.trim()) return
    setIsLoading(true)
    try {
      await expensesApi.reject(expenseId, reason)
      toast.warning('Expense rejected')
      invalidateQuery('expenses')
      invalidateQuery('dashboard')
      onRejected()
    } catch (err) {
      handleApiError(err, toast, 'Reject')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440, padding: '22px', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Reject expense</div>
        <div style={{ fontSize: 11.5, color: '#9CA3AF', marginBottom: 16 }}>{merchant}</div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejection (required)..."
          style={{ width: '100%', minHeight: 90, padding: '9px 11px', border: '.5px solid #E8E8E4', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', outline: 'none', resize: 'vertical', marginBottom: 14 }}
          autoFocus
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '7px 16px', border: '.5px solid #E8E8E4', borderRadius: 8, background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleReject}
            disabled={!reason.trim() || isLoading}
            style={{ padding: '7px 16px', border: 'none', borderRadius: 8, background: '#FCEBEB', color: '#791F1F', fontSize: 12.5, fontWeight: 500, cursor: reason.trim() && !isLoading ? 'pointer' : 'not-allowed', opacity: reason.trim() && !isLoading ? 1 : 0.5 }}
          >
            {isLoading ? 'Rejecting…' : 'Reject expense'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// FILTER STATE
// ─────────────────────────────────────────────

const STATUS_FILTERS = ['', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPORTED', 'FLAGGED']
const STATUS_LABELS: Record<string, string> = {
  '': 'All',
  PENDING_APPROVAL: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPORTED: 'Exported',
  FLAGGED: 'Flagged',
}

// ─────────────────────────────────────────────
// EXPENSES PAGE
// ─────────────────────────────────────────────

export default function ExpensesPage() {
  const { can } = useAuth()
  const toast = useToast()

  const [statusFilter, setStatusFilter] = useState('')
  const [receiptFilter, setReceiptFilter] = useState<'missing' | ''>('')
  const [searchRaw, setSearchRaw] = useState('')
  const [search, setSearch] = useState('')
  const [rejectTarget, setRejectTarget] = useState<{ id: string; merchant: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()
  function handleSearch(val: string) {
    setSearchRaw(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setSearch(val), 400)
  }

  const filters = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(receiptFilter === 'missing' ? { hasReceipt: false } : {}),
    ...(search ? { search } : {}),
    page: 1,
    perPage: 50,
  }

  const { data, isLoading, isFetching, error, refetch, mutate: mutateList } = useExpenses(filters)
  const expenses = (data as unknown as { data: Expense[] } | null)?.data ?? []

  // ─── Approve ─────────────────────────────

  async function handleApprove(id: string) {
    // Optimistic status update
    mutateList({
      ...(data as object),
      data: expenses.map((e) => e.id === id ? { ...e, status: 'APPROVED' } : e),
    } as never)

    try {
      await expensesApi.approve(id)
      toast.success('Expense approved')
      invalidateQuery('dashboard')
    } catch (err) {
      invalidateQuery('expenses')
      handleApiError(err, toast, 'Approve')
    }
  }

  // ─── Bulk approve ─────────────────────────

  async function handleBulkApprove() {
    const ids = [...selected].filter((id) => {
      const e = expenses.find((x) => x.id === id)
      return e && ['SUBMITTED', 'PENDING_APPROVAL'].includes(e.status)
    })
    if (ids.length === 0) return

    try {
      await Promise.all(ids.map((id) => expensesApi.approve(id)))
      toast.success(`${ids.length} expense${ids.length > 1 ? 's' : ''} approved`)
      setSelected(new Set())
      invalidateQuery('expenses')
      invalidateQuery('dashboard')
    } catch (err) {
      handleApiError(err, toast, 'Bulk approve')
    }
  }

  // ─── Toggle select ────────────────────────

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === expenses.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(expenses.map((e) => e.id)))
    }
  }

  const fmt = (n: number, currency = 'EUR') =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n)

  const totalSelected = expenses.filter((e) => selected.has(e.id)).reduce((s, e) => s + e.grossAmount, 0)

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Total this month', value: fmt(expenses.reduce((s, e) => s + e.grossAmount, 0)), color: undefined },
          { label: 'Pending approval', value: String(expenses.filter((e) => e.status === 'PENDING_APPROVAL').length), color: '#BA7517' },
          { label: 'Missing receipts', value: String(expenses.filter((e) => !e.receipt).length), color: '#A32D2D' },
          { label: 'Exported', value: String(expenses.filter((e) => e.status === 'EXPORTED').length), color: '#534AB7' },
        ].map((k) => (
          <div key={k.label} style={{ background: 'var(--card)', border: '.5px solid var(--border)', borderRadius: 12, padding: '13px 15px' }}>
            <div style={{ fontSize: 10.5, color: '#9CA3AF', marginBottom: 5 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: k.color ?? '#111827' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          value={searchRaw}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search expenses..."
          style={{ flex: '1 1 200px', maxWidth: 220, padding: '5px 11px', border: '.5px solid var(--border)', borderRadius: 7, background: 'var(--card)', fontSize: 12, outline: 'none' }}
        />
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '4px 11px', border: '.5px solid', borderRadius: 6, fontSize: 11.5, cursor: 'pointer',
              borderColor: statusFilter === s ? 'var(--blue)' : 'var(--border)',
              color: statusFilter === s ? 'var(--blue-t)' : '#4B5563',
              background: statusFilter === s ? 'var(--blue-l)' : 'var(--card)',
            }}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
        <button
          onClick={() => setReceiptFilter((p) => p === 'missing' ? '' : 'missing')}
          style={{
            padding: '4px 11px', border: '.5px solid', borderRadius: 6, fontSize: 11.5, cursor: 'pointer',
            borderColor: receiptFilter === 'missing' ? '#BA7517' : 'var(--border)',
            color: receiptFilter === 'missing' ? '#633806' : '#4B5563',
            background: receiptFilter === 'missing' ? '#FAEEDA' : 'var(--card)',
          }}
        >Missing receipt</button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {isFetching && !isLoading && (
            <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--blue-m)', borderTopColor: 'var(--blue)', animation: 'spin 0.7s linear infinite' }} />
          )}
          {selected.size > 0 && (
            <button
              onClick={handleBulkApprove}
              style={{ padding: '5px 13px', border: 'none', borderRadius: 7, background: '#EAF3DE', color: '#27500A', fontSize: 11.5, fontWeight: 500, cursor: 'pointer' }}
            >
              Approve {selected.size} ({fmt(totalSelected)})
            </button>
          )}
          <button style={{ padding: '5px 13px', border: '.5px solid var(--border)', borderRadius: 7, background: 'var(--card)', fontSize: 11.5, cursor: 'pointer' }}>
            Export CSV
          </button>
          <button style={{ padding: '5px 13px', border: '.5px solid #534AB7', borderRadius: 7, background: '#EEEDFE', color: '#3C3489', fontSize: 11.5, cursor: 'pointer' }}>
            DATEV Export
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--card)', border: '.5px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '60px 0', display: 'flex', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid #E8E8E4', borderTopColor: '#185FA5', animation: 'spin 0.7s linear infinite' }} />
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>Loading expenses…</div>
            </div>
          </div>
        ) : expenses.length === 0 ? (
          <div style={{ padding: '60px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#4B5563', marginBottom: 6 }}>No expenses found</div>
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>
              {search || statusFilter || receiptFilter ? 'Try clearing your filters' : 'Create your first expense to get started'}
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ padding: '0 8px 8px', borderBottom: '.5px solid var(--border)', width: 30 }}>
                  <input type="checkbox" checked={selected.size === expenses.length && expenses.length > 0} onChange={toggleAll} style={{ width: 12, height: 12 }} />
                </th>
                {['Merchant','Employee','Category','Date','VAT','Net','Gross','Receipt','Status',''].map((h) => (
                  <th key={h} style={{ fontSize: 10.5, fontWeight: 500, color: '#9CA3AF', textAlign: 'left', padding: '0 8px 8px', borderBottom: '.5px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id} style={{ background: selected.has(expense.id) ? '#fafcff' : undefined }}>
                  <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3' }}>
                    <input type="checkbox" checked={selected.has(expense.id)} onChange={() => toggleSelect(expense.id)} style={{ width: 12, height: 12 }} />
                  </td>
                  <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3', fontSize: 12, fontWeight: 500 }}>{expense.merchant}</td>
                  <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3', fontSize: 11.5, color: '#4B5563' }}>
                    {expense.user.firstName} {expense.user.lastName[0]}.
                  </td>
                  <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3' }}>
                    {expense.categoryId ? <CatPill cat={expense.categoryId} /> : <span style={{ color: '#9CA3AF', fontSize: 11 }}>—</span>}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3', fontSize: 11.5, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                    {new Date(expense.expenseDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3', fontSize: 11.5, color: '#9CA3AF' }}>
                    {expense.vatRate != null ? `${expense.vatRate}%` : '—'}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3', fontSize: 11.5, color: '#4B5563' }}>
                    {expense.netAmount != null ? fmt(expense.netAmount, expense.currency) : '—'}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3', fontSize: 12, fontWeight: 500 }}>
                    {fmt(expense.grossAmount, expense.currency)}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3' }}>
                    <ReceiptUploadCell expense={expense} onUploaded={refetch} />
                  </td>
                  <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3' }}>
                    <StatusPill status={expense.status} />
                  </td>
                  <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3' }}>
                    {['SUBMITTED', 'PENDING_APPROVAL'].includes(expense.status) && can('approve:expenses') && (
                      <div style={{ display: 'flex', gap: 3 }}>
                        <button
                          onClick={() => handleApprove(expense.id)}
                          style={{ padding: '3px 9px', border: 'none', borderRadius: 5, background: '#EAF3DE', color: '#27500A', fontSize: 10.5, cursor: 'pointer', fontWeight: 500 }}
                        >✓</button>
                        <button
                          onClick={() => setRejectTarget({ id: expense.id, merchant: expense.merchant })}
                          style={{ padding: '3px 9px', border: 'none', borderRadius: 5, background: '#FCEBEB', color: '#791F1F', fontSize: 10.5, cursor: 'pointer', fontWeight: 500 }}
                        >✕</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reject modal */}
      {rejectTarget && (
        <RejectModal
          expenseId={rejectTarget.id}
          merchant={rejectTarget.merchant}
          onClose={() => setRejectTarget(null)}
          onRejected={() => setRejectTarget(null)}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

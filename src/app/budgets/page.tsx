'use client'

/**
 * Budget Management page
 * Wired to GET/POST /api/budgets
 */

import React, { useState } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { api } from '@/lib/api/client'
import { useToast, handleApiError } from '@/components/providers/error-system'

interface BudgetUtilization {
  spentAmount: number
  committedAmount: number
  remainingAmount: number
  utilizationPct: number
  committedPct: number
  status: 'OK' | 'WARNING' | 'CRITICAL'
}

interface Budget {
  id: string
  name: string
  period: 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY'
  amount: number
  currency: string
  department?: { id: string; name: string; code: string } | null
  periodRange: { from: string; to: string }
  utilization: BudgetUtilization
  notes?: string
}

interface BudgetData {
  budgets: Budget[]
  summary: { totalBudgeted: number; totalSpent: number; criticalCount: number; warningCount: number }
}

const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)

const STATUS_CONFIG = {
  OK:       { color: '#3B6D11', bg: '#EAF3DE', label: 'On track' },
  WARNING:  { color: '#BA7517', bg: '#FAEEDA', label: 'Approaching limit' },
  CRITICAL: { color: '#A32D2D', bg: '#FCEBEB', label: 'Over 95%' },
}

// ─────────────────────────────────────────────
// UTILIZATION RING
// ─────────────────────────────────────────────

function UtilizationRing({ pct, status, size = 56 }: { pct: number; status: BudgetUtilization['status']; size?: number }) {
  const r = (size / 2) - 5
  const circ = 2 * Math.PI * r
  const cfg = STATUS_CONFIG[status]
  const clampedPct = Math.min(100, pct)

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f0f0ee" strokeWidth={5} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={cfg.color} strokeWidth={5}
          strokeDasharray={`${(clampedPct / 100) * circ} ${circ}`} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: cfg.color }}>
        {Math.round(pct)}%
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// BUDGET CARD
// ─────────────────────────────────────────────

function BudgetCard({ budget, onEdit }: { budget: Budget; onEdit: (b: Budget) => void }) {
  const cfg = STATUS_CONFIG[budget.utilization.status]
  const { spentAmount, committedAmount, remainingAmount, utilizationPct, committedPct } = budget.utilization

  return (
    <div style={{ background: '#fff', border: `.5px solid ${budget.utilization.status !== 'OK' ? cfg.color.replace(')', ',.2)').replace('rgb','rgba') : 'var(--border)'}`, borderRadius: 14, padding: '16px', position: 'relative', overflow: 'hidden' }}>
      {/* Status bar at top */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: cfg.color, opacity: budget.utilization.status === 'OK' ? 0 : 1 }} />

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
        <UtilizationRing pct={utilizationPct} status={budget.utilization.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{budget.name}</div>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 5 }}>
            {budget.department ? `${budget.department.name} · ` : ''}
            {budget.period === 'MONTHLY' ? 'Monthly' : budget.period === 'QUARTERLY' ? 'Quarterly' : 'Annual'} ·{' '}
            {new Date(budget.periodRange.from).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' })} –{' '}
            {new Date(budget.periodRange.to).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' })}
          </div>
          <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 10, background: cfg.bg, color: cfg.color, fontWeight: 500 }}>
            {cfg.label}
          </span>
        </div>
        <button onClick={() => onEdit(budget)}
          style={{ padding: '4px 10px', border: '.5px solid var(--border)', borderRadius: 6, background: '#fff', fontSize: 11, color: '#6B7280', cursor: 'pointer', flexShrink: 0 }}>
          Edit
        </button>
      </div>

      {/* Progress bar with committed overlay */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ height: 8, background: '#f0f0ee', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(100, committedPct)}%`, background: '#D1D5DB', borderRadius: 4 }} />
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(100, utilizationPct)}%`, background: cfg.color, borderRadius: 4, transition: 'width .5s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <span style={{ color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 4, background: cfg.color, borderRadius: 1, display: 'inline-block' }} />
              Spent
            </span>
            <span style={{ color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 4, background: '#D1D5DB', borderRadius: 1, display: 'inline-block' }} />
              Committed
            </span>
          </div>
        </div>
      </div>

      {/* Amounts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
        {[
          ['Spent', fmt(spentAmount, budget.currency), cfg.color],
          ['Committed', fmt(committedAmount, budget.currency), '#9CA3AF'],
          ['Remaining', fmt(remainingAmount, budget.currency), remainingAmount <= 0 ? '#A32D2D' : '#3B6D11'],
        ].map(([label, value, color]) => (
          <div key={label as string} style={{ background: '#fafafa', borderRadius: 7, padding: '7px 9px' }}>
            <div style={{ fontSize: 9.5, color: '#9CA3AF', marginBottom: 2 }}>{label as string}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: color as string }}>{value as string}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#9CA3AF' }}>
        <span>Total budget: <strong style={{ color: '#111827' }}>{fmt(budget.amount, budget.currency)}</strong></span>
        {budget.notes && <span title={budget.notes} style={{ cursor: 'help' }}>📝 Note</span>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// CREATE/EDIT MODAL
// ─────────────────────────────────────────────

function BudgetModal({ budget, onClose, onSaved }: {
  budget?: Budget | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [form, setForm] = useState({
    name: budget?.name ?? '',
    period: budget?.period ?? 'MONTHLY',
    amount: budget?.amount?.toString() ?? '',
    currency: budget?.currency ?? 'EUR',
    departmentId: budget?.department?.id ?? '',
    alertAt80: true,
    alertAt95: true,
    notes: budget?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }))

  async function handleSave() {
    if (!form.name || !form.amount) { toast.error('Name and amount are required'); return }
    setSaving(true)
    try {
      if (budget) {
        await api.patch(`/api/budgets/${budget.id}`, form)
        toast.success('Budget updated')
      } else {
        await api.post('/api/budgets', { ...form, amount: parseFloat(form.amount) })
        toast.success('Budget created')
      }
      invalidateQuery('budgets')
      onSaved()
    } catch (err) {
      handleApiError(err, toast, 'Save budget')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, padding: '22px', width: 480, boxShadow: '0 20px 60px rgba(0,0,0,.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 14.5, fontWeight: 500 }}>{budget ? 'Edit budget' : 'New budget'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9CA3AF' }}>×</button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {[
            { label: 'Budget name *', key: 'name', placeholder: 'Q1 Marketing Budget', type: 'text' },
            { label: 'Amount *', key: 'amount', placeholder: '5000', type: 'number' },
          ].map(({ label, key, placeholder, type }) => (
            <div key={key}>
              <label style={{ fontSize: 11, fontWeight: 500, color: '#4B5563', display: 'block', marginBottom: 4 }}>{label}</label>
              <input type={type} value={form[key as keyof typeof form] as string} onChange={e => set(key)(e.target.value)} placeholder={placeholder}
                style={{ width: '100%', padding: '8px 10px', border: '.5px solid var(--border)', borderRadius: 7, fontSize: 12.5 }} />
            </div>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: '#4B5563', display: 'block', marginBottom: 4 }}>Period</label>
              <select value={form.period} onChange={e => set('period')(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', border: '.5px solid var(--border)', borderRadius: 7, fontSize: 12.5, background: '#fff' }}>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="ANNUALLY">Annual</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: '#4B5563', display: 'block', marginBottom: 4 }}>Currency</label>
              <input value={form.currency} onChange={e => set('currency')(e.target.value)} placeholder="EUR"
                style={{ width: '100%', padding: '8px 10px', border: '.5px solid var(--border)', borderRadius: 7, fontSize: 12.5, fontFamily: 'monospace' }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: '#4B5563', display: 'block', marginBottom: 4 }}>Notes (optional)</label>
            <textarea value={form.notes} onChange={e => set('notes')(e.target.value)} rows={2}
              style={{ width: '100%', padding: '8px 10px', border: '.5px solid var(--border)', borderRadius: 7, fontSize: 12.5, resize: 'vertical' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[['alertAt80', 'Alert at 80% utilization'], ['alertAt95', 'Alert at 95% utilization (critical)']].map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5 }}>
                <input type="checkbox" checked={form[key as keyof typeof form] as boolean} onChange={e => setForm(p => ({ ...p, [key]: e.target.checked }))} />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '.5px solid #f0f0ee' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', border: '.5px solid var(--border)', borderRadius: 8, background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '8px 18px', border: 'none', borderRadius: 8, background: '#1a1a2e', color: '#eaeaf8', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>
            {saving ? 'Saving…' : budget ? 'Save changes' : 'Create budget'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────

export default function BudgetsPage() {
  const toast = useToast()
  const [editingBudget, setEditingBudget] = useState<Budget | null | undefined>(undefined)
  const showModal = editingBudget !== undefined

  const { data: envelope, isLoading, error } = useQuery(
    'budgets',
    () => api.get('/api/budgets'),
    { staleTime: 2 * 60_000 }
  )

  const d = (envelope as { data: BudgetData } | null)?.data

  if (isLoading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid #E8E8E4', borderTopColor: '#185FA5', animation: 'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (error || !d) return <div style={{ padding: '40px', textAlign: 'center', color: '#A32D2D', fontSize: 12 }}>Failed to load budgets</div>

  const critical = d.budgets.filter(b => b.utilization.status === 'CRITICAL')
  const warning = d.budgets.filter(b => b.utilization.status === 'WARNING')
  const ok = d.budgets.filter(b => b.utilization.status === 'OK')

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        {[
          ['Total budgeted', fmt(d.summary.totalBudgeted), '#111827'],
          ['Total spent', fmt(d.summary.totalSpent), '#111827'],
          ['At risk (>80%)', d.summary.warningCount + d.summary.criticalCount, d.summary.criticalCount > 0 ? '#A32D2D' : d.summary.warningCount > 0 ? '#BA7517' : '#27500A'],
          ['Active budgets', d.budgets.length, '#111827'],
        ].map(([label, val, color]) => (
          <div key={label as string} style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, padding: '13px 15px' }}>
            <div style={{ fontSize: 10.5, color: '#9CA3AF', marginBottom: 5 }}>{label as string}</div>
            <div style={{ fontSize: 19, fontWeight: 500, color: color as string }}>{val as string | number}</div>
          </div>
        ))}
      </div>

      {/* Create button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button onClick={() => setEditingBudget(null)}
          style={{ padding: '7px 16px', border: 'none', borderRadius: 8, background: '#1a1a2e', color: '#eaeaf8', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>
          + New budget
        </button>
      </div>

      {/* Critical alerts */}
      {critical.length > 0 && (
        <div style={{ background: '#FCEBEB', border: '.5px solid #F09595', borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 12 }}>
          <strong style={{ color: '#791F1F' }}>⚠ {critical.length} budget{critical.length > 1 ? 's' : ''} critical (≥95%):</strong>{' '}
          <span style={{ color: '#A32D2D' }}>{critical.map(b => b.name).join(', ')}</span>
        </div>
      )}

      {/* Budget grid */}
      {d.budgets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', background: '#fff', border: '.5px solid var(--border)', borderRadius: 14 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>💰</div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>No budgets yet</div>
          <div style={{ fontSize: 12.5, color: '#9CA3AF', marginBottom: 20 }}>Create department budgets to track spend against targets.</div>
          <button onClick={() => setEditingBudget(null)}
            style={{ padding: '8px 20px', border: 'none', borderRadius: 8, background: '#1a1a2e', color: '#eaeaf8', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>
            Create first budget
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>
          {[...critical, ...warning, ...ok].map(b => (
            <BudgetCard key={b.id} budget={b} onEdit={setEditingBudget} />
          ))}
        </div>
      )}

      {showModal && (
        <BudgetModal
          budget={editingBudget}
          onClose={() => setEditingBudget(undefined)}
          onSaved={() => setEditingBudget(undefined)}
        />
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

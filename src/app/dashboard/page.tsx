'use client'

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'

interface DashboardData {
  totalSpendMonth: number
  cashPosition: number
  pendingApprovals: any[]
  missingReceipts: number
  spendByCategory: any[]
  recentTransactions: any[]
  monthlyFlow: any[]
}

function fmt(n: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(d => setData(d?.data ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleApprove(id: string) {
    await fetch(`/api/expenses/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) })
    setData(prev => prev ? { ...prev, pendingApprovals: prev.pendingApprovals.filter((e: any) => e.id !== id) } : prev)
  }

  async function handleReject(id: string) {
    await fetch(`/api/expenses/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject', reason: 'Rejected' }) })
    setData(prev => prev ? { ...prev, pendingApprovals: prev.pendingApprovals.filter((e: any) => e.id !== id) } : prev)
  }

  const kpis = [
    { label: 'Total spend this month', value: loading ? '...' : fmt(data?.totalSpendMonth ?? 0) },
    { label: 'Cash position', value: loading ? '...' : fmt(data?.cashPosition ?? 0), sub: 'Across linked accounts' },
    { label: 'Pending approvals', value: loading ? '...' : String(data?.pendingApprovals?.length ?? 0), color: '#BA7517' },
    { label: 'Missing receipts', value: loading ? '...' : String(data?.missingReceipts ?? 0), color: '#A32D2D' },
  ]

  return (
    <AppShell title="Dashboard" subtitle="Overview">
      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        {kpis.map(k => (
          <div key={k.label} style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: k.color ?? '#111827' }}>{k.value}</div>
            {k.sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Two column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Pending approvals */}
        <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Pending approvals</div>
          {loading ? (
            <div style={{ color: '#9CA3AF', fontSize: 13 }}>Loading...</div>
          ) : !data?.pendingApprovals?.length ? (
            <div style={{ color: '#9CA3AF', fontSize: 13 }}>All caught up - no pending approvals</div>
          ) : (
            data.pendingApprovals.slice(0, 5).map((e: any) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F5F5F3' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#185FA5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
                  {(e.user?.firstName?.[0] ?? '') + (e.user?.lastName?.[0] ?? '')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{e.user?.firstName} {e.user?.lastName}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.merchant}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginRight: 8 }}>{fmt(Number(e.grossAmount))}</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => handleApprove(e.id)} style={{ padding: '3px 10px', border: 'none', borderRadius: 5, background: '#EAF3DE', color: '#27500A', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>Approve</button>
                  <button onClick={() => handleReject(e.id)} style={{ padding: '3px 10px', border: 'none', borderRadius: 5, background: '#FCEBEB', color: '#791F1F', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>Reject</button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Spend by category */}
        <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Spend by category</div>
          {loading ? (
            <div style={{ color: '#9CA3AF', fontSize: 13 }}>Loading...</div>
          ) : !data?.spendByCategory?.length ? (
            <div style={{ color: '#9CA3AF', fontSize: 13 }}>No data yet</div>
          ) : (
            data.spendByCategory.slice(0, 6).map((c: any) => (
              <div key={c.category} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 12 }}>
                  <span style={{ color: '#4B5563' }}>{c.category}</span>
                  <span style={{ fontWeight: 500 }}>{fmt(c.amount)}</span>
                </div>
                <div style={{ height: 4, background: '#F0F0EE', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: '#185FA5', borderRadius: 2, width: `${c.percentage ?? 0}%` }} />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Tax obligations */}
        <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Tax obligations</div>
          {[
            { name: 'USt-Voranmeldung Q1', date: '10 Apr', status: 'Due', color: '#A32D2D', bg: '#FCEBEB' },
            { name: 'Koerperschaftsteuer', date: '31 Mai', status: 'Prep', color: '#633806', bg: '#FAEEDA' },
            { name: 'Gewerbesteuer', date: '15 Jun', status: 'On track', color: '#27500A', bg: '#EAF3DE' },
          ].map(t => (
            <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F5F5F3' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, flex: 1 }}>{t.name}</span>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>{t.date}</span>
              <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 20, background: t.bg, color: t.color }}>{t.status}</span>
            </div>
          ))}
        </div>

        {/* Recent transactions */}
        <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Recent transactions</div>
          {loading ? (
            <div style={{ color: '#9CA3AF', fontSize: 13 }}>Loading...</div>
          ) : !data?.recentTransactions?.length ? (
            <div style={{ color: '#9CA3AF', fontSize: 13 }}>No transactions yet</div>
          ) : (
            data.recentTransactions.slice(0, 5).map((tx: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F5F5F3', fontSize: 12 }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{tx.merchant ?? tx.description}</span>
                <span style={{ color: '#9CA3AF' }}>{tx.transactionDate?.slice(0, 10)}</span>
                <span style={{ fontWeight: 600, color: Number(tx.amount) >= 0 ? '#27500A' : '#111827' }}>
                  {Number(tx.amount) >= 0 ? '+' : ''}{fmt(Math.abs(Number(tx.amount)))}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  )
}

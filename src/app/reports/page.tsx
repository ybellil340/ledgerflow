'use client'

/**
 * Reports page — P&L, Spend Analytics, VAT Summary, Invoice Aging
 *
 * Wired to GET /api/reports?type=...&from=...&to=...
 */

import React, { useState, useCallback } from 'react'
import { useQuery } from '@/lib/hooks'
import { api } from '@/lib/api/client'
import { useToast, handleApiError } from '@/components/providers/error-system'
import { useAuth } from '@/lib/store/auth'

type ReportType = 'pl' | 'spend_by_cat' | 'spend_by_dept' | 'spend_by_user' | 'vat_summary' | 'invoice_aging' | 'approval_kpi' | 'card_usage'

const REPORT_TABS: { id: ReportType; label: string; desc: string; perm?: string }[] = [
  { id: 'pl',           label: 'P&L',           desc: 'Revenue vs costs, gross margin' },
  { id: 'spend_by_cat', label: 'By category',   desc: 'Expense breakdown by category' },
  { id: 'spend_by_dept',label: 'By department', desc: 'Expense breakdown by department' },
  { id: 'spend_by_user',label: 'By employee',   desc: 'Per-employee spend totals' },
  { id: 'vat_summary',  label: 'VAT summary',   desc: 'Input/output VAT for Voranmeldung' },
  { id: 'invoice_aging',label: 'Aging',         desc: 'AP/AR aging buckets' },
  { id: 'approval_kpi', label: 'Approvals',     desc: 'Turnaround times and rates' },
  { id: 'card_usage',   label: 'Card usage',    desc: 'Corporate card utilization' },
]

const PERIODS = [
  { label: 'This month', from: thisMonthStart() },
  { label: 'Last month', from: lastMonthStart(), to: lastMonthEnd() },
  { label: 'Q1 2025', from: '2025-01-01', to: '2025-03-31' },
  { label: 'This year', from: thisYearStart() },
  { label: 'Last 90 days', from: nDaysAgo(90) },
  { label: 'Last 12 months', from: nDaysAgo(365) },
  { label: 'Custom', from: '' },
]

function thisMonthStart() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` }
function thisYearStart() { return `${new Date().getFullYear()}-01-01` }
function lastMonthStart() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); return d.toISOString().split('T')[0] }
function lastMonthEnd() { const d = new Date(); d.setDate(0); return d.toISOString().split('T')[0] }
function nDaysAgo(n: number) { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0] }
function today() { return new Date().toISOString().split('T')[0] }
const fmt = (n: number) => new Intl.NumberFormat('de-DE', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(n)
const fmtPct = (n: number) => `${n.toFixed(1)}%`

// ─────────────────────────────────────────────
// MINI BAR CHART
// ─────────────────────────────────────────────

function HBar({ value, max, color = '#185FA5' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ height: 6, background: '#f0f0ee', borderRadius: 3, overflow: 'hidden', minWidth: 80 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .3s' }} />
    </div>
  )
}

function MonthlyChart({ data }: { data: Array<{ month: string; revenue: number; costs: number; profit: number }> }) {
  const maxVal = Math.max(...data.flatMap(d => [d.revenue, d.costs]), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, padding: '0 0 20px' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%' }}>
          <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', gap: 1 }}>
            <div title={`Revenue: ${fmt(d.revenue)}`} style={{ flex: 1, height: `${(d.revenue/maxVal)*100}%`, background: '#185FA5', borderRadius: '3px 3px 0 0', minHeight: 2 }} />
            <div title={`Costs: ${fmt(d.costs)}`}    style={{ flex: 1, height: `${(d.costs/maxVal)*100}%`, background: '#D3D1C7', borderRadius: '3px 3px 0 0', minHeight: 2 }} />
          </div>
          <span style={{ fontSize: 8, color: '#9CA3AF', whiteSpace: 'nowrap' }}>{d.month.slice(5)}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────
// REPORT VIEWS
// ─────────────────────────────────────────────

function PLReport({ data }: { data: Record<string, unknown> }) {
  const s = data.summary as Record<string, number>
  const monthly = (data.monthly ?? []) as Array<{ month: string; revenue: number; costs: number; profit: number }>
  const isProfit = s.grossProfit >= 0

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        {[
          ['Revenue', s.totalRevenue, '#3B6D11'],
          ['Costs', s.totalCosts, '#A32D2D'],
          ['Gross profit', s.grossProfit, isProfit ? '#3B6D11' : '#A32D2D'],
          ['Gross margin', null, isProfit ? '#3B6D11' : '#A32D2D'],
        ].map(([label, val, color], i) => (
          <div key={i} style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, padding: '13px 15px' }}>
            <div style={{ fontSize: 10.5, color: '#9CA3AF', marginBottom: 5 }}>{label as string}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: color as string }}>
              {i === 3 ? fmtPct(s.grossMargin) : fmt(val as number)}
            </div>
          </div>
        ))}
      </div>

      {monthly.length > 0 && (
        <div style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, padding: 15, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>Monthly overview</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[['#185FA5','Revenue'],['#D3D1C7','Costs']].map(([c,l])=>(
                <span key={l} style={{ fontSize: 10, color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 9, height: 5, background: c, borderRadius: 2, display: 'inline-block' }} />{l}
                </span>
              ))}
            </div>
          </div>
          <MonthlyChart data={monthly} />
        </div>
      )}

      <div style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, padding: 15 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 12 }}>VAT position</div>
        {[
          ['Output VAT (USt — collected from customers)', s.revenueVAT, '#111827'],
          ['Input VAT (VSt — paid to suppliers)', s.costVAT, '#111827'],
          ['Net VAT payable', s.revenueVAT - s.costVAT, (s.revenueVAT - s.costVAT) >= 0 ? '#A32D2D' : '#3B6D11'],
        ].map(([label, val, color]) => (
          <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '.5px solid #f5f5f3' }}>
            <span style={{ fontSize: 12, color: '#4B5563' }}>{label as string}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: color as string }}>{fmt(val as number)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SpendByCatReport({ data }: { data: Record<string, unknown> }) {
  const d = data as { total: number; categories: Array<{ category: string; gross: number; net: number; vat: number; count: number; share: number }> }
  const COLORS: Record<string, string> = { Travel:'#185FA5', Software:'#534AB7', Meals:'#3B6D11', Equipment:'#BA7517', Marketing:'#0F6E56', Office:'#888780' }

  return (
    <div style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, padding: 15 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>Spend by category</div>
        <div style={{ fontSize: 11, color: '#9CA3AF' }}>Total: <strong style={{ color: '#111827' }}>{fmt(d.total)}</strong></div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{['Category','Count','Net','VAT','Gross','Share',''].map(h=>(
            <th key={h} style={{ fontSize: 10.5, fontWeight: 500, color: '#9CA3AF', textAlign: 'left', padding: '0 8px 8px', borderBottom: '.5px solid var(--border)' }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {d.categories.map((r) => (
            <tr key={r.category}>
              <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3', fontSize: 12, fontWeight: 500 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: COLORS[r.category] ?? '#B4B2A9', flexShrink: 0 }} />
                  {r.category}
                </span>
              </td>
              <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3', fontSize: 11.5, color: '#9CA3AF' }}>{r.count}</td>
              <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3', fontSize: 11.5, color: '#4B5563' }}>{fmt(r.net)}</td>
              <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3', fontSize: 11.5, color: '#9CA3AF' }}>{fmt(r.vat)}</td>
              <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3', fontSize: 12, fontWeight: 500 }}>{fmt(r.gross)}</td>
              <td style={{ padding: '8px', borderBottom: '.5px solid #f5f5f3', minWidth: 100 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <HBar value={r.gross} max={d.total} color={COLORS[r.category] ?? '#B4B2A9'} />
                  <span style={{ fontSize: 10.5, color: '#9CA3AF', minWidth: 30 }}>{fmtPct(r.share)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VATReport({ data }: { data: Record<string, unknown> }) {
  const d = data as {
    summary: { totalOutputVAT: number; totalInputVAT: number; vatPayable: number }
    inputVAT: Array<{ vatRate: number; netAmount: number; vatAmount: number; grossAmount: number; expenseCount: number }>
    outputVAT: Array<{ vatCode: string; vatRate: number; netAmount: number; vatAmount: number; grossAmount: number }>
  }
  const isPayable = d.summary.vatPayable >= 0

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
        {[
          ['Output VAT (USt)', d.summary.totalOutputVAT, '#111827'],
          ['Input VAT (VSt)', d.summary.totalInputVAT, '#111827'],
          [isPayable ? 'VAT Payable' : 'VAT Refund', d.summary.vatPayable, isPayable ? '#A32D2D' : '#3B6D11'],
        ].map(([label, val, color]) => (
          <div key={label as string} style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, padding: '13px 15px' }}>
            <div style={{ fontSize: 10.5, color: '#9CA3AF', marginBottom: 5 }}>{label as string}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: color as string }}>{fmt(Math.abs(val as number))}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, padding: 15 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 12 }}>Input VAT (Vorsteuer) by rate</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Rate','Net','VAT','Gross','Items'].map(h=><th key={h} style={{ fontSize: 10.5, fontWeight: 500, color: '#9CA3AF', textAlign: 'left', padding: '0 0 8px', borderBottom: '.5px solid var(--border)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {d.inputVAT.map((r) => (
                <tr key={r.vatRate}>
                  <td style={{ padding: '7px 0', fontSize: 12, fontWeight: 500, borderBottom: '.5px solid #f5f5f3' }}>{r.vatRate}%</td>
                  <td style={{ padding: '7px 0', fontSize: 11.5, color: '#4B5563', borderBottom: '.5px solid #f5f5f3' }}>{fmt(r.netAmount)}</td>
                  <td style={{ padding: '7px 0', fontSize: 11.5, color: '#9CA3AF', borderBottom: '.5px solid #f5f5f3' }}>{fmt(r.vatAmount)}</td>
                  <td style={{ padding: '7px 0', fontSize: 12, fontWeight: 500, borderBottom: '.5px solid #f5f5f3' }}>{fmt(r.grossAmount)}</td>
                  <td style={{ padding: '7px 0', fontSize: 11.5, color: '#9CA3AF', borderBottom: '.5px solid #f5f5f3' }}>{r.expenseCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, padding: 15 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 12 }}>Output VAT (Umsatzsteuer) by code</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Code','Rate','Net','VAT'].map(h=><th key={h} style={{ fontSize: 10.5, fontWeight: 500, color: '#9CA3AF', textAlign: 'left', padding: '0 0 8px', borderBottom: '.5px solid var(--border)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {d.outputVAT.map((r) => (
                <tr key={r.vatCode}>
                  <td style={{ padding: '7px 0', fontSize: 11, fontFamily: 'monospace', borderBottom: '.5px solid #f5f5f3' }}>{r.vatCode}</td>
                  <td style={{ padding: '7px 0', fontSize: 12, fontWeight: 500, borderBottom: '.5px solid #f5f5f3' }}>{r.vatRate}%</td>
                  <td style={{ padding: '7px 0', fontSize: 11.5, color: '#4B5563', borderBottom: '.5px solid #f5f5f3' }}>{fmt(r.netAmount)}</td>
                  <td style={{ padding: '7px 0', fontSize: 11.5, color: '#9CA3AF', borderBottom: '.5px solid #f5f5f3' }}>{fmt(r.vatAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ background: '#EAF3DE', border: '.5px solid #97C459', borderRadius: 10, padding: '11px 14px', marginTop: 12, fontSize: 11.5, color: '#27500A' }}>
        <strong>USt-Voranmeldung:</strong> Use VAT payable figure as your <em>Zahllast</em> or <em>Erstattungsbetrag</em>. Export this report to CSV and forward to your tax advisor.
      </div>
    </div>
  )
}

function GenericTableReport({ data, title }: { data: Record<string, unknown>; title: string }) {
  return (
    <div style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, padding: 15 }}>
      <pre style={{ fontSize: 11, fontFamily: 'monospace', overflow: 'auto', maxHeight: 500, color: '#374151' }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

// ─────────────────────────────────────────────
// REPORTS PAGE
// ─────────────────────────────────────────────

export default function ReportsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const [reportType, setReportType] = useState<ReportType>('pl')
  const [periodIdx, setPeriodIdx] = useState(0)
  const [customFrom, setCustomFrom] = useState(nDaysAgo(30))
  const [customTo, setCustomTo] = useState(today())
  const [exporting, setExporting] = useState(false)

  const period = PERIODS[periodIdx]
  const from = periodIdx === 6 ? customFrom : period.from
  const to = periodIdx === 6 ? customTo : (period.to ?? today())

  const { data: envelope, isLoading, error } = useQuery(
    `report:${reportType}:${from}:${to}`,
    () => api.get(`/api/reports?type=${reportType}&from=${from}&to=${to}`),
    { staleTime: 2 * 60_000 }
  )

  const reportData = (envelope as { data: Record<string, unknown> } | null)?.data

  async function handleExport() {
    setExporting(true)
    try {
      const res = await fetch(`/api/reports?type=${reportType}&from=${from}&to=${to}&format=csv`)
      const csv = await res.text()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ledgerflow-${reportType}-${from}-${to}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Export ready', 'CSV downloaded to your device')
    } catch (err) {
      handleApiError(err, toast, 'Export')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      {/* Header controls */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        {PERIODS.map((p, i) => (
          <button
            key={i}
            onClick={() => setPeriodIdx(i)}
            style={{ padding: '4px 11px', border: '.5px solid', borderRadius: 6, fontSize: 11.5, cursor: 'pointer',
              borderColor: periodIdx === i ? '#185FA5' : 'var(--border)',
              color: periodIdx === i ? '#0C447C' : '#4B5563',
              background: periodIdx === i ? '#E6F1FB' : '#fff' }}
          >{p.label}</button>
        ))}

        {periodIdx === 6 && (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              style={{ padding: '4px 8px', border: '.5px solid var(--border)', borderRadius: 6, fontSize: 11.5 }} />
            <span style={{ fontSize: 11, color: '#9CA3AF' }}>to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              style={{ padding: '4px 8px', border: '.5px solid var(--border)', borderRadius: 6, fontSize: 11.5 }} />
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={handleExport} disabled={exporting || !reportData}
            style={{ padding: '5px 13px', border: '.5px solid var(--border)', borderRadius: 7, background: '#fff', fontSize: 11.5, cursor: 'pointer' }}>
            {exporting ? 'Exporting…' : '↓ Export CSV'}
          </button>
        </div>
      </div>

      {/* Report type tabs */}
      <div style={{ display: 'flex', gap: 2, background: '#f5f5f3', borderRadius: 10, padding: 3, marginBottom: 16, flexWrap: 'wrap' }}>
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setReportType(tab.id)}
            style={{ padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 12, cursor: 'pointer',
              background: reportType === tab.id ? '#fff' : 'transparent',
              color: reportType === tab.id ? '#111827' : '#6B7280',
              fontWeight: reportType === tab.id ? 500 : 400,
              boxShadow: reportType === tab.id ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}
          >{tab.label}</button>
        ))}
      </div>

      {/* Report content */}
      {isLoading && (
        <div style={{ padding: '60px 0', display: 'flex', justifyContent: 'center', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid #E8E8E4', borderTopColor: '#185FA5', animation: 'spin 0.7s linear infinite' }} />
          <div style={{ fontSize: 12, color: '#9CA3AF' }}>Building report…</div>
        </div>
      )}

      {error && (
        <div style={{ padding: '40px', textAlign: 'center', color: '#A32D2D', fontSize: 12 }}>
          Failed to load report: {error.message}
        </div>
      )}

      {!isLoading && !error && reportData && (
        <>
          {reportType === 'pl' && <PLReport data={reportData} />}
          {reportType === 'spend_by_cat' && <SpendByCatReport data={reportData} />}
          {reportType === 'vat_summary' && <VATReport data={reportData} />}
          {['spend_by_dept','spend_by_user','invoice_aging','approval_kpi','card_usage'].includes(reportType) && (
            <GenericTableReport data={reportData} title={REPORT_TABS.find(t=>t.id===reportType)?.label ?? ''} />
          )}
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

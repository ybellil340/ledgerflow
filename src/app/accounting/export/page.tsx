'use client'

import React, { useState, useEffect } from 'react'
import { Button, Badge, Card, Table, Th, Td, Modal, Select, Spinner, EmptyState } from '@/components/ui'
import { Header } from '@/components/layout/AppShell'

interface ExportBatch {
  id: string
  format: string
  status: string
  periodStart: string
  periodEnd: string
  recordCount?: number
  totalAmount?: number
  isLocked: boolean
  lockedAt?: string
  fileName?: string
  fileUrl?: string
  createdAt: string
  _count: { expenses: number; supplierInvoices: number; customerInvoices: number }
}

interface Mapping { id: string; categoryName: string; accountingCode: string; description?: string; vatCode?: { code: string; rate: number } }
interface VATCode { id: string; code: string; description: string; rate: number; datevCode?: string }
interface Readiness { totalExpenses: number; categorized: number; receiptMatched: number; vatAssigned: number; readyToExport: number; percentage: number }

const SKR03_REF = [
  { code: '4670', desc: 'Reisekosten Arbeitnehmer' },
  { code: '4674', desc: 'Bewirtungskosten' },
  { code: '4671', desc: 'Übernachtungskosten' },
  { code: '4980', desc: 'EDV-Kosten' },
  { code: '4830', desc: 'Werkzeuge / Kleingeräte' },
  { code: '4910', desc: 'Bürobedarf' },
  { code: '4920', desc: 'Telefon / Internet' },
  { code: '4600', desc: 'Werbekosten' },
  { code: '4970', desc: 'Beratungskosten / Bankgebühren' },
  { code: '4210', desc: 'Miete und Pacht' },
  { code: '8400', desc: 'Erlöse 19% USt' },
  { code: '8300', desc: 'Erlöse 7% USt' },
]

export default function AccountingPage() {
  const [tab, setTab] = useState<'export' | 'mappings' | 'vat'>('export')
  const [batches, setBatches] = useState<ExportBatch[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [vatCodes, setVatCodes] = useState<VATCode[]>([])
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [exportRes, mappingsRes] = await Promise.all([
        fetch('/api/accounting/export'),
        fetch('/api/accounting/mappings'),
      ])
      const [exportData, mappingsData] = await Promise.all([exportRes.json(), mappingsRes.json()])
      setBatches(exportData.data ?? [])
      setReadiness(exportData.readiness ?? null)
      setMappings(mappingsData.data?.mappings ?? [])
      setVatCodes(mappingsData.data?.vatCodes ?? [])
      setLoading(false)
    }
    load()
  }, [])

  async function seedDefaults() {
    await fetch('/api/accounting/mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seedDefaults: true }) })
    const res = await fetch('/api/accounting/mappings')
    const data = await res.json()
    setMappings(data.data?.mappings ?? [])
  }

  return (
    <>
      <Header
        title="Accounting & Export"
        subtitle="DATEV-ready exports · chart of accounts · VAT codes"
        actions={
          tab === 'export' ? (
            <Button variant="primary" size="sm" onClick={() => setExportOpen(true)}>
              + New export
            </Button>
          ) : tab === 'mappings' && mappings.length === 0 ? (
            <Button variant="secondary" size="sm" onClick={seedDefaults}>
              Seed SKR03 defaults
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {/* Tab bar */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {(['export', 'mappings', 'vat'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all capitalize ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t === 'export' ? 'Export center' : t === 'mappings' ? 'Account mappings' : 'VAT codes'}
            </button>
          ))}
        </div>

        {/* ── EXPORT CENTER ── */}
        {tab === 'export' && (
          <>
            {/* Export readiness */}
            {readiness && (
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-gray-900">Export readiness — current month</div>
                  <div className="flex items-center gap-2">
                    <div className="text-2xl font-bold text-gray-900">{readiness.percentage}%</div>
                    <Badge variant={readiness.percentage >= 90 ? 'green' : readiness.percentage >= 70 ? 'amber' : 'red'}>
                      {readiness.percentage >= 90 ? 'Ready' : readiness.percentage >= 70 ? 'Almost ready' : 'Action needed'}
                    </Badge>
                  </div>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
                  <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${readiness.percentage}%` }} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'Categorized', done: readiness.categorized, total: readiness.totalExpenses },
                    { label: 'Receipt matched', done: readiness.receiptMatched, total: readiness.totalExpenses },
                    { label: 'VAT assigned', done: readiness.vatAssigned, total: readiness.totalExpenses },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600">{item.label}</span>
                        <span className="text-xs font-medium text-gray-900">{item.done}/{item.total}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${item.total > 0 ? (item.done / item.total) * 100 : 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Export history */}
            <Card padding="none">
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="text-sm font-semibold text-gray-900">Export history</div>
              </div>
              {loading ? (
                <div className="flex items-center justify-center h-40"><Spinner /></div>
              ) : batches.length === 0 ? (
                <EmptyState title="No exports yet" description="Create your first DATEV export to get started" action={<Button variant="primary" size="sm" onClick={() => setExportOpen(true)}>+ New export</Button>} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Period</Th>
                      <Th>Format</Th>
                      <Th>Records</Th>
                      <Th className="text-right">Total amount</Th>
                      <Th>Created</Th>
                      <Th>Status</Th>
                      <Th className="w-32" />
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => (
                      <tr key={batch.id} className="hover:bg-gray-50 transition-colors">
                        <Td>
                          <div className="text-sm font-medium text-gray-900">
                            {new Date(batch.periodStart).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}
                            {' – '}
                            {new Date(batch.periodEnd).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}
                          </div>
                          {batch.isLocked && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-[10px] text-purple-600">🔒 Period locked</span>
                            </div>
                          )}
                        </Td>
                        <Td>
                          <Badge variant={batch.format === 'DATEV' ? 'purple' : 'blue'}>{batch.format}</Badge>
                        </Td>
                        <Td>
                          <div className="text-sm text-gray-900">{batch.recordCount ?? 0}</div>
                          <div className="text-[10px] text-gray-400">
                            {batch._count.expenses}exp · {batch._count.supplierInvoices}ap · {batch._count.customerInvoices}ar
                          </div>
                        </Td>
                        <Td className="text-right">
                          <span className="text-sm font-semibold text-gray-900">
                            {batch.totalAmount ? `€${batch.totalAmount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}` : '—'}
                          </span>
                        </Td>
                        <Td>
                          <span className="text-xs text-gray-600">
                            {new Date(batch.createdAt).toLocaleDateString('de-DE')}
                          </span>
                        </Td>
                        <Td>
                          <Badge variant={batch.status === 'COMPLETED' ? 'green' : batch.status === 'FAILED' ? 'red' : 'amber'}>
                            {batch.status}
                          </Badge>
                        </Td>
                        <Td>
                          {batch.status === 'COMPLETED' && batch.fileUrl && (
                            <div className="flex gap-1">
                              <a
                                href={batch.fileUrl}
                                className="px-2 py-1 text-[10px] font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100"
                                download={batch.fileName}
                              >
                                Download
                              </a>
                            </div>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>

            {/* DATEV compliance note */}
            <div className="p-4 bg-purple-50 rounded-xl border border-purple-100 text-sm text-purple-700">
              <div className="font-semibold mb-1">DATEV export format</div>
              <p className="text-xs text-purple-600">
                Exports follow the DATEV Buchungsstapel v700 format (EXTF header, semicolon-delimited, CRLF, UTF-8).
                Compatible with DATEV Unternehmen Online and DATEV Kanzlei-Rechnungswesen. This is not a certified DATEV integration — files must be manually imported. A real-time DATEV sync requires a DATEV developer partnership.
              </p>
            </div>
          </>
        )}

        {/* ── ACCOUNT MAPPINGS ── */}
        {tab === 'mappings' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">Map expense categories to SKR03/SKR04 account codes for DATEV export.</p>
              <Button variant="secondary" size="sm" onClick={seedDefaults}>Seed SKR03 defaults</Button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Card padding="none">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900">Your mappings ({mappings.length})</div>
                </div>
                {mappings.length === 0 ? (
                  <EmptyState title="No mappings yet" description="Seed SKR03 defaults or add mappings manually" />
                ) : (
                  <Table>
                    <thead><tr><Th>Category</Th><Th>Account code</Th><Th>Description</Th><Th>VAT</Th></tr></thead>
                    <tbody>
                      {mappings.map((m) => (
                        <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                          <Td><span className="text-sm font-medium text-gray-900">{m.categoryName}</span></Td>
                          <Td><span className="font-mono text-sm text-blue-700 font-semibold">{m.accountingCode}</span></Td>
                          <Td><span className="text-xs text-gray-500">{m.description}</span></Td>
                          <Td>{m.vatCode ? <Badge variant="blue" size="sm">{m.vatCode.code}</Badge> : <span className="text-xs text-gray-400">—</span>}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>

              <Card>
                <div className="text-sm font-semibold text-gray-900 mb-3">SKR03 reference</div>
                <div className="space-y-1.5">
                  {SKR03_REF.map((ref) => (
                    <div key={ref.code} className="flex items-center gap-3">
                      <span className="font-mono text-sm font-semibold text-blue-700 w-12">{ref.code}</span>
                      <span className="text-xs text-gray-600 flex-1">{ref.desc}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-3">Source: DATEV SKR03 standard chart of accounts. For SKR04, codes differ — consult your Steuerberater.</p>
              </Card>
            </div>
          </>
        )}

        {/* ── VAT CODES ── */}
        {tab === 'vat' && (
          <>
            <p className="text-sm text-gray-600">German VAT codes configured for your organization. Used for DATEV Buchungsschlüssel assignment.</p>
            <Card padding="none">
              <Table>
                <thead>
                  <tr><Th>Code</Th><Th>Description</Th><Th className="text-right">Rate</Th><Th>DATEV Schlüssel</Th><Th>Deductible</Th></tr>
                </thead>
                <tbody>
                  {vatCodes.map((vat) => (
                    <tr key={vat.id} className="hover:bg-gray-50">
                      <Td><span className="font-mono text-sm font-semibold text-purple-700">{vat.code}</span></Td>
                      <Td><span className="text-sm text-gray-900">{vat.description}</span></Td>
                      <Td className="text-right"><span className="text-sm font-semibold tabular-nums">{vat.rate}%</span></Td>
                      <Td>
                        {vat.datevCode
                          ? <span className="font-mono text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded">{vat.datevCode}</span>
                          : <span className="text-xs text-gray-400">—</span>}
                      </Td>
                      <Td>
                        <Badge variant={vat.rate > 0 ? 'green' : 'gray'} size="sm">
                          {vat.rate > 0 ? 'Yes' : 'No'}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                  {vatCodes.length === 0 && (
                    <tr><Td colSpan={5}><div className="text-center py-8 text-sm text-gray-400">No VAT codes configured. They are seeded automatically on organization creation.</div></Td></tr>
                  )}
                </tbody>
              </Table>
            </Card>

            <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 text-sm text-blue-700">
              <div className="font-semibold mb-1">German VAT reference</div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-blue-600 mt-2">
                <div><strong>VSt19</strong> — Standard-Vorsteuer 19% (§12 Abs.1 UStG)</div>
                <div><strong>USt19</strong> — Standard-Umsatzsteuer 19%</div>
                <div><strong>VSt7</strong> — Ermäßigte Vorsteuer 7% (§12 Abs.2 UStG)</div>
                <div><strong>USt7</strong> — Ermäßigte Umsatzsteuer 7%</div>
                <div><strong>EUV</strong> — Innergemeinschaftlicher Erwerb</div>
                <div><strong>EUIG</strong> — Innergemeinschaftliche Lieferung (§4 Nr.1b)</div>
                <div><strong>DRITTLAND</strong> — Reverse Charge / Drittland</div>
                <div><strong>VSt0</strong> — Steuerfreie Eingangsleistungen</div>
              </div>
            </div>
          </>
        )}
      </div>

      <CreateExportModal open={exportOpen} onClose={() => setExportOpen(false)} onCreated={() => { setExportOpen(false); window.location.reload() }} />
    </>
  )
}

function CreateExportModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)

  const [form, setForm] = useState({
    format: 'DATEV', periodStart: firstOfMonth, periodEnd: lastOfMonth,
    includeExpenses: true, includeSupplierInvoices: true, includeCustomerInvoices: true,
    includeReimbursements: true, lockPeriod: false, chartOfAccounts: 'SKR03',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ message: string; recordCount?: number; downloadUrl?: string } | null>(null)

  async function submit() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/accounting/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          periodStart: new Date(form.periodStart).toISOString(),
          periodEnd: new Date(form.periodEnd + 'T23:59:59').toISOString(),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Export failed'); return }
      setResult({ message: data.message, downloadUrl: data.downloadUrl })
    } catch { setError('Network error') } finally { setLoading(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create export" description="Generate a DATEV-ready export package for the selected period"
      footer={result ? <Button variant="primary" onClick={onCreated}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} loading={loading}>Generate export</Button></>}
    >
      {error && <div className="mb-4 p-3 bg-red-50 rounded-lg text-sm text-red-700">{error}</div>}
      {result ? (
        <div className="space-y-4">
          <div className="p-4 bg-green-50 rounded-xl border border-green-200 text-green-700">
            <div className="font-semibold mb-1">Export complete</div>
            <p className="text-sm">{result.message}</p>
          </div>
          {result.downloadUrl && (
            <a href={result.downloadUrl} className="flex items-center gap-2 px-4 py-3 bg-blue-50 rounded-xl text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors" download>
              ↓ Download export file
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Period start</label>
              <input type="date" value={form.periodStart} onChange={(e) => setForm((p) => ({ ...p, periodStart: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Period end</label>
              <input type="date" value={form.periodEnd} onChange={(e) => setForm((p) => ({ ...p, periodEnd: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Export format" value={form.format} onChange={(e) => setForm((p) => ({ ...p, format: e.target.value }))} options={[{ value: 'DATEV', label: 'DATEV Buchungsstapel' }, { value: 'CSV', label: 'Generic CSV' }]} />
            <Select label="Chart of accounts" value={form.chartOfAccounts} onChange={(e) => setForm((p) => ({ ...p, chartOfAccounts: e.target.value }))} options={[{ value: 'SKR03', label: 'SKR03 (standard)' }, { value: 'SKR04', label: 'SKR04 (industry)' }]} />
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-700">Include in export</div>
            {([['includeExpenses', 'Expenses'], ['includeSupplierInvoices', 'Supplier invoices (AP)'], ['includeCustomerInvoices', 'Customer invoices (AR)'], ['includeReimbursements', 'Reimbursements']] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form[key] as boolean} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.checked }))} className="rounded border-gray-300" />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 cursor-pointer p-3 bg-purple-50 rounded-xl border border-purple-100">
            <input type="checkbox" checked={form.lockPeriod} onChange={(e) => setForm((p) => ({ ...p, lockPeriod: e.target.checked }))} className="rounded border-gray-300" />
            <div>
              <div className="text-sm font-medium text-purple-700">Lock period after export</div>
              <div className="text-xs text-purple-500">Prevents re-export and protects data integrity</div>
            </div>
          </label>
        </div>
      )}
    </Modal>
  )
}

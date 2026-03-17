'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { accountingApi } from '@/lib/api/endpoints'
import { useToast } from '@/components/providers/error-system'
import {
  Button, Badge, Modal, Input, Select, Card,
  Spinner, EmptyState, Amount,
} from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExportRecord {
  id: string
  period: string
  format: 'DATEV' | 'CSV'
  recordCount: number
  totalAmount: number
  fileName: string
  exportedAt: string
  exportedBy: string
  isLocked: boolean
  checksum: string
}

interface ExportReadiness {
  period: string
  totalRecords: number
  categorized: number
  receiptMatched: number
  vatAssigned: number
  score: number // 0–100
  issues: { type: string; count: number; description: string }[]
}

interface AccountMapping {
  id: string
  description: string
  accountCode: string
  accountName: string
  vatCode: string
  category: string
}

type Tab = 'export' | 'mappings' | 'vat-codes'

// ─── Generate export modal ─────────────────────────────────────────────────────

function GenerateExportModal({ onClose, onSuccess }: { onClose(): void; onSuccess(): void }) {
  const [form, setForm] = useState({
    periodFrom: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    periodTo: new Date().toISOString().slice(0, 10),
    format: 'DATEV' as 'DATEV' | 'CSV',
    lockPeriod: false,
    skrProfile: 'SKR03' as 'SKR03' | 'SKR04',
  })
  const { toast } = useToast()
  const mutation = useMutation<{ downloadUrl: string; fileName: string; recordCount: number }>()

  async function submit() {
    try {
      const result = await mutation.mutate(() =>
        accountingApi.generateExport({
          periodFrom: form.periodFrom,
          periodTo: form.periodTo,
          format: form.format,
          lockPeriod: form.lockPeriod,
          skrProfile: form.skrProfile,
        })
      )
      toast({
        type: 'success',
        message: `Export ready — ${result?.recordCount ?? 0} records · ${result?.fileName ?? 'export.csv'}`,
      })
      invalidateQuery('accounting')
      onSuccess()
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <Modal title="Generate DATEV export" subtitle="EXTF Buchungsstapel v700 format · SKR03/SKR04" onClose={onClose}>
      <div className="space-y-4">
        <div className="f-row f-2">
          <div>
            <label className="f-label">Period from</label>
            <Input type="date" value={form.periodFrom} onChange={(v) => setForm((f) => ({ ...f, periodFrom: v }))} />
          </div>
          <div>
            <label className="f-label">Period to</label>
            <Input type="date" value={form.periodTo} onChange={(v) => setForm((f) => ({ ...f, periodTo: v }))} />
          </div>
        </div>
        <div className="f-row f-2">
          <div>
            <label className="f-label">Format</label>
            <Select
              value={form.format}
              onChange={(v) => setForm((f) => ({ ...f, format: v as any }))}
              options={[
                { value: 'DATEV', label: 'DATEV Buchungsstapel (EXTF)' },
                { value: 'CSV', label: 'Generic CSV' },
              ]}
            />
          </div>
          <div>
            <label className="f-label">Chart of accounts</label>
            <Select
              value={form.skrProfile}
              onChange={(v) => setForm((f) => ({ ...f, skrProfile: v as any }))}
              options={[
                { value: 'SKR03', label: 'SKR03 — Dienstleistung / Services' },
                { value: 'SKR04', label: 'SKR04 — Industrie / Industry' },
              ]}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.lockPeriod}
            onChange={(e) => setForm((f) => ({ ...f, lockPeriod: e.target.checked }))}
            className="rounded"
          />
          <span className="text-sm text-gray-600">
            Lock period after export <span className="text-gray-400">(prevents re-exporting — recommended)</span>
          </span>
        </label>
        <div className="info-box purple text-xs">
          <strong>DATEV compatibility:</strong> Exports use semicolons as delimiters, CRLF line endings,
          and CP1252 encoding per DATEV EXTF specification. Compatible with DATEV Unternehmen Online
          and Kanzlei-Rechnungswesen.
        </div>
      </div>
      <div className="flex gap-2 mt-5 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={mutation.isLoading}>Generate export</Button>
      </div>
    </Modal>
  )
}

// ─── Readiness gauge ───────────────────────────────────────────────────────────

function ReadinessGauge({ readiness }: { readiness: ExportReadiness }) {
  const score = readiness.score
  const color = score >= 90 ? '#3B6D11' : score >= 70 ? '#BA7517' : '#A32D2D'
  const label = score >= 90 ? 'Ready to export' : score >= 70 ? 'Almost ready' : 'Needs attention'
  const labelVariant = score >= 90 ? 'green' : score >= 70 ? 'amber' : 'red'

  const metrics = [
    { label: 'Categorized', done: readiness.categorized, total: readiness.totalRecords },
    { label: 'Receipt matched', done: readiness.receiptMatched, total: readiness.totalRecords },
    { label: 'VAT assigned', done: readiness.vatAssigned, total: readiness.totalRecords },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="panel-title">Export readiness — {readiness.period}</div>
          <div className="panel-sub">DATEV Buchungsstapel v700 · SKR03</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-medium" style={{ color }}>{score}%</span>
          <Badge label={label} variant={labelVariant as any} />
        </div>
      </div>

      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden mb-4">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, background: color }}
        />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        {metrics.map(({ label, done, total }) => {
          const pct = total > 0 ? Math.round((done / total) * 100) : 0
          return (
            <div key={label}>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-gray-500">{label}</span>
                <span className="text-xs font-medium">{done}/{total}</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      {readiness.issues.length > 0 && (
        <div className="space-y-1.5">
          {readiness.issues.map((issue, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5">
              <span>⚠</span>
              <span>{issue.description}</span>
              <Badge label={String(issue.count)} variant="amber" size="sm" className="ml-auto" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AccountingPage() {
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('export')
  const [showExportModal, setShowExportModal] = useState(false)

  const { data: readiness, isLoading: readinessLoading } = useQuery<ExportReadiness>(
    'accounting/readiness',
    () => accountingApi.getExportReadiness()
  )

  const { data: history, isLoading: historyLoading } = useQuery<ExportRecord[]>(
    'accounting/exports',
    () => accountingApi.listExports()
  )

  const { data: mappings, isLoading: mappingsLoading } = useQuery<AccountMapping[]>(
    'accounting/mappings',
    () => accountingApi.getMappings()
  )

  const TABS: { key: Tab; label: string }[] = [
    { key: 'export', label: 'Export center' },
    { key: 'mappings', label: 'Account mappings' },
    { key: 'vat-codes', label: 'VAT codes' },
  ]

  const VAT_CODES = [
    { code: 'VSt19', rate: '19%', description: 'Domestic purchase, standard rate', skr03: '1576' },
    { code: 'VSt7', rate: '7%', description: 'Domestic purchase, reduced rate', skr03: '1571' },
    { code: 'EUV', rate: '0%', description: 'EU acquisition (reverse charge)', skr03: '1588' },
    { code: 'Drittland', rate: '0%', description: 'Third-country import', skr03: '1588' },
    { code: 'Steuerfrei', rate: '0%', description: 'Tax-exempt service', skr03: '—' },
    { code: 'USt19', rate: '19%', description: 'Outbound revenue, standard rate', skr03: '1776' },
    { code: 'USt7', rate: '7%', description: 'Outbound revenue, reduced rate', skr03: '1771' },
    { code: 'EU-Ausgang', rate: '0%', description: 'EU supply of goods/services', skr03: '1783' },
  ]

  return (
    <AppShell
      title="Accounting & Export"
      subtitle="DATEV-ready exports · SKR03 mappings"
      action={<Button variant="primary" onClick={() => setShowExportModal(true)}>+ Generate DATEV export</Button>}
    >
      {/* Tabs */}
      <div className="tab-bar mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'export' && (
        <>
          {/* Readiness panel */}
          <Card className="mb-4">
            {readinessLoading ? <Spinner /> : readiness ? (
              <ReadinessGauge readiness={readiness} />
            ) : null}
          </Card>

          {/* Export history */}
          <Card>
            <div className="panel-hdr mb-3">
              <span className="panel-title">Export history</span>
            </div>
            {historyLoading ? (
              <Spinner />
            ) : !history?.length ? (
              <EmptyState title="No exports yet" description="Generate your first DATEV export above." />
            ) : (
              <table className="tbl w-full">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Format</th>
                    <th>Records</th>
                    <th>Total amount</th>
                    <th>Exported by</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((exp) => (
                    <tr key={exp.id}>
                      <td>
                        <div className="font-medium">{exp.period}</div>
                        {exp.isLocked && (
                          <div className="text-xs text-purple-600 mt-0.5">🔒 Period locked</div>
                        )}
                      </td>
                      <td><Badge label={exp.format} variant="purple" /></td>
                      <td className="text-gray-500">{exp.recordCount}</td>
                      <td className="font-medium"><Amount value={exp.totalAmount} /></td>
                      <td className="text-gray-400 text-xs">{exp.exportedBy}</td>
                      <td className="text-gray-400 text-xs">{new Date(exp.exportedAt).toLocaleDateString('de-DE')}</td>
                      <td><Badge label="Completed" variant="green" /></td>
                      <td>
                        <a
                          href={`/api/accounting/export/${exp.id}/download`}
                          className="text-blue-600 text-xs hover:underline"
                        >
                          Download
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <div className="info-box purple mt-3 text-xs">
            <strong>Note:</strong> This is a file-based DATEV export (not live sync). Files must be
            manually imported into DATEV Unternehmen Online or Kanzlei-Rechnungswesen.
            Live sync requires an official DATEV developer partnership and BaFin compliance review.
          </div>
        </>
      )}

      {tab === 'mappings' && (
        <Card>
          <div className="panel-hdr mb-3">
            <span className="panel-title">SKR03 account mappings</span>
            <Button variant="ghost" size="sm" onClick={() => accountingApi.seedDefaultMappings().then(() => { toast({ type: 'success', message: 'Default SKR03 mappings seeded' }); invalidateQuery('accounting/mappings') })}>
              Reset to SKR03 defaults
            </Button>
          </div>
          {mappingsLoading ? <Spinner /> : !mappings?.length ? (
            <EmptyState title="No mappings yet" description="Click 'Reset to SKR03 defaults' to load standard mappings." />
          ) : (
            <table className="tbl w-full">
              <thead>
                <tr><th>Category</th><th>Account code</th><th>Account name</th><th>VAT code</th></tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="font-medium text-sm">{m.description}</div>
                      <div className="text-xs text-gray-400">{m.category}</div>
                    </td>
                    <td><span className="font-mono text-xs">{m.accountCode}</span></td>
                    <td className="text-gray-500 text-xs">{m.accountName}</td>
                    <td><Badge label={m.vatCode} variant="purple" size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'vat-codes' && (
        <Card>
          <div className="panel-title mb-3">German VAT code reference</div>
          <table className="tbl w-full">
            <thead>
              <tr><th>Code</th><th>Rate</th><th>Description</th><th>SKR03 account</th></tr>
            </thead>
            <tbody>
              {VAT_CODES.map((vc) => (
                <tr key={vc.code}>
                  <td><Badge label={vc.code} variant="purple" /></td>
                  <td className="font-medium">{vc.rate}</td>
                  <td className="text-gray-500 text-sm">{vc.description}</td>
                  <td><span className="font-mono text-xs text-gray-500">{vc.skr03}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showExportModal && (
        <GenerateExportModal
          onClose={() => setShowExportModal(false)}
          onSuccess={() => setShowExportModal(false)}
        />
      )}
    </AppShell>
  )
}

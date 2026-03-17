'use client'

/**
 * Data Import page — drag-and-drop CSV upload with column mapping and preview
 *
 * Flow:
 *   1. Select import type (expenses, transactions, suppliers, customers, AP invoices)
 *   2. Drag-and-drop or click to upload CSV
 *   3. Auto-detected column mapping (editable)
 *   4. Preview table with error/warning highlights
 *   5. Confirm → import runs, result summary shown
 */

import React, { useState, useCallback, useRef } from 'react'
import { useToast, handleApiError } from '@/components/providers/error-system'
import { invalidateQuery } from '@/lib/hooks'

type ImportType = 'expenses' | 'transactions' | 'suppliers' | 'customers' | 'ap_invoices'

const IMPORT_TYPES: Array<{ id: ImportType; label: string; icon: string; desc: string }> = [
  { id: 'expenses',     label: 'Expenses',      icon: '🧾', desc: 'Import historical expenses with categories and VAT' },
  { id: 'transactions', label: 'Transactions',  icon: '💳', desc: 'Import bank statement transactions' },
  { id: 'suppliers',    label: 'Suppliers',      icon: '🏭', desc: 'Bulk import your supplier directory' },
  { id: 'customers',    label: 'Customers',      icon: '🏢', desc: 'Bulk import your customer directory' },
  { id: 'ap_invoices',  label: 'AP Invoices',   icon: '📄', desc: 'Import historical supplier invoices' },
]

type Step = 'select' | 'upload' | 'mapping' | 'preview' | 'result'

interface ImportPreview {
  totalRows: number
  validRows: number
  errorRows: number
  warningRows: number
  sampleRows: Array<{
    rowNumber: number
    raw: Record<string, string>
    mapped: Record<string, unknown>
    errors: string[]
    warnings: string[]
  }>
  errorSummary: string[]
  columnMapping: Record<string, string>
  detectedColumns: string[]
}

interface ImportResult {
  imported: number
  skipped: number
  errors: number
  totalProcessed: number
  importedIds: string[]
}

// ─────────────────────────────────────────────
// STEP 1 — SELECT TYPE
// ─────────────────────────────────────────────

function SelectType({ onSelect }: { onSelect: (t: ImportType) => void }) {
  return (
    <div>
      <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 4 }}>What would you like to import?</div>
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 18 }}>
        Choose the data type. Download a template below if you need to prepare your file.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
        {IMPORT_TYPES.map(t => (
          <button key={t.id} onClick={() => onSelect(t.id)}
            style={{ padding: '16px 14px', border: '.5px solid var(--border)', borderRadius: 12, background: '#fff', cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}
            onMouseOver={e => { e.currentTarget.style.borderColor = '#185FA5'; e.currentTarget.style.background = '#f9fbff' }}
            onMouseOut={e => { e.currentTarget.style.borderColor = '#E8E8E4'; e.currentTarget.style.background = '#fff' }}
          >
            <div style={{ fontSize: 22, marginBottom: 7 }}>{t.icon}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 3 }}>{t.label}</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.4 }}>{t.desc}</div>
          </button>
        ))}
      </div>
      <div style={{ background: '#f5f5f3', borderRadius: 10, padding: '13px 15px', fontSize: 11.5 }}>
        <div style={{ fontWeight: 600, color: '#4B5563', marginBottom: 8 }}>📥 Download templates</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {IMPORT_TYPES.map(t => (
            <a key={t.id} href={`/api/import?action=template&type=${t.id}`}
              style={{ fontSize: 11.5, color: '#185FA5', padding: '3px 10px', border: '.5px solid #85B7EB', borderRadius: 20, textDecoration: 'none' }}
              download>
              {t.label} CSV
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// STEP 2 — UPLOAD
// ─────────────────────────────────────────────

function UploadFile({ importType, onUploaded }: { importType: ImportType; onUploaded: (preview: ImportPreview, content: string) => void }) {
  const toast = useToast()
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function processFile(file: File) {
    if (!file.name.match(/\.(csv|txt|xlsx?)$/i)) {
      toast.error('Invalid file type', 'Upload a CSV or Excel file')
      return
    }
    setLoading(true)
    try {
      const content = await file.text()
      const form = new FormData()
      form.append('file', file)
      form.append('importType', importType)

      const res = await fetch('/api/import', { method: 'POST', body: form, credentials: 'include' })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      onUploaded(data.data, content)
    } catch (err) {
      handleApiError(err, toast, 'Upload')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
        Importing: <strong style={{ color: '#111827' }}>{IMPORT_TYPES.find(t => t.id === importType)?.label}</strong>
      </div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? '#185FA5' : '#D1D5DB'}`,
          borderRadius: 14, padding: '48px 24px', textAlign: 'center', cursor: 'pointer',
          background: dragging ? '#f0f7ff' : '#fafafa', transition: 'all .2s', marginBottom: 16,
        }}
      >
        <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #E8E8E4', borderTopColor: '#185FA5', animation: 'spin .7s linear infinite' }} />
            <div style={{ fontSize: 12.5, color: '#9CA3AF' }}>Parsing file…</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📂</div>
            <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 5 }}>Drop your CSV file here</div>
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>or click to browse - CSV, Excel - max 10MB</div>
          </>
        )}
      </div>

      <div style={{ background: '#E6F1FB', border: '.5px solid #85B7EB', borderRadius: 8, padding: '10px 12px', fontSize: 11.5, color: '#0C447C' }}>
        <strong>Column detection:</strong> LedgerFlow will automatically detect column names in German and English. Supports comma and semicolon separators, and European number formats (1.234,56).
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ─────────────────────────────────────────────
// STEP 3+4 — MAPPING + PREVIEW
// ─────────────────────────────────────────────

function MappingAndPreview({
  preview, content, importType, onConfirm,
}: {
  preview: ImportPreview; content: string; importType: ImportType
  onConfirm: (result: ImportResult) => void
}) {
  const toast = useToast()
  const [mapping, setMapping] = useState(preview.columnMapping)
  const [confirming, setConfirming] = useState(false)
  const [skipErrors, setSkipErrors] = useState(false)

  async function handleConfirm() {
    setConfirming(true)
    try {
      const res = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content, importType, mapping, skipErrors }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Import failed')

      // Invalidate relevant caches
      invalidateQuery(importType)
      invalidateQuery('dashboard')
      onConfirm(data.data)
    } catch (err) {
      handleApiError(err, toast, 'Import')
    } finally {
      setConfirming(false)
    }
  }

  const readyCount = Math.max(0, preview.validRows - (skipErrors ? 0 : 0))

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
        {[
          ['Total rows', preview.totalRows, '#111827'],
          ['Valid', preview.validRows, '#27500A'],
          ['Warnings', preview.warningRows, '#BA7517'],
          ['Errors', preview.errorRows, '#A32D2D'],
        ].map(([label, val, color]) => (
          <div key={label as string} style={{ padding: '10px 12px', background: '#fff', border: '.5px solid var(--border)', borderRadius: 10 }}>
            <div style={{ fontSize: 10.5, color: '#9CA3AF', marginBottom: 4 }}>{label as string}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: color as string }}>{val as number}</div>
          </div>
        ))}
      </div>

      {/* Error summary */}
      {preview.errorSummary.length > 0 && (
        <div style={{ background: '#FCEBEB', border: '.5px solid #F09595', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 11.5, color: '#791F1F' }}>
          <div style={{ fontWeight: 600, marginBottom: 5 }}>⚠ Issues found:</div>
          {preview.errorSummary.map((err, i) => <div key={i} style={{ padding: '1px 0' }}>• {err}</div>)}
        </div>
      )}

      {/* Column mapping editor */}
      <div style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 10, padding: '13px', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Column mapping</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
          {Object.entries(mapping).map(([field, col]) => (
            <div key={field} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#4B5563', minWidth: 120, background: '#f5f5f3', padding: '3px 8px', borderRadius: 4 }}>{field}</div>
              <span style={{ fontSize: 10, color: '#9CA3AF' }}>→</span>
              <select value={col} onChange={e => setMapping(prev => ({ ...prev, [field]: e.target.value }))}
                style={{ flex: 1, padding: '4px 8px', border: '.5px solid var(--border)', borderRadius: 6, fontSize: 11.5, background: '#fff' }}>
                <option value="">-- unmapped --</option>
                {preview.detectedColumns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Preview table */}
      <div style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '10px 13px', borderBottom: '.5px solid #f0f0ee', fontSize: 12, fontWeight: 600 }}>
          Preview (first 10 rows)
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ background: '#f8f8f6' }}>
                <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#6B7280', borderBottom: '.5px solid #E8E8E4', whiteSpace: 'nowrap' }}>Row</th>
                {preview.detectedColumns.slice(0, 6).map(c => (
                  <th key={c} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#6B7280', borderBottom: '.5px solid #E8E8E4', whiteSpace: 'nowrap' }}>{c}</th>
                ))}
                <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#6B7280', borderBottom: '.5px solid #E8E8E4' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.sampleRows.map(row => (
                <tr key={row.rowNumber} style={{ background: row.errors.length > 0 ? '#FFFBF9' : row.warnings.length > 0 ? '#FEFDF5' : '#fff' }}>
                  <td style={{ padding: '6px 10px', color: '#9CA3AF', borderBottom: '.5px solid #f5f5f3' }}>{row.rowNumber}</td>
                  {preview.detectedColumns.slice(0, 6).map(c => (
                    <td key={c} style={{ padding: '6px 10px', borderBottom: '.5px solid #f5f5f3', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.raw[c] ?? ''}
                    </td>
                  ))}
                  <td style={{ padding: '6px 10px', borderBottom: '.5px solid #f5f5f3' }}>
                    {row.errors.length > 0 ? (
                      <span title={row.errors.join('\n')} style={{ fontSize: 10.5, padding: '1px 7px', background: '#FCEBEB', color: '#A32D2D', borderRadius: 10, cursor: 'help' }}>
                        ✗ {row.errors.length} error{row.errors.length > 1 ? 's' : ''}
                      </span>
                    ) : row.warnings.length > 0 ? (
                      <span title={row.warnings.join('\n')} style={{ fontSize: 10.5, padding: '1px 7px', background: '#FAEEDA', color: '#BA7517', borderRadius: 10, cursor: 'help' }}>
                        ⚠ {row.warnings.length} warning{row.warnings.length > 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10.5, padding: '1px 7px', background: '#EAF3DE', color: '#27500A', borderRadius: 10 }}>✓ valid</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Skip errors toggle */}
      {preview.errorRows > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 12px', background: '#f9f9f7', borderRadius: 8, cursor: 'pointer' }}
          onClick={() => setSkipErrors(p => !p)}>
          <div style={{ width: 16, height: 16, border: `.5px solid ${skipErrors ? '#185FA5' : '#D1D5DB'}`, borderRadius: 4, background: skipErrors ? '#185FA5' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
            {skipErrors && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L4 7L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>}
          </div>
          <div style={{ fontSize: 12 }}>Skip rows with errors and import valid rows only ({preview.validRows} of {preview.totalRows})</div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 11.5, color: '#9CA3AF' }}>
          Ready to import: <strong style={{ color: preview.validRows > 0 ? '#27500A' : '#A32D2D' }}>{skipErrors ? preview.validRows : preview.errorRows > 0 ? preview.validRows : preview.totalRows} rows</strong>
        </div>
        <button onClick={handleConfirm} disabled={confirming || (preview.validRows === 0 && !skipErrors)}
          style={{ padding: '9px 22px', border: 'none', borderRadius: 8, background: '#1a1a2e', color: '#eaeaf8', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: (confirming || preview.validRows === 0) ? 0.6 : 1 }}>
          {confirming && <div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite' }} />}
          {confirming ? 'Importing…' : `Import ${skipErrors ? preview.validRows : preview.validRows} rows`}
        </button>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ─────────────────────────────────────────────
// STEP 5 — RESULT
// ─────────────────────────────────────────────

function ImportResultView({ result, importType, onReset }: { result: ImportResult; importType: ImportType; onReset: () => void }) {
  return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>
        {result.errors === 0 ? '✅' : result.imported > 0 ? '⚠️' : '❌'}
      </div>
      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
        {result.imported > 0 ? 'Import complete!' : 'Import failed'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, margin: '20px auto', maxWidth: 360 }}>
        {[
          ['Imported', result.imported, '#27500A'],
          ['Skipped', result.skipped, '#BA7517'],
          ['Errors', result.errors, '#A32D2D'],
        ].map(([label, val, color]) => (
          <div key={label as string} style={{ padding: '12px', background: '#fff', border: '.5px solid var(--border)', borderRadius: 10 }}>
            <div style={{ fontSize: 10.5, color: '#9CA3AF', marginBottom: 4 }}>{label as string}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: color as string }}>{val as number}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: '#6B7280', marginBottom: 22 }}>
        {result.imported > 0 && `${result.imported} ${importType} records are now in your account.`}
        {result.skipped > 0 && ` ${result.skipped} rows were skipped due to errors.`}
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <a href={`/${importType.replace('_','/').replace('ap_invoices','invoices/ap').replace('expenses','expenses')}`}
          style={{ padding: '8px 18px', border: 'none', borderRadius: 8, background: '#1a1a2e', color: '#eaeaf8', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          View {IMPORT_TYPES.find(t => t.id === importType)?.label} →
        </a>
        <button onClick={onReset}
          style={{ padding: '8px 18px', border: '.5px solid var(--border)', borderRadius: 8, background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>
          Import more
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────

export default function ImportPage() {
  const [step, setStep] = useState<Step>('select')
  const [importType, setImportType] = useState<ImportType>('expenses')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [csvContent, setCsvContent] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  function reset() {
    setStep('select')
    setPreview(null)
    setCsvContent('')
    setResult(null)
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      {/* Progress indicator */}
      {step !== 'select' && step !== 'result' && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, alignItems: 'center' }}>
          {[
            ['select','Type'],['upload','Upload'],['preview','Preview'],
          ].map(([s, label], i) => {
            const steps = ['select','upload','preview']
            const cur = steps.indexOf(step)
            const idx = steps.indexOf(s)
            return (
              <React.Fragment key={s}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: cur >= idx ? '#1a1a2e' : '#f0f0ee', color: cur >= idx ? '#fff' : '#9CA3AF', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {cur > idx ? '✓' : i + 1}
                  </div>
                  <span style={{ fontSize: 11.5, color: cur >= idx ? '#111827' : '#9CA3AF', fontWeight: cur === idx ? 500 : 400 }}>{label}</span>
                </div>
                {i < 2 && <div style={{ flex: 1, height: 1.5, background: cur > idx ? '#1a1a2e' : '#E8E8E4', borderRadius: 1 }} />}
              </React.Fragment>
            )
          })}
        </div>
      )}

      <div style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 14, padding: '24px' }}>
        {step === 'select' && (
          <SelectType onSelect={type => { setImportType(type); setStep('upload') }} />
        )}
        {step === 'upload' && (
          <UploadFile importType={importType} onUploaded={(p, c) => { setPreview(p); setCsvContent(c); setStep('preview') }} />
        )}
        {step === 'preview' && preview && (
          <MappingAndPreview
            preview={preview}
            content={csvContent}
            importType={importType}
            onConfirm={r => { setResult(r); setStep('result') }}
          />
        )}
        {step === 'result' && result && (
          <ImportResultView result={result} importType={importType} onReset={reset} />
        )}
      </div>
    </div>
  )
}

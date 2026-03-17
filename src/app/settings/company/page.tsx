'use client'

/**
 * Company Settings page — profile, DATEV, approval policies, currencies
 * Wired to GET/PATCH /api/settings/company
 */

import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { api } from '@/lib/api/client'
import { useToast, handleApiError } from '@/components/providers/error-system'
import { useAuth } from '@/lib/store/auth'

type Tab = 'profile' | 'datev' | 'approval' | 'currencies' | 'danger'

const LEGAL_FORMS = ['GmbH', 'GmbH & Co. KG', 'AG', 'KG', 'OHG', 'GbR', 'Einzelunternehmen', 'UG (haftungsbeschränkt)', 'Freiberufler']
const SKR_VERSIONS = ['SKR03', 'SKR04', 'SKR70']
const VAT_PERIODS = ['MONTHLY', 'QUARTERLY', 'ANNUALLY']

function InputField({ label, value, onChange, type = 'text', placeholder = '', hint = '', required = false, mono = false }: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; placeholder?: string; hint?: string; required?: boolean; mono?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 500, color: '#4B5563' }}>
        {label}{required && <span style={{ color: '#A32D2D', marginLeft: 2 }}>*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ padding: '7px 10px', border: '.5px solid var(--border)', borderRadius: 7, fontSize: 12.5, outline: 'none', fontFamily: mono ? 'monospace' : 'inherit' }}
      />
      {hint && <div style={{ fontSize: 10.5, color: '#9CA3AF' }}>{hint}</div>}
    </div>
  )
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: Array<string | { value: string; label: string }>
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 500, color: '#4B5563' }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ padding: '7px 10px', border: '.5px solid var(--border)', borderRadius: 7, fontSize: 12.5, outline: 'none', background: '#fff' }}
      >
        {options.map(o => {
          const val = typeof o === 'string' ? o : o.value
          const lbl = typeof o === 'string' ? o : o.label
          return <option key={val} value={val}>{lbl}</option>
        })}
      </select>
    </div>
  )
}

function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '.5px solid #f5f5f3' }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
        {action}
      </div>
      <div style={{ padding: '16px' }}>{children}</div>
    </div>
  )
}

// ─────────────────────────────────────────────
// TAB: COMPANY PROFILE
// ─────────────────────────────────────────────

function ProfileTab({ settings }: { settings: Record<string, unknown> }) {
  const toast = useToast()
  const [form, setForm] = useState({
    name: settings.name as string ?? '',
    legalForm: settings.legalForm as string ?? 'GmbH',
    registrationNumber: settings.registrationNumber as string ?? '',
    vatId: settings.vatId as string ?? '',
    taxNumber: settings.taxNumber as string ?? '',
    street: (settings.address as Record<string, string>)?.street ?? '',
    city: (settings.address as Record<string, string>)?.city ?? '',
    postalCode: (settings.address as Record<string, string>)?.postalCode ?? '',
    state: (settings.address as Record<string, string>)?.state ?? '',
    country: (settings.address as Record<string, string>)?.country ?? 'DE',
    email: (settings.contact as Record<string, string>)?.email ?? '',
    phone: (settings.contact as Record<string, string>)?.phone ?? '',
    website: (settings.contact as Record<string, string>)?.website ?? '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await api.patch('/api/settings/company', {
        section: 'profile',
        name: form.name,
        legalForm: form.legalForm,
        registrationNumber: form.registrationNumber,
        vatId: form.vatId,
        taxNumber: form.taxNumber,
        address: { street: form.street, city: form.city, postalCode: form.postalCode, state: form.state, country: form.country },
        contact: { email: form.email, phone: form.phone, website: form.website },
      })
      toast.success('Company profile saved')
      invalidateQuery('settings-company')
    } catch (err) {
      handleApiError(err, toast, 'Save profile')
    } finally {
      setSaving(false)
    }
  }

  const set = (k: string) => (v: string) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <>
      <SectionCard title="Legal information">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <InputField label="Company name" value={form.name} onChange={set('name')} required />
          <SelectField label="Legal form" value={form.legalForm} onChange={set('legalForm')} options={LEGAL_FORMS} />
          <InputField label="Registration number (HRB/HRA)" value={form.registrationNumber} onChange={set('registrationNumber')} placeholder="HRB 123456 B" mono />
          <InputField label="VAT ID (USt-IdNr.)" value={form.vatId} onChange={set('vatId')} placeholder="DE123456789" mono hint="11-digit German VAT ID. Verified via EU VIES." />
          <InputField label="Tax number (Steuernummer)" value={form.taxNumber} onChange={set('taxNumber')} placeholder="12/345/67890" mono />
        </div>
      </SectionCard>

      <SectionCard title="Address">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <InputField label="Street address" value={form.street} onChange={set('street')} placeholder="Maximilianstraße 45" />
          </div>
          <InputField label="City" value={form.city} onChange={set('city')} placeholder="München" />
          <InputField label="Postal code" value={form.postalCode} onChange={set('postalCode')} placeholder="80331" />
          <InputField label="State (Bundesland)" value={form.state} onChange={set('state')} placeholder="Bayern" />
          <InputField label="Country" value={form.country} onChange={set('country')} placeholder="DE" />
        </div>
      </SectionCard>

      <SectionCard title="Contact">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <InputField label="Billing email" value={form.email} onChange={set('email')} type="email" placeholder="buchhaltung@firma.de" />
          <InputField label="Phone" value={form.phone} onChange={set('phone')} placeholder="+49 89 123456" />
          <InputField label="Website" value={form.website} onChange={set('website')} placeholder="https://www.firma.de" />
        </div>
      </SectionCard>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '8px 20px', border: 'none', borderRadius: 8, background: '#1a1a2e', color: '#eaeaf8', fontSize: 12.5, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────
// TAB: DATEV SETTINGS
// ─────────────────────────────────────────────

function DATEVTab({ settings }: { settings: Record<string, unknown> }) {
  const toast = useToast()
  const datev = settings.datev as Record<string, string> ?? {}
  const [form, setForm] = useState({
    consultantNumber: datev.consultantNumber ?? '',
    clientNumber: datev.clientNumber ?? '',
    skrVersion: datev.skrVersion ?? 'SKR03',
    fiscalYearStart: datev.fiscalYearStart ?? '01-01',
    vatPeriod: datev.vatPeriod ?? 'MONTHLY',
    exportCurrency: datev.exportCurrency ?? 'EUR',
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string) => (v: string) => setForm(prev => ({ ...prev, [k]: v }))

  async function handleSave() {
    setSaving(true)
    try {
      await api.patch('/api/settings/company', { section: 'datev', ...form })
      toast.success('DATEV settings saved')
      invalidateQuery('settings-company')
    } catch (err) {
      handleApiError(err, toast, 'Save DATEV settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SectionCard title="DATEV connection">
        <div style={{ background: '#E6F1FB', border: '.5px solid #85B7EB', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 11.5, color: '#0C447C' }}>
          <strong>About DATEV integration</strong> — LedgerFlow exports Buchungsstapel v700 (EXTF format), which must be manually imported into DATEV Unternehmen Online or DATEV Pro. Live real-time sync requires a DATEV developer partnership — contact your tax advisor.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <InputField label="Berater-Nr. (consultant number)" value={form.consultantNumber} onChange={set('consultantNumber')} placeholder="12345" mono hint="Your tax advisor's DATEV consultant number" />
          <InputField label="Mandanten-Nr. (client number)" value={form.clientNumber} onChange={set('clientNumber')} placeholder="67890" mono hint="Your company's DATEV client number" />
          <SelectField label="Account framework (Kontenrahmen)" value={form.skrVersion} onChange={set('skrVersion')} options={SKR_VERSIONS.map(s => ({ value: s, label: s }))} />
          <SelectField label="VAT filing period (USt-Voranmeldung)" value={form.vatPeriod} onChange={set('vatPeriod')} options={[
            { value: 'MONTHLY', label: 'Monthly (monatlich)' },
            { value: 'QUARTERLY', label: 'Quarterly (vierteljährlich)' },
            { value: 'ANNUALLY', label: 'Annually (jährlich)' },
          ]} />
          <InputField label="Fiscal year start (Wirtschaftsjahr)" value={form.fiscalYearStart} onChange={set('fiscalYearStart')} placeholder="01-01" hint="MM-DD format. Default: 01-01 (calendar year)" />
          <InputField label="Export currency" value={form.exportCurrency} onChange={set('exportCurrency')} placeholder="EUR" hint="All amounts converted to this currency in exports" />
        </div>
      </SectionCard>

      {datev.lastExportAt && (
        <div style={{ background: '#EAF3DE', border: '.5px solid #97C459', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 11.5, color: '#27500A' }}>
          Last DATEV export: <strong>{new Date(datev.lastExportAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '8px 20px', border: 'none', borderRadius: 8, background: '#1a1a2e', color: '#eaeaf8', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>
          {saving ? 'Saving…' : 'Save DATEV settings'}
        </button>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────
// TAB: APPROVAL POLICIES
// ─────────────────────────────────────────────

function ApprovalTab({ settings }: { settings: Record<string, unknown> }) {
  const toast = useToast()
  const existing = (settings.approvalPolicies as Array<Record<string, unknown>>) ?? []
  const [policies, setPolicies] = useState(existing.length > 0 ? existing : [
    { id: undefined, name: 'Standard', threshold: 0, requiresReceiptAbove: 25, steps: [{ level: 1, approverRole: 'FINANCE_MANAGER', timeoutHours: 48 }] },
  ])
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await api.patch('/api/settings/company', { section: 'approval_policies', policies })
      toast.success('Approval policies saved')
      invalidateQuery('settings-company')
    } catch (err) {
      handleApiError(err, toast, 'Save approval policies')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SectionCard title="Approval rules">
        <div style={{ fontSize: 11.5, color: '#6B7280', marginBottom: 14, lineHeight: 1.5 }}>
          Rules are evaluated by threshold — the first matching rule applies. The threshold is the minimum gross expense amount in EUR.
        </div>
        {policies.map((p, i) => (
          <div key={i} style={{ background: '#f9f9f7', border: '.5px solid var(--border)', borderRadius: 8, padding: '13px', marginBottom: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <InputField label="Policy name" value={String(p.name ?? '')} onChange={v => setPolicies(prev => prev.map((x, j) => j === i ? { ...x, name: v } : x))} />
              <InputField label="Min. amount (€)" value={String(p.threshold ?? 0)} onChange={v => setPolicies(prev => prev.map((x, j) => j === i ? { ...x, threshold: Number(v) } : x))} type="number" />
              <InputField label="Receipt required above (€)" value={String(p.requiresReceiptAbove ?? 25)} onChange={v => setPolicies(prev => prev.map((x, j) => j === i ? { ...x, requiresReceiptAbove: Number(v) } : x))} type="number" hint="€0 = always required" />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#4B5563' }}>
                1 approval step · Role: {(p.steps as Array<Record<string, unknown>>)?.[0]?.approverRole as string ?? 'FINANCE_MANAGER'} · Timeout: {(p.steps as Array<Record<string, unknown>>)?.[0]?.timeoutHours as number ?? 48}h
              </div>
              {policies.length > 1 && (
                <button onClick={() => setPolicies(prev => prev.filter((_, j) => j !== i))}
                  style={{ fontSize: 10.5, color: '#A32D2D', background: 'none', border: 'none', cursor: 'pointer' }}>
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
        <button onClick={() => setPolicies(prev => [...prev, { id: undefined, name: `Policy ${prev.length + 1}`, threshold: 500, requiresReceiptAbove: 0, steps: [{ level: 1, approverRole: 'COMPANY_ADMIN', timeoutHours: 72 }] }])}
          style={{ fontSize: 12, color: '#185FA5', background: 'none', border: '.5px solid #85B7EB', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', marginTop: 4 }}>
          + Add policy tier
        </button>
      </SectionCard>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '8px 20px', border: 'none', borderRadius: 8, background: '#1a1a2e', color: '#eaeaf8', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>
          {saving ? 'Saving…' : 'Save policies'}
        </button>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────

export default function CompanySettingsPage() {
  const { can } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('profile')

  const { data: envelope, isLoading, error } = useQuery(
    'settings-company',
    () => api.get('/api/settings/company'),
    { staleTime: 5 * 60_000 }
  )

  const settings = (envelope as { data: Record<string, unknown> } | null)?.data

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: 'profile', label: 'Company profile', show: true },
    { id: 'datev', label: 'DATEV settings', show: true },
    { id: 'approval', label: 'Approval policies', show: can('manage:organization') },
    { id: 'currencies', label: 'Currencies', show: can('manage:organization') },
    { id: 'danger', label: 'Danger zone', show: can('manage:organization') },
  ].filter(t => t.show)

  if (isLoading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid #E8E8E4', borderTopColor: '#185FA5', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (error || !settings) return (
    <div style={{ padding: '40px', textAlign: 'center', color: '#A32D2D', fontSize: 12 }}>
      Failed to load company settings
    </div>
  )

  const statsData = settings.stats as Record<string, number> ?? {}

  return (
    <div>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
        {[
          ['Active members', statsData.activeMembers ?? 0, undefined],
          ['Total expenses', statsData.totalExpenses ?? 0, undefined],
          ['AP invoices', statsData.totalAPInvoices ?? 0, undefined],
          ['AR invoices', statsData.totalARInvoices ?? 0, undefined],
        ].map(([label, val]) => (
          <div key={label as string} style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, padding: '12px 15px' }}>
            <div style={{ fontSize: 10.5, color: '#9CA3AF', marginBottom: 4 }}>{label as string}</div>
            <div style={{ fontSize: 19, fontWeight: 500 }}>{val as number}</div>
          </div>
        ))}
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 2, background: '#f5f5f3', borderRadius: 10, padding: 3, marginBottom: 16 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 12, cursor: 'pointer',
              background: activeTab === t.id ? '#fff' : 'transparent',
              color: t.id === 'danger' ? (activeTab === t.id ? '#A32D2D' : '#9CA3AF') : (activeTab === t.id ? '#111827' : '#6B7280'),
              fontWeight: activeTab === t.id ? 500 : 400,
              boxShadow: activeTab === t.id ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}
          >{t.label}</button>
        ))}
      </div>

      {activeTab === 'profile' && <ProfileTab settings={settings} />}
      {activeTab === 'datev' && <DATEVTab settings={settings} />}
      {activeTab === 'approval' && <ApprovalTab settings={settings} />}
      {activeTab === 'currencies' && (
        <div style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8 }}>Multi-currency support</div>
          <div style={{ fontSize: 11.5, color: '#6B7280', marginBottom: 12 }}>
            Base currency: <strong>EUR</strong> · Rates sourced from ECB (European Central Bank) daily feed · Updated 16:00 CET
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['EUR','USD','GBP','CHF','DKK','SEK','NOK','PLN','CZK','JPY','CNY','CAD','AUD'].map(c => (
              <span key={c} style={{ padding: '3px 10px', background: c === 'EUR' ? '#E6F1FB' : '#f5f5f3', color: c === 'EUR' ? '#0C447C' : '#4B5563', borderRadius: 20, fontSize: 11, fontWeight: 500, fontFamily: 'monospace' }}>{c}</span>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: '#9CA3AF' }}>Full currency management coming in a future release. All expenses are stored in original currency and converted to EUR for reports.</div>
        </div>
      )}
      {activeTab === 'danger' && (
        <div style={{ background: '#fff', border: '.5px solid #F09595', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ background: '#FCEBEB', padding: '12px 16px', borderBottom: '.5px solid #F09595' }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: '#791F1F' }}>⚠ Danger zone</div>
            <div style={{ fontSize: 11, color: '#A32D2D', marginTop: 2 }}>These actions are irreversible. Proceed with extreme caution.</div>
          </div>
          <div style={{ padding: '16px' }}>
            {[
              { title: 'Reset all accounting mappings', desc: 'Removes all custom SKR account mappings. Default mappings will be restored.', btn: 'Reset mappings', color: '#BA7517' },
              { title: 'Delete all draft expenses', desc: 'Permanently deletes all expenses in DRAFT status. Submitted/approved expenses are unaffected.', btn: 'Delete drafts', color: '#A32D2D' },
              { title: 'Delete organization', desc: 'Permanently deletes the organization and all associated data. This cannot be undone. All subscriptions will be cancelled.', btn: 'Delete organization', color: '#A32D2D' },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < 2 ? '.5px solid #f5f5f3' : 'none' }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{item.title}</div>
                  <div style={{ fontSize: 11.5, color: '#6B7280', marginTop: 2 }}>{item.desc}</div>
                </div>
                <button style={{ padding: '6px 14px', border: `.5px solid ${item.color}`, borderRadius: 7, background: '#fff', color: item.color, fontSize: 11.5, cursor: 'pointer', flexShrink: 0, marginLeft: 20 }}>
                  {item.btn}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

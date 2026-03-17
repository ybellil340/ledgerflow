'use client'

/**
 * Onboarding wizard — new company setup flow
 *
 * Steps:
 *   1. Company profile  — legal info, address, VAT ID
 *   2. DATEV setup      — consultant/client numbers, SKR version
 *   3. Invite team      — add first Finance Manager and employees
 *   4. Connect bank     — link via Tink PSD2 (mock for now)
 *   5. First expense    — guided expense creation
 *   6. Done             — completion checklist + go to dashboard
 *
 * Wired to:
 *   PATCH /api/settings/company  (profile, datev sections)
 *   POST  /api/auth/invite       (team invites)
 *   PATCH /api/onboarding        (mark steps complete)
 */

import React, { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api/client'
import { useToast, handleApiError } from '@/components/providers/error-system'
import { useAuth } from '@/lib/store/auth'

type Step = 1 | 2 | 3 | 4 | 5 | 6

const STEPS = [
  { id: 1, label: 'Company', icon: '🏢' },
  { id: 2, label: 'DATEV', icon: '📊' },
  { id: 3, label: 'Team', icon: '👥' },
  { id: 4, label: 'Banking', icon: '🏦' },
  { id: 5, label: 'First expense', icon: '🧾' },
  { id: 6, label: 'Done', icon: '🎉' },
]

// ─────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────

function StepHeader({ step, title, desc }: { step: number; title: string; desc: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#185FA5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>
          {step}
        </div>
        <div style={{ fontSize: 16, fontWeight: 500 }}>{title}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#6B7280', lineHeight: 1.6, paddingLeft: 38 }}>{desc}</div>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 500, color: '#4B5563' }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10.5, color: '#9CA3AF' }}>{hint}</div>}
    </div>
  )
}

function Input({ value, onChange, type = 'text', placeholder = '', mono = false }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string; mono?: boolean
}) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ padding: '8px 10px', border: '.5px solid #E8E8E4', borderRadius: 7, fontSize: 12.5, outline: 'none', fontFamily: mono ? 'monospace' : 'inherit', transition: 'border-color .15s' }}
      onFocus={e => (e.target.style.borderColor = '#185FA5')}
      onBlur={e => (e.target.style.borderColor = '#E8E8E4')}
    />
  )
}

function NavButtons({ onBack, onNext, nextLabel = 'Continue', nextLoading = false, backDisabled = false }: {
  onBack?: () => void; onNext: () => void; nextLabel?: string; nextLoading?: boolean; backDisabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28, paddingTop: 20, borderTop: '.5px solid #f0f0ee' }}>
      {onBack ? (
        <button onClick={onBack} disabled={backDisabled}
          style={{ padding: '8px 18px', border: '.5px solid var(--border)', borderRadius: 8, background: '#fff', fontSize: 12.5, cursor: 'pointer', color: '#4B5563' }}>
          ← Back
        </button>
      ) : <div />}
      <button onClick={onNext} disabled={nextLoading}
        style={{ padding: '9px 24px', border: 'none', borderRadius: 8, background: '#1a1a2e', color: '#eaeaf8', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: nextLoading ? 0.6 : 1 }}>
        {nextLoading && <div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite' }} />}
        {nextLoading ? 'Saving…' : nextLabel}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────
// STEP 1: COMPANY PROFILE
// ─────────────────────────────────────────────

function Step1({ onNext }: { onNext: () => void }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', legalForm: 'GmbH', vatId: '', city: '', street: '', postalCode: '' })
  const set = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }))

  async function handleNext() {
    if (!form.name) { toast.error('Company name is required'); return }
    setSaving(true)
    try {
      await api.patch('/api/settings/company', {
        section: 'profile',
        name: form.name,
        legalForm: form.legalForm,
        vatId: form.vatId,
        address: { city: form.city, street: form.street, postalCode: form.postalCode },
      })
      onNext()
    } catch (err) {
      handleApiError(err, toast, 'Save profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <StepHeader step={1} title="Tell us about your company" desc="This information appears on invoices and DATEV exports. You can update it anytime in Settings." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Company name *">
            <Input value={form.name} onChange={set('name')} placeholder="Müller Consulting GmbH" />
          </Field>
        </div>
        <Field label="Legal form">
          <select value={form.legalForm} onChange={e => set('legalForm')(e.target.value)}
            style={{ padding: '8px 10px', border: '.5px solid #E8E8E4', borderRadius: 7, fontSize: 12.5, background: '#fff' }}>
            {['GmbH','AG','GmbH & Co. KG','KG','OHG','GbR','Einzelunternehmen','UG (haftungsbeschränkt)','Freiberufler'].map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="VAT ID (USt-IdNr.)" hint="Format: DE123456789">
          <Input value={form.vatId} onChange={set('vatId')} placeholder="DE123456789" mono />
        </Field>
        <Field label="Street address">
          <Input value={form.street} onChange={set('street')} placeholder="Maximilianstraße 45" />
        </Field>
        <Field label="City">
          <Input value={form.city} onChange={set('city')} placeholder="München" />
        </Field>
        <Field label="Postal code">
          <Input value={form.postalCode} onChange={set('postalCode')} placeholder="80331" />
        </Field>
      </div>
      <NavButtons onNext={handleNext} nextLoading={saving} nextLabel="Save & continue" />
    </div>
  )
}

// ─────────────────────────────────────────────
// STEP 2: DATEV SETUP
// ─────────────────────────────────────────────

function Step2({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ consultantNumber: '', clientNumber: '', skrVersion: 'SKR03', vatPeriod: 'MONTHLY' })
  const set = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }))

  async function handleNext() {
    setSaving(true)
    try {
      if (form.consultantNumber || form.clientNumber) {
        await api.patch('/api/settings/company', { section: 'datev', ...form })
      }
      onNext()
    } catch (err) {
      handleApiError(err, toast, 'Save DATEV settings')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <StepHeader step={2} title="DATEV configuration" desc="Connect your DATEV account for seamless Buchungsstapel exports. Ask your tax advisor for your Beraternummer and Mandantennummer. You can skip this and add it later." />
      <div style={{ background: '#f9f9f7', border: '.5px solid var(--border)', borderRadius: 10, padding: '14px', marginBottom: 18 }}>
        <div style={{ fontSize: 11.5, fontWeight: 500, color: '#4B5563', marginBottom: 10 }}>📋 What you'll need from your tax advisor</div>
        {['Beraternummer (5-digit consultant number)','Mandantennummer (client number)','Account framework preference (SKR03 or SKR04)','VAT filing frequency'].map(item => (
          <div key={item} style={{ display: 'flex', gap: 8, fontSize: 11.5, color: '#6B7280', padding: '3px 0' }}>
            <span style={{ color: '#185FA5', flexShrink: 0 }}>•</span>{item}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Berater-Nr." hint="Your tax advisor's consultant number">
          <Input value={form.consultantNumber} onChange={set('consultantNumber')} placeholder="12345" mono />
        </Field>
        <Field label="Mandanten-Nr." hint="Your company's client number">
          <Input value={form.clientNumber} onChange={set('clientNumber')} placeholder="67890" mono />
        </Field>
        <Field label="Account framework (Kontenrahmen)">
          <select value={form.skrVersion} onChange={e => set('skrVersion')(e.target.value)}
            style={{ padding: '8px 10px', border: '.5px solid #E8E8E4', borderRadius: 7, fontSize: 12.5, background: '#fff' }}>
            <option value="SKR03">SKR03 (most common for service companies)</option>
            <option value="SKR04">SKR04 (industrial companies)</option>
          </select>
        </Field>
        <Field label="VAT filing period">
          <select value={form.vatPeriod} onChange={e => set('vatPeriod')(e.target.value)}
            style={{ padding: '8px 10px', border: '.5px solid #E8E8E4', borderRadius: 7, fontSize: 12.5, background: '#fff' }}>
            <option value="MONTHLY">Monthly (monatlich)</option>
            <option value="QUARTERLY">Quarterly (vierteljährlich)</option>
            <option value="ANNUALLY">Annually (jährlich)</option>
          </select>
        </Field>
      </div>
      <NavButtons onBack={onBack} onNext={handleNext} nextLoading={saving} nextLabel={form.consultantNumber ? 'Save & continue' : 'Skip for now'} />
    </div>
  )
}

// ─────────────────────────────────────────────
// STEP 3: INVITE TEAM
// ─────────────────────────────────────────────

function Step3({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const toast = useToast()
  const [invites, setInvites] = useState([{ email: '', role: 'FINANCE_MANAGER' }])
  const [sending, setSending] = useState(false)

  async function handleNext() {
    const toSend = invites.filter(i => i.email.trim())
    if (toSend.length === 0) { onNext(); return }
    setSending(true)
    try {
      await Promise.all(toSend.map(i => api.post('/api/auth/invite', { email: i.email, role: i.role })))
      toast.success(`${toSend.length} invitation${toSend.length > 1 ? 's' : ''} sent`)
      onNext()
    } catch (err) {
      handleApiError(err, toast, 'Send invites')
    } finally { setSending(false) }
  }

  return (
    <div>
      <StepHeader step={3} title="Invite your team" desc="Add your Finance Manager, approvers, and employees. They'll receive an email to set up their account. You can always invite more people later." />
      {invites.map((inv, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            {i === 0 && <label style={{ fontSize: 11, fontWeight: 500, color: '#4B5563', display: 'block', marginBottom: 4 }}>Email address</label>}
            <Input value={inv.email} onChange={v => setInvites(prev => prev.map((x, j) => j === i ? { ...x, email: v } : x))} type="email" placeholder="colleague@firma.de" />
          </div>
          <div style={{ width: 160 }}>
            {i === 0 && <label style={{ fontSize: 11, fontWeight: 500, color: '#4B5563', display: 'block', marginBottom: 4 }}>Role</label>}
            <select value={inv.role} onChange={e => setInvites(prev => prev.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}
              style={{ width: '100%', padding: '8px 10px', border: '.5px solid #E8E8E4', borderRadius: 7, fontSize: 12, background: '#fff' }}>
              <option value="COMPANY_ADMIN">Company Admin</option>
              <option value="FINANCE_MANAGER">Finance Manager</option>
              <option value="APPROVER">Approver</option>
              <option value="EMPLOYEE">Employee</option>
            </select>
          </div>
          {invites.length > 1 && (
            <button onClick={() => setInvites(prev => prev.filter((_, j) => j !== i))}
              style={{ padding: '8px', background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 16 }}>×</button>
          )}
        </div>
      ))}
      <button onClick={() => setInvites(prev => [...prev, { email: '', role: 'EMPLOYEE' }])}
        style={{ fontSize: 12, color: '#185FA5', background: 'none', border: '.5px solid #85B7EB', borderRadius: 7, padding: '5px 12px', cursor: 'pointer' }}>
        + Add another
      </button>
      <NavButtons onBack={onBack} onNext={handleNext} nextLoading={sending} nextLabel={invites.some(i => i.email.trim()) ? 'Send invites & continue' : 'Skip for now'} />
    </div>
  )
}

// ─────────────────────────────────────────────
// STEP 4: BANKING
// ─────────────────────────────────────────────

function Step4({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [connecting, setConnecting] = useState(false)

  function handleConnect() {
    setConnecting(true)
    // In production: open Tink Link OAuth flow
    setTimeout(() => { setConnecting(false); onNext() }, 1500)
  }

  return (
    <div>
      <StepHeader step={4} title="Connect your business bank account" desc="Link your bank via Open Banking (PSD2) to automatically import transactions and match receipts. Currently in beta — supported banks listed below." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          ['Deutsche Bank', '#003399', '🏦'],
          ['Commerzbank', '#FFCC00', '🏦'],
          ['Sparkasse', '#FF0000', '🏦'],
          ['N26', '#43A047', '📱'],
          ['Qonto', '#FF5C00', '📱'],
          ['Holvi', '#6C3BFF', '📱'],
        ].map(([name, color, icon]) => (
          <div key={name as string} style={{ border: '.5px solid var(--border)', borderRadius: 10, padding: '14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', transition: 'border-color .15s' }}
            onMouseOver={e => (e.currentTarget.style.borderColor = '#185FA5')}
            onMouseOut={e => (e.currentTarget.style.borderColor = '#E8E8E4')}
          >
            <div style={{ width: 32, height: 32, borderRadius: 8, background: color as string, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{icon}</div>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>{name}</div>
          </div>
        ))}
      </div>
      <div style={{ background: '#FAEEDA', border: '.5px solid #EF9F27', borderRadius: 8, padding: '10px 12px', fontSize: 11.5, color: '#633806', marginBottom: 18 }}>
        <strong>Beta notice:</strong> Open Banking connection uses the Tink PSD2 API. In this demo environment, bank connections are simulated. Production connections require Tink account setup.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={handleConnect} disabled={connecting}
          style={{ padding: '9px 20px', border: 'none', borderRadius: 8, background: '#185FA5', color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', flex: 1 }}>
          {connecting ? 'Connecting…' : 'Connect bank account'}
        </button>
        <button onClick={onNext}
          style={{ padding: '9px 20px', border: '.5px solid var(--border)', borderRadius: 8, background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>
          Skip for now
        </button>
      </div>
      <button onClick={onBack} style={{ marginTop: 12, fontSize: 12, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer' }}>← Back</button>
    </div>
  )
}

// ─────────────────────────────────────────────
// STEP 5: FIRST EXPENSE
// ─────────────────────────────────────────────

function Step5({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ merchant: '', amount: '', date: new Date().toISOString().split('T')[0], category: 'Travel', notes: '' })
  const set = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }))

  async function handleNext() {
    if (!form.merchant || !form.amount) { onNext(); return }
    setSaving(true)
    try {
      await api.post('/api/expenses', {
        merchant: form.merchant,
        grossAmount: parseFloat(form.amount),
        currency: 'EUR',
        expenseDate: form.date,
        categoryId: form.category,
        notes: form.notes,
      })
      toast.success('First expense created!', 'Great start — it\'s waiting for a receipt and approval.')
      onNext()
    } catch (err) {
      handleApiError(err, toast, 'Create expense')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <StepHeader step={5} title="Create your first expense" desc="Let's walk through adding an expense. This will appear in your expense list ready for receipt upload and approval. You can skip this if you prefer." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Merchant / Vendor">
            <Input value={form.merchant} onChange={set('merchant')} placeholder="Lufthansa, AWS, Restaurant…" />
          </Field>
        </div>
        <Field label="Amount (€)">
          <Input value={form.amount} onChange={set('amount')} type="number" placeholder="0.00" />
        </Field>
        <Field label="Date">
          <Input value={form.date} onChange={set('date')} type="date" />
        </Field>
        <Field label="Category">
          <select value={form.category} onChange={e => set('category')(e.target.value)}
            style={{ padding: '8px 10px', border: '.5px solid #E8E8E4', borderRadius: 7, fontSize: 12.5, background: '#fff' }}>
            {['Travel','Software','Meals','Equipment','Marketing','Office','Banking','Other'].map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Notes (optional)">
            <Input value={form.notes} onChange={set('notes')} placeholder="Business purpose, client name…" />
          </Field>
        </div>
      </div>
      <NavButtons onBack={onBack} onNext={handleNext} nextLoading={saving} nextLabel={form.merchant ? 'Create expense & finish' : 'Skip — go to dashboard'} />
    </div>
  )
}

// ─────────────────────────────────────────────
// STEP 6: DONE
// ─────────────────────────────────────────────

function Step6({ onFinish }: { onFinish: () => void }) {
  const checklist = [
    { done: true, label: 'Company profile set up' },
    { done: true, label: 'DATEV configuration saved' },
    { done: true, label: 'Team members invited' },
    { done: false, label: 'Upload your first receipt' },
    { done: false, label: 'Generate your first DATEV export' },
    { done: false, label: 'Connect with your tax advisor' },
  ]

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
      <div style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>You're all set!</div>
      <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 28, lineHeight: 1.6 }}>
        LedgerFlow is ready to use. Here's your setup checklist to get the most out of the platform.
      </div>
      <div style={{ background: '#f9f9f7', border: '.5px solid var(--border)', borderRadius: 12, padding: '16px', marginBottom: 24, textAlign: 'left' }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: '#4B5563', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.5px' }}>Setup checklist</div>
        {checklist.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < checklist.length - 1 ? '.5px solid #f0f0ee' : 'none' }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: item.done ? '#EAF3DE' : '#f5f5f3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {item.done ? <span style={{ fontSize: 10, color: '#27500A', fontWeight: 700 }}>✓</span> : <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#D1D5DB', display: 'inline-block' }} />}
            </div>
            <span style={{ fontSize: 12.5, color: item.done ? '#111827' : '#6B7280' }}>{item.label}</span>
          </div>
        ))}
      </div>
      <button onClick={onFinish}
        style={{ padding: '11px 32px', border: 'none', borderRadius: 10, background: '#1a1a2e', color: '#eaeaf8', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' }}>
        Go to dashboard →
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────
// MAIN ONBOARDING PAGE
// ─────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)

  const next = () => setStep(s => Math.min(6, s + 1) as Step)
  const back = () => setStep(s => Math.max(1, s - 1) as Step)

  const handleFinish = useCallback(async () => {
    try {
      await api.patch('/api/onboarding', { complete: true })
    } finally {
      router.push('/dashboard')
    }
  }, [router])

  const progressPct = ((step - 1) / (STEPS.length - 1)) * 100

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F3', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: 620 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, justifyContent: 'center' }}>
          <div style={{ width: 32, height: 32, background: '#1a1a2e', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="6" height="6" rx="1.5" fill="white" opacity=".9"/><rect x="10" y="2" width="6" height="6" rx="1.5" fill="white" opacity=".4"/><rect x="2" y="10" width="6" height="6" rx="1.5" fill="white" opacity=".4"/><rect x="10" y="10" width="6" height="6" rx="1.5" fill="white" opacity=".7"/></svg>
          </div>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>LedgerFlow</span>
          <span style={{ fontSize: 10, color: '#9CA3AF', background: '#f0f0ee', padding: '1px 7px', borderRadius: 4 }}>Setup</span>
        </div>

        {/* Step indicators */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          {STEPS.map((s, i) => (
            <React.Fragment key={s.id}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: i < STEPS.length - 1 ? '0 0 auto' : '0 0 auto' }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: step > s.id ? '#EAF3DE' : step === s.id ? '#1a1a2e' : '#f0f0ee',
                  color: step > s.id ? '#27500A' : step === s.id ? '#fff' : '#9CA3AF',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: step > s.id ? 13 : 11, fontWeight: 600, transition: 'all .2s',
                }}>
                  {step > s.id ? '✓' : s.icon}
                </div>
                <div style={{ fontSize: 9.5, color: step === s.id ? '#111827' : '#9CA3AF', fontWeight: step === s.id ? 500 : 400, whiteSpace: 'nowrap' }}>
                  {s.label}
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: 2, background: step > s.id ? '#97C459' : '#f0f0ee', margin: '0 6px 18px', borderRadius: 1, transition: 'background .3s' }} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Card */}
        <div style={{ background: '#fff', borderRadius: 16, border: '.5px solid var(--border)', padding: '28px', boxShadow: '0 4px 24px rgba(0,0,0,.06)' }}>
          {step === 1 && <Step1 onNext={next} />}
          {step === 2 && <Step2 onNext={next} onBack={back} />}
          {step === 3 && <Step3 onNext={next} onBack={back} />}
          {step === 4 && <Step4 onNext={next} onBack={back} />}
          {step === 5 && <Step5 onNext={next} onBack={back} />}
          {step === 6 && <Step6 onFinish={handleFinish} />}
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: '#9CA3AF' }}>
          Step {step} of {STEPS.length} - All data encrypted at rest - DSGVO-konform
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

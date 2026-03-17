export const dynamic = 'force-dynamic'

'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Input, Select } from '@/components/ui'

const LEGAL_FORMS = [
  { value: 'GmbH', label: 'GmbH — Gesellschaft mit beschränkter Haftung' },
  { value: 'AG', label: 'AG — Aktiengesellschaft' },
  { value: 'GbR', label: 'GbR — Gesellschaft bürgerlichen Rechts' },
  { value: 'KG', label: 'KG — Kommanditgesellschaft' },
  { value: 'OHG', label: 'OHG — Offene Handelsgesellschaft' },
  { value: 'UG', label: 'UG — Unternehmergesellschaft' },
  { value: 'e.K.', label: 'e.K. — Eingetragener Kaufmann' },
  { value: 'Freelancer', label: 'Freiberufler / Einzelunternehmer' },
]

const INDUSTRIES = [
  { value: 'consulting', label: 'Consulting & Professional Services' },
  { value: 'technology', label: 'Technology & Software' },
  { value: 'logistics', label: 'Logistics & Transport' },
  { value: 'marketing', label: 'Marketing & Creative' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'retail', label: 'Retail & E-Commerce' },
  { value: 'healthcare', label: 'Healthcare & Life Sciences' },
  { value: 'finance', label: 'Finance & Insurance' },
  { value: 'construction', label: 'Construction & Real Estate' },
  { value: 'other', label: 'Other' },
]

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '',
    organizationName: '', legalForm: '', vatId: '', industry: '',
  })

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (step === 1) { setStep(2); return }

    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Signup failed'); return }
      router.push('/dashboard')
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-[460px]">

        {/* Logo */}
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-8 h-8 bg-[#1a1a2e] rounded-xl flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="5.5" height="5.5" rx="1" fill="white" opacity="0.9"/>
              <rect x="8.5" y="2" width="5.5" height="5.5" rx="1" fill="white" opacity="0.4"/>
              <rect x="2" y="8.5" width="5.5" height="5.5" rx="1" fill="white" opacity="0.4"/>
              <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" fill="white" opacity="0.7"/>
            </svg>
          </div>
          <span className="font-semibold text-gray-900 text-lg">LedgerFlow</span>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2].map((s) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-2 ${s === step ? 'text-blue-700' : s < step ? 'text-green-600' : 'text-gray-400'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                  s < step ? 'bg-green-100 text-green-700' :
                  s === step ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {s < step ? '✓' : s}
                </div>
                <span className="text-xs font-medium hidden sm:block">
                  {s === 1 ? 'Your account' : 'Company details'}
                </span>
              </div>
              {s < 2 && <div className={`flex-1 h-px ${s < step ? 'bg-green-200' : 'bg-gray-200'}`} />}
            </React.Fragment>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-gray-900">
              {step === 1 ? 'Create your account' : 'Company details'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {step === 1 ? '14-day free trial, no credit card required' : 'Tell us about your business for DATEV setup'}
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {step === 1 ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="First name" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="Katrin" required />
                  <Input label="Last name" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="Müller" required />
                </div>
                <Input label="Work email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="katrin@firma.de" required />
                <Input
                  label="Password"
                  type="password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  placeholder="Min. 8 characters"
                  hint="Use a mix of letters, numbers and symbols"
                  required
                />
              </>
            ) : (
              <>
                <Input label="Company name" value={form.organizationName} onChange={(e) => set('organizationName', e.target.value)} placeholder="Müller GmbH" required />
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Legal form" value={form.legalForm} onChange={(e) => set('legalForm', e.target.value)} options={LEGAL_FORMS} placeholder="Select..." />
                  <Input label="VAT ID (optional)" value={form.vatId} onChange={(e) => set('vatId', e.target.value)} placeholder="DE123456789" hint="Format: DE + 9 digits" />
                </div>
                <Select label="Industry" value={form.industry} onChange={(e) => set('industry', e.target.value)} options={INDUSTRIES} placeholder="Select your industry" />

                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700">
                  <div className="font-semibold mb-1">What you get on your trial:</div>
                  <ul className="space-y-0.5 text-blue-600">
                    <li>✓ Up to 5 users and 10 corporate cards</li>
                    <li>✓ DATEV-ready expense exports</li>
                    <li>✓ Tax advisor collaboration portal</li>
                    <li>✓ German VAT logic (7%, 19%, EU rates)</li>
                  </ul>
                </div>
              </>
            )}

            <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
              {step === 1 ? 'Continue →' : 'Create account'}
            </Button>
          </form>

          {step === 1 && (
            <p className="mt-4 text-center text-sm text-gray-500">
              Already have an account?{' '}
              <Link href="/login" className="text-blue-600 font-medium hover:underline">Sign in</Link>
            </p>
          )}

          {step === 2 && (
            <button onClick={() => setStep(1)} className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-700">
              ← Back
            </button>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          By creating an account you agree to our{' '}
          <a href="#" className="underline">Terms of Service</a> and{' '}
          <a href="#" className="underline">Privacy Policy</a> (DSGVO-konform)
        </p>
      </div>
    </div>
  )
}

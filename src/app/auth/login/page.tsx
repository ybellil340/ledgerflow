'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Input } from '@/components/ui'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Login failed')
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left branding panel */}
      <div className="hidden lg:flex w-[480px] bg-[#1a1a2e] flex-col justify-between p-12 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/10 rounded-xl flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="2" y="2" width="6" height="6" rx="1.5" fill="white" opacity="0.9"/>
              <rect x="10" y="2" width="6" height="6" rx="1.5" fill="white" opacity="0.4"/>
              <rect x="2" y="10" width="6" height="6" rx="1.5" fill="white" opacity="0.4"/>
              <rect x="10" y="10" width="6" height="6" rx="1.5" fill="white" opacity="0.7"/>
            </svg>
          </div>
          <span className="text-white font-semibold text-lg">LedgerFlow</span>
        </div>
        <div>
          <p className="text-white/70 text-lg leading-relaxed mb-8 font-light">
            &ldquo;Finally a financial platform that understands German SMEs — DATEV, VAT logic, tax advisor collaboration in one place.&rdquo;
          </p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-semibold text-sm">KM</div>
            <div>
              <div className="text-white font-medium text-sm">Katrin Müller</div>
              <div className="text-white/50 text-xs">CFO, Müller Consulting GmbH</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[['€2.4M','Processed monthly'],['98%','DATEV accuracy'],['3h','Saved per week']].map(([v,l]) => (
            <div key={l} className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="text-white font-bold text-xl">{v}</div>
              <div className="text-white/50 text-xs mt-0.5">{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1.5">Welcome back</h1>
            <p className="text-sm text-gray-500">Sign in to your LedgerFlow account</p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="katrin@mueller-consulting.de"
                autoComplete="email"
                required
                className="w-full h-9 border border-gray-200 rounded-lg px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className="w-full h-9 border border-gray-200 rounded-lg px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-[#185FA5] text-white rounded-lg font-medium text-sm hover:bg-[#0C447C] transition-colors disabled:opacity-50 mt-2"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          {/* Demo credentials */}
          <div className="mt-8 p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div className="text-xs font-semibold text-gray-700 mb-2.5">Demo — click to fill</div>
            <div className="space-y-1.5">
              {[
                { role: 'Company Admin',    email: 'katrin.mueller@mueller-consulting.de' },
                { role: 'Finance Manager',  email: 'sara.mayer@mueller-consulting.de' },
                { role: 'Tax Advisor',      email: 'weber@weber-partner.de' },
              ].map((cred) => (
                <button
                  key={cred.email}
                  type="button"
                  onClick={() => { setEmail(cred.email); setPassword('demo123') }}
                  className="w-full flex items-center justify-between text-left p-2 rounded-lg hover:bg-white transition-colors border border-transparent hover:border-gray-200"
                >
                  <span className="text-xs font-medium text-gray-700">{cred.role}</span>
                  <span className="text-[10px] text-gray-400 font-mono">{cred.email.split('@')[0]}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">
              Password: <code className="bg-gray-100 px-1 rounded">demo123</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

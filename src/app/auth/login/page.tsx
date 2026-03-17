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
        body: JSON.stringify({ email, password }),
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
      {/* Left panel — brand */}
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
          <span className="text-white font-semibold text-lg tracking-tight">LedgerFlow</span>
        </div>

        <div>
          <blockquote className="text-white/70 text-lg leading-relaxed mb-8 font-light">
            "Finally, a financial platform that actually understands how German SMEs work — DATEV exports, VAT logic, tax advisor collaboration all in one place."
          </blockquote>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-semibold text-sm">KM</div>
            <div>
              <div className="text-white font-medium text-sm">Katrin Müller</div>
              <div className="text-white/50 text-xs">CFO, Müller Consulting GmbH</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            { value: '€2.4M', label: 'Processed monthly' },
            { value: '98%', label: 'DATEV accuracy' },
            { value: '3h', label: 'Saved per week' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="text-white font-bold text-xl">{stat.value}</div>
              <div className="text-white/50 text-xs mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-10 lg:hidden">
            <div className="w-7 h-7 bg-[#1a1a2e] rounded-lg flex items-center justify-center">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <rect x="1.5" y="1.5" width="5" height="5" rx="1" fill="white"/>
                <rect x="8.5" y="1.5" width="5" height="5" rx="1" fill="white" opacity="0.5"/>
                <rect x="1.5" y="8.5" width="5" height="5" rx="1" fill="white" opacity="0.5"/>
                <rect x="8.5" y="8.5" width="5" height="5" rx="1" fill="white" opacity="0.7"/>
              </svg>
            </div>
            <span className="font-semibold text-gray-900">LedgerFlow</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1.5">Welcome back</h1>
            <p className="text-sm text-gray-500">Sign in to your LedgerFlow account</p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700 flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.962-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="katrin@mueller-consulting.de"
              autoComplete="email"
              required
            />
            <div>
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <div className="mt-1.5 text-right">
                <Link href="/forgot-password" className="text-xs text-blue-600 hover:underline">
                  Forgot password?
                </Link>
              </div>
            </div>

            <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full mt-2">
              Sign in
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-500">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-blue-600 font-medium hover:underline">
              Start free trial
            </Link>
          </div>

          {/* Demo credentials */}
          <div className="mt-8 p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div className="text-xs font-semibold text-gray-700 mb-2.5">Demo credentials</div>
            <div className="space-y-1.5">
              {[
                { role: 'Company Admin', email: 'katrin.mueller@mueller-consulting.de' },
                { role: 'Finance Manager', email: 'thomas.huber@mueller-consulting.de' },
                { role: 'Tax Advisor', email: 'weber@weber-partner.de' },
              ].map((cred) => (
                <button
                  key={cred.email}
                  type="button"
                  onClick={() => { setEmail(cred.email); setPassword('demo123') }}
                  className="w-full flex items-center justify-between text-left p-2 rounded-lg hover:bg-white transition-colors border border-transparent hover:border-gray-200"
                >
                  <span className="text-xs font-medium text-gray-700">{cred.role}</span>
                  <span className="text-[10px] text-gray-400">{cred.email}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">Password: <code className="bg-gray-100 px-1 rounded">demo123</code></p>
          </div>
        </div>
      </div>
    </div>
  )
}

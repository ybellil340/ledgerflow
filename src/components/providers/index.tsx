'use client'

/**
 * Root Providers
 *
 * Wrap the entire app with:
 *   AuthProvider     → session, login/logout, permission helpers
 *   ToastProvider    → global toast queue
 *   ErrorBoundary    → catch render errors
 *
 * Used in src/app/layout.tsx
 */

import React from 'react'
import { AuthProvider } from '@/lib/store/auth'
import { ToastProvider } from '@/components/providers/error-system'
import { ErrorBoundary } from '@/components/providers/error-system'
import type { SessionUser } from '@/types'

interface ProvidersProps {
  children: React.ReactNode
  initialUser?: SessionUser | null
}

export function Providers({ children, initialUser }: ProvidersProps) {
  return (
    <ErrorBoundary>
      <AuthProvider initialUser={initialUser}>
        <ToastProvider>
          {children}
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}

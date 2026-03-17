'use client'

/**
 * LedgerFlow Auth Context
 *
 * Provides:
 * - Session state (user, org, role, permissions)
 * - login / logout / switchOrganization actions
 * - Permission helpers (can(), hasRole(), isSuperAdmin)
 * - Auto-redirect on 401 via global error handler
 * - Session refresh on window focus
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { authApi } from '@/lib/api/endpoints'
import { AuthError } from '@/lib/api/client'
import type { SessionUser, UserRole } from '@/types'

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export type Permission =
  | 'manage:expenses' | 'approve:expenses'
  | 'manage:cards' | 'manage:invoices'
  | 'manage:accounting' | 'export:accounting'
  | 'manage:users' | 'manage:organization'
  | 'manage:billing' | 'manage:tax_advisor'
  | 'view:analytics' | 'super_admin'

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: [
    'manage:expenses', 'approve:expenses', 'manage:cards', 'manage:invoices',
    'manage:accounting', 'export:accounting', 'manage:users', 'manage:organization',
    'manage:billing', 'manage:tax_advisor', 'view:analytics', 'super_admin',
  ],
  COMPANY_ADMIN: [
    'manage:expenses', 'approve:expenses', 'manage:cards', 'manage:invoices',
    'manage:accounting', 'export:accounting', 'manage:users', 'manage:organization',
    'manage:billing', 'view:analytics',
  ],
  FINANCE_MANAGER: [
    'manage:expenses', 'approve:expenses', 'manage:cards', 'manage:invoices',
    'manage:accounting', 'export:accounting', 'view:analytics',
  ],
  APPROVER: ['manage:expenses', 'approve:expenses', 'view:analytics'],
  EMPLOYEE: ['manage:expenses', 'view:analytics'],
  TAX_ADVISOR: ['export:accounting', 'manage:tax_advisor', 'view:analytics'],
}

// ─────────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────────

interface AuthContextValue {
  user: SessionUser | null
  isLoading: boolean
  isAuthenticated: boolean

  login: (email: string, password: string, organizationId?: string) => Promise<void>
  logout: () => Promise<void>
  switchOrganization: (orgId: string) => Promise<void>

  can: (permission: Permission) => boolean
  hasRole: (role: UserRole | UserRole[]) => boolean
  isSuperAdmin: boolean
  isTaxAdvisor: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

// ─────────────────────────────────────────────
// PROVIDER
// ─────────────────────────────────────────────

interface AuthProviderProps {
  children: React.ReactNode
  /** Initial session from server-side rendering */
  initialUser?: SessionUser | null
}

export function AuthProvider({ children, initialUser = null }: AuthProviderProps) {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(initialUser)
  const [isLoading, setIsLoading] = useState(!initialUser)
  const focusHandlerRef = useRef<() => void>()

  // ─── Bootstrap from cookie on mount ───────
  useEffect(() => {
    if (initialUser) return // SSR pre-loaded, skip fetch

    let mounted = true

    async function hydrateSession() {
      try {
        // We hit the login endpoint with no body — if the cookie is valid,
        // the server returns the session user without needing credentials
        const res = await fetch('/api/auth/me', { credentials: 'include' })
        if (res.ok && mounted) {
          const { data } = await res.json()
          setUser(data)
        }
      } catch {
        // No session — stay on login
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    hydrateSession()
    return () => { mounted = false }
  }, [initialUser])

  // ─── Session refresh on window focus ──────
  useEffect(() => {
    focusHandlerRef.current = async () => {
      if (!user) return
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' })
        if (res.status === 401) {
          setUser(null)
          router.push('/login?reason=session_expired')
        } else if (res.ok) {
          const { data } = await res.json()
          setUser(data)
        }
      } catch {}
    }

    window.addEventListener('focus', focusHandlerRef.current)
    return () => {
      if (focusHandlerRef.current) {
        window.removeEventListener('focus', focusHandlerRef.current)
      }
    }
  }, [user, router])

  // ─── Global 401 → redirect ─────────────────
  useEffect(() => {
    const handler = (event: Event) => {
      const e = event as CustomEvent
      if (e.detail?.type === 'auth_error') {
        setUser(null)
        router.push('/login?reason=session_expired')
      }
    }
    window.addEventListener('ledgerflow:auth_error', handler)
    return () => window.removeEventListener('ledgerflow:auth_error', handler)
  }, [router])

  // ─── ACTIONS ──────────────────────────────

  const login = useCallback(async (email: string, password: string, organizationId?: string) => {
    setIsLoading(true)
    try {
      const { data } = await authApi.login(email, password, organizationId)
      setUser(data.user)
      router.push('/dashboard')
    } finally {
      setIsLoading(false)
    }
  }, [router])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
      router.push('/login')
    }
  }, [router])

  const switchOrganization = useCallback(async (orgId: string) => {
    setIsLoading(true)
    try {
      const { data } = await authApi.login('', '', orgId) // Server reads session + new org
      setUser(data.user)
      router.refresh()
    } finally {
      setIsLoading(false)
    }
  }, [router])

  // ─── PERMISSION HELPERS ───────────────────

  const can = useCallback((permission: Permission): boolean => {
    if (!user) return false
    const perms = ROLE_PERMISSIONS[user.currentRole] ?? []
    return perms.includes(permission)
  }, [user])

  const hasRole = useCallback((role: UserRole | UserRole[]): boolean => {
    if (!user) return false
    const roles = Array.isArray(role) ? role : [role]
    return roles.includes(user.currentRole)
  }, [user])

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    switchOrganization,
    can,
    hasRole,
    isSuperAdmin: user?.isSuperAdmin ?? false,
    isTaxAdvisor: user?.isTaxAdvisor ?? false,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ─────────────────────────────────────────────
// ROUTE GUARD HOC
// ─────────────────────────────────────────────

interface RequireAuthProps {
  children: React.ReactNode
  permission?: Permission
  role?: UserRole | UserRole[]
  fallback?: React.ReactNode
}

export function RequireAuth({ children, permission, role, fallback }: RequireAuthProps) {
  const { isAuthenticated, isLoading, can, hasRole } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login')
    }
  }, [isLoading, isAuthenticated, router])

  if (isLoading) return null

  if (!isAuthenticated) return null

  if (permission && !can(permission)) {
    return fallback ? <>{fallback}</> : (
      <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink3)' }}>
        <p style={{ fontWeight: 500, marginBottom: 6 }}>Access restricted</p>
        <p style={{ fontSize: 12 }}>You don't have permission to view this page.</p>
      </div>
    )
  }

  if (role && !hasRole(role)) {
    return fallback ? <>{fallback}</> : null
  }

  return <>{children}</>
}

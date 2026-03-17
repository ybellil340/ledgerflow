'use client'

/**
 * Error Boundary + Toast System
 *
 * ErrorBoundary    — catches React render errors, shows friendly fallback
 * ToastProvider    — global toast queue with auto-dismiss
 * useToast         — hook to dispatch toasts from anywhere
 * handleApiError   — converts ApiError → user-friendly toast
 */

import React, {
  createContext, useContext, useCallback, useState,
  useReducer, Component, ReactNode, useEffect, useRef,
} from 'react'
import { ApiError, AuthError, ForbiddenError, ValidationError, RateLimitError, NetworkError } from '@/lib/api/client'

// ─────────────────────────────────────────────
// TOAST SYSTEM
// ─────────────────────────────────────────────

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  variant: ToastVariant
  title: string
  message?: string
  duration?: number  // ms, 0 = sticky
  action?: { label: string; onClick: () => void }
}

interface ToastContextValue {
  toasts: Toast[]
  toast: (t: Omit<Toast, 'id'>) => string
  dismiss: (id: string) => void
  dismissAll: () => void
  success: (title: string, message?: string) => string
  error: (title: string, message?: string) => string
  warning: (title: string, message?: string) => string
  info: (title: string, message?: string) => string
}

const ToastContext = createContext<ToastContextValue | null>(null)

type ToastAction =
  | { type: 'ADD'; toast: Toast }
  | { type: 'DISMISS'; id: string }
  | { type: 'DISMISS_ALL' }

function toastReducer(state: Toast[], action: ToastAction): Toast[] {
  switch (action.type) {
    case 'ADD': return [...state, action.toast]
    case 'DISMISS': return state.filter((t) => t.id !== action.id)
    case 'DISMISS_ALL': return []
    default: return state
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, [])

  const toast = useCallback((t: Omit<Toast, 'id'>): string => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    dispatch({ type: 'ADD', toast: { ...t, id } })
    return id
  }, [])

  const dismiss = useCallback((id: string) => dispatch({ type: 'DISMISS', id }), [])
  const dismissAll = useCallback(() => dispatch({ type: 'DISMISS_ALL' }), [])

  const helpers = {
    success: (title: string, message?: string) => toast({ variant: 'success', title, message, duration: 4000 }),
    error: (title: string, message?: string) => toast({ variant: 'error', title, message, duration: 6000 }),
    warning: (title: string, message?: string) => toast({ variant: 'warning', title, message, duration: 5000 }),
    info: (title: string, message?: string) => toast({ variant: 'info', title, message, duration: 4000 }),
  }

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss, dismissAll, ...helpers }}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// ─────────────────────────────────────────────
// TOAST CONTAINER (rendered at bottom-right)
// ─────────────────────────────────────────────

function ToastItem({ toast: t, dismiss }: { toast: Toast; dismiss: (id: string) => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const duration = t.duration ?? 4000
    if (duration === 0) return

    timerRef.current = setTimeout(() => {
      setExiting(true)
      setTimeout(() => dismiss(t.id), 300)
    }, duration)

    return () => clearTimeout(timerRef.current)
  }, [t.id, t.duration, dismiss])

  const colors: Record<ToastVariant, { bg: string; border: string; icon: string; iconBg: string }> = {
    success: { bg: '#fff', border: '#97C459', icon: '✓', iconBg: '#EAF3DE' },
    error:   { bg: '#fff', border: '#F09595', icon: '✕', iconBg: '#FCEBEB' },
    warning: { bg: '#fff', border: '#EF9F27', icon: '!', iconBg: '#FAEEDA' },
    info:    { bg: '#fff', border: '#85B7EB', icon: 'i', iconBg: '#E6F1FB' },
  }
  const c = colors[t.variant]
  const textColors: Record<ToastVariant, string> = {
    success: '#27500A', error: '#791F1F', warning: '#633806', info: '#0C447C',
  }

  return (
    <div
      style={{
        background: c.bg,
        border: `.5px solid ${c.border}`,
        borderLeft: `3px solid ${c.border}`,
        borderRadius: 10,
        padding: '11px 14px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        boxShadow: '0 4px 20px rgba(0,0,0,.1)',
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'translateX(20px)' : 'translateX(0)',
        transition: 'opacity .25s, transform .25s',
        width: 340,
        maxWidth: '90vw',
      }}
    >
      <div style={{
        width: 22, height: 22, borderRadius: '50%', background: c.iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: textColors[t.variant], flexShrink: 0,
      }}>{c.icon}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: '#111827', marginBottom: 1 }}>
          {t.title}
        </div>
        {t.message && (
          <div style={{ fontSize: 11.5, color: '#6B7280', lineHeight: 1.4 }}>{t.message}</div>
        )}
        {t.action && (
          <button
            onClick={t.action.onClick}
            style={{ marginTop: 6, fontSize: 11, color: '#185FA5', cursor: 'pointer', background: 'none', border: 'none', padding: 0, textDecoration: 'underline' }}
          >
            {t.action.label}
          </button>
        )}
      </div>

      <button
        onClick={() => dismiss(t.id)}
        style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0, padding: '0 0 0 4px' }}
      >
        ×
      </button>
    </div>
  )
}

function ToastContainer({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} dismiss={dismiss} />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────
// API ERROR → TOAST CONVERTER
// ─────────────────────────────────────────────

export function handleApiError(
  error: unknown,
  toastFn: ToastContextValue,
  context?: string
): void {
  if (error instanceof AuthError) {
    // Redirect handled by AuthContext
    window.dispatchEvent(new CustomEvent('ledgerflow:auth_error', { detail: { type: 'auth_error' } }))
    return
  }

  if (error instanceof ForbiddenError) {
    toastFn.error(
      'Permission denied',
      error.message || 'You do not have permission to perform this action.'
    )
    return
  }

  if (error instanceof ValidationError) {
    const fieldErrors = error.fields?.map((f) => `${f.field}: ${f.message}`).join('\n')
    toastFn.error(
      'Validation error',
      fieldErrors || error.message
    )
    return
  }

  if (error instanceof RateLimitError) {
    toastFn.warning(
      'Too many requests',
      `Please wait ${error.retryAfterSeconds} seconds before trying again.`
    )
    return
  }

  if (error instanceof NetworkError) {
    toastFn.error(
      'Network error',
      'Check your internet connection and try again.'
    )
    return
  }

  if (error instanceof ApiError) {
    toastFn.error(
      context ? `${context} failed` : 'Something went wrong',
      error.message
    )
    return
  }

  if (error instanceof Error) {
    toastFn.error('Unexpected error', error.message)
    return
  }

  toastFn.error('Unknown error', 'Please try again or contact support.')
}

// ─────────────────────────────────────────────
// ERROR BOUNDARY
// ─────────────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo })
    // In production: send to Sentry
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  reset = () => this.setState({ hasError: false, error: null, errorInfo: null })

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback({ error: this.state.error, reset: this.reset })
      }
      return (
        <div style={{ padding: '40px 24px', textAlign: 'center', maxWidth: 500, margin: '0 auto' }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>⚠</div>
          <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 20, lineHeight: 1.6 }}>
            {this.state.error.message}
          </p>
          <button
            onClick={this.reset}
            style={{ padding: '8px 20px', background: '#1a1a2e', color: '#eaeaf8', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

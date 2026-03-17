'use client'

import React from 'react'
import { clsx } from 'clsx'

// ─────────────────────────────────────────────
// BUTTON
// ─────────────────────────────────────────────

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export function Button({
  variant = 'secondary', size = 'md', loading, leftIcon, rightIcon,
  className, children, disabled, ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none'

  const variants = {
    primary: 'bg-[#1a1a2e] text-white hover:bg-[#2a2a4e] focus-visible:ring-[#1a1a2e]',
    secondary: 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 focus-visible:ring-gray-400',
    ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-gray-400',
    danger: 'bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 focus-visible:ring-red-400',
    success: 'bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 focus-visible:ring-green-400',
  }

  const sizes = {
    sm: 'h-7 px-3 text-xs',
    md: 'h-9 px-4 text-sm',
    lg: 'h-11 px-6 text-base',
  }

  return (
    <button
      className={clsx(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : leftIcon}
      {children}
      {rightIcon}
    </button>
  )
}

// ─────────────────────────────────────────────
// BADGE
// ─────────────────────────────────────────────

interface BadgeProps {
  variant?: 'default' | 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'gray'
  size?: 'sm' | 'md'
  children: React.ReactNode
  className?: string
}

export function Badge({ variant = 'default', size = 'sm', children, className }: BadgeProps) {
  const variants = {
    default: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    purple: 'bg-purple-50 text-purple-700',
    gray: 'bg-gray-100 text-gray-500',
  }
  const sizes = { sm: 'text-[10px] px-2 py-0.5', md: 'text-xs px-2.5 py-1' }

  return (
    <span className={clsx('inline-flex items-center rounded-full font-medium', variants[variant], sizes[size], className)}>
      {children}
    </span>
  )
}

// Status → variant map
export function statusBadge(status: string): React.ReactElement {
  const map: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
    DRAFT: { label: 'Draft', variant: 'gray' },
    SUBMITTED: { label: 'Submitted', variant: 'blue' },
    PENDING_APPROVAL: { label: 'Pending', variant: 'amber' },
    APPROVED: { label: 'Approved', variant: 'green' },
    REJECTED: { label: 'Rejected', variant: 'red' },
    EXPORTED: { label: 'Exported', variant: 'purple' },
    FLAGGED: { label: 'Flagged', variant: 'red' },
    ACTIVE: { label: 'Active', variant: 'green' },
    FROZEN: { label: 'Frozen', variant: 'blue' },
    CANCELLED: { label: 'Cancelled', variant: 'gray' },
    REQUESTED: { label: 'Requested', variant: 'amber' },
    MATCHED: { label: 'Matched', variant: 'green' },
    UNCATEGORIZED: { label: 'Uncategorized', variant: 'amber' },
    CATEGORIZED: { label: 'Categorized', variant: 'blue' },
    RECONCILED: { label: 'Reconciled', variant: 'green' },
    OVERDUE: { label: 'Overdue', variant: 'red' },
    PAID: { label: 'Paid', variant: 'green' },
  }
  const config = map[status] ?? { label: status, variant: 'default' as const }
  return <Badge variant={config.variant}>{config.label}</Badge>
}

// ─────────────────────────────────────────────
// INPUT
// ─────────────────────────────────────────────

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftAddon?: React.ReactNode
  rightAddon?: React.ReactNode
}

export function Input({ label, error, hint, leftAddon, rightAddon, className, id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {leftAddon && (
          <div className="absolute left-3 flex items-center text-gray-400 pointer-events-none text-sm">
            {leftAddon}
          </div>
        )}
        <input
          id={inputId}
          className={clsx(
            'w-full rounded-lg border bg-white text-sm text-gray-900 placeholder:text-gray-400',
            'focus:outline-none focus:ring-2 focus:ring-[#1a1a2e]/20 focus:border-[#1a1a2e]',
            'transition-colors duration-150',
            error ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-gray-200',
            leftAddon ? 'pl-9' : 'pl-3',
            rightAddon ? 'pr-9' : 'pr-3',
            'h-9',
            className
          )}
          {...props}
        />
        {rightAddon && (
          <div className="absolute right-3 flex items-center text-gray-400 pointer-events-none text-sm">
            {rightAddon}
          </div>
        )}
      </div>
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────
// SELECT
// ─────────────────────────────────────────────

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
  placeholder?: string
}

export function Select({ label, error, options, placeholder, className, id, ...props }: SelectProps) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={selectId} className="text-xs font-medium text-gray-700">{label}</label>}
      <select
        id={selectId}
        className={clsx(
          'w-full rounded-lg border bg-white text-sm text-gray-900 h-9 px-3',
          'focus:outline-none focus:ring-2 focus:ring-[#1a1a2e]/20 focus:border-[#1a1a2e]',
          'transition-colors duration-150 cursor-pointer',
          error ? 'border-red-300' : 'border-gray-200',
          className
        )}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────
// TEXTAREA
// ─────────────────────────────────────────────

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  hint?: string
}

export function Textarea({ label, error, hint, className, id, ...props }: TextareaProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={inputId} className="text-xs font-medium text-gray-700">{label}</label>}
      <textarea
        id={inputId}
        className={clsx(
          'w-full rounded-lg border bg-white text-sm text-gray-900 placeholder:text-gray-400 p-3 resize-none',
          'focus:outline-none focus:ring-2 focus:ring-[#1a1a2e]/20 focus:border-[#1a1a2e]',
          error ? 'border-red-300' : 'border-gray-200',
          className
        )}
        {...props}
      />
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────
// SPINNER
// ─────────────────────────────────────────────

export function Spinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizes = { sm: 'h-3 w-3', md: 'h-5 w-5', lg: 'h-8 w-8' }
  return (
    <svg
      className={clsx('animate-spin text-current', sizes[size], className)}
      fill="none" viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ─────────────────────────────────────────────
// CARD / PANEL
// ─────────────────────────────────────────────

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

export function Card({ children, className, padding = 'md' }: CardProps) {
  const paddings = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' }
  return (
    <div className={clsx('bg-white rounded-xl border border-gray-100 shadow-sm', paddings[padding], className)}>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  if (!open) return null

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx('relative bg-white rounded-2xl shadow-xl w-full flex flex-col max-h-[90vh]', widths[size])}>
        <div className="flex items-start justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-4 -mt-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="p-6 border-t border-gray-100 flex items-center justify-end gap-3">{footer}</div>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// AVATAR
// ─────────────────────────────────────────────

interface AvatarProps {
  firstName?: string
  lastName?: string
  avatarUrl?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  color?: string
}

export function Avatar({ firstName, lastName, avatarUrl, size = 'md', color }: AvatarProps) {
  const sizes = { xs: 'h-6 w-6 text-[9px]', sm: 'h-7 w-7 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-10 w-10 text-sm' }
  const initials = `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase()
  const colors = ['bg-blue-100 text-blue-700', 'bg-green-100 text-green-700', 'bg-purple-100 text-purple-700',
    'bg-amber-100 text-amber-700', 'bg-pink-100 text-pink-700', 'bg-teal-100 text-teal-700']
  const colorClass = color ?? colors[(initials.charCodeAt(0) ?? 0) % colors.length]

  if (avatarUrl) {
    return <img src={avatarUrl} alt={initials} className={clsx('rounded-full object-cover', sizes[size])} />
  }

  return (
    <div className={clsx('rounded-full flex items-center justify-center font-semibold flex-shrink-0', sizes[size], colorClass)}>
      {initials}
    </div>
  )
}

// ─────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-4 text-gray-300">{icon}</div>}
      <h3 className="text-sm font-semibold text-gray-900 mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 max-w-xs mb-4">{description}</p>}
      {action}
    </div>
  )
}

// ─────────────────────────────────────────────
// AMOUNT DISPLAY
// ─────────────────────────────────────────────

export function Amount({ value, currency = 'EUR', className, positive }: {
  value: number; currency?: string; className?: string; positive?: boolean
}) {
  const formatted = new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(Math.abs(value))
  const isNegative = value < 0

  return (
    <span className={clsx(
      'tabular-nums',
      positive === true ? 'text-green-700' : positive === false ? 'text-gray-900' : isNegative ? 'text-gray-900' : 'text-green-700',
      className
    )}>
      {isNegative ? `−${formatted}` : `+${formatted}`}
    </span>
  )
}

// ─────────────────────────────────────────────
// FILTER BAR
// ─────────────────────────────────────────────

interface FilterChipProps {
  label: string
  active?: boolean
  count?: number
  onClick: () => void
}

export function FilterChip({ label, active, count, onClick }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium transition-all',
        active
          ? 'bg-[#1a1a2e] text-white'
          : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
      )}
    >
      {label}
      {count !== undefined && (
        <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px]',
          active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
        )}>
          {count}
        </span>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────
// TABLE
// ─────────────────────────────────────────────

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={clsx('px-3 py-2.5 text-left text-[11px] font-medium text-gray-500 border-b border-gray-100', className)}>
      {children}
    </th>
  )
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={clsx('px-3 py-3 text-gray-700 border-b border-gray-50', className)}>
      {children}
    </td>
  )
}

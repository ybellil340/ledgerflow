'use client'

import React from 'react'

// ─── BUTTON ───────────────────────────────────────────────────────────────────

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'success' | 'warning' | 'info'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export function Button({ variant = 'secondary', size = 'md', loading, leftIcon, rightIcon, className = '', children, disabled, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none cursor-pointer border'
  const v: Record<string, string> = {
    primary:      'bg-[#185FA5] border-[#185FA5] text-white hover:bg-[#0C447C] focus:ring-blue-400',
    secondary:    'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 focus:ring-gray-300',
    ghost:        'bg-transparent border-transparent text-gray-600 hover:bg-gray-100 focus:ring-gray-300',
    danger:       'bg-red-600 border-red-600 text-white hover:bg-red-700 focus:ring-red-400',
    'danger-ghost': 'bg-transparent border-red-200 text-red-600 hover:bg-red-50 focus:ring-red-300',
    success:      'bg-green-50 border-green-200 text-green-700 hover:bg-green-100 focus:ring-green-300',
    warning:      'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 focus:ring-amber-300',
    info:         'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 focus:ring-blue-300',
  }
  const s: Record<string, string> = {
    xs: 'h-6 px-2 text-[10px]',
    sm: 'h-7 px-3 text-xs',
    md: 'h-9 px-4 text-sm',
    lg: 'h-11 px-6 text-base',
  }
  return (
    <button className={`${base} ${v[variant] ?? v.secondary} ${s[size]} ${className}`} disabled={disabled || loading} {...props}>
      {loading ? <Spinner size="sm" /> : leftIcon}
      {children}
      {rightIcon}
    </button>
  )
}

// ─── BADGE ────────────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'gray' | 'teal'

const STATUS_VARIANT_MAP: Record<string, BadgeVariant> = {
  DRAFT: 'gray', SUBMITTED: 'blue', PENDING: 'amber', PENDING_APPROVAL: 'amber',
  APPROVED: 'green', REJECTED: 'red', EXPORTED: 'purple', FLAGGED: 'red',
  ACTIVE: 'green', FROZEN: 'blue', CANCELLED: 'gray', PAID: 'green',
  OVERDUE: 'red', SENT: 'blue', VIEWED: 'blue', PARTIALLY_PAID: 'amber',
  MATCHED: 'green', MISSING: 'red', CONNECTED: 'green', DISCONNECTED: 'gray',
  ERROR: 'red', TRIALING: 'amber', GROWTH: 'blue', PRO: 'purple',
  STARTER: 'gray', ENTERPRISE: 'amber',
}

interface BadgeProps {
  label?: string
  variant?: BadgeVariant
  status?: string
  size?: 'sm' | 'md'
  children?: React.ReactNode
  className?: string
}

export function Badge({ label, variant, status, size = 'sm', children, className = '' }: BadgeProps) {
  const resolvedVariant: BadgeVariant = variant ?? (status ? STATUS_VARIANT_MAP[status] ?? 'gray' : 'default' as BadgeVariant)
  const v: Record<string, string> = {
    default: 'bg-gray-100 text-gray-700', blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700', amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700', purple: 'bg-purple-50 text-purple-700',
    gray: 'bg-gray-100 text-gray-500', teal: 'bg-teal-50 text-teal-700',
  }
  const s = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'
  const content = label ?? children ?? (status ? (STATUS_VARIANT_MAP[status] ? status.replace(/_/g, ' ') : status) : '')
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${v[resolvedVariant]} ${s} ${className}`}>
      {content}
    </span>
  )
}

export function statusBadge(status: string): React.ReactElement {
  return <Badge status={status} label={status.replace(/_/g, ' ')} />
}

// ─── INPUT ────────────────────────────────────────────────────────────────────

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size'> {
  label?: string
  error?: string
  hint?: string
  leftAddon?: React.ReactNode
  rightAddon?: React.ReactNode
  onChange?: ((value: string) => void) | React.ChangeEventHandler<HTMLInputElement>
  size?: 'sm' | 'md'
}

export function Input({ label, error, hint, leftAddon, rightAddon, onChange, className = '', size = 'md', id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  const handleChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    if (!onChange) return
    if (typeof onChange === 'function' && onChange.length === 1) {
      try { (onChange as (v: string) => void)(e.target.value) } catch { (onChange as React.ChangeEventHandler<HTMLInputElement>)(e) }
    }
  }
  const h = size === 'sm' ? 'h-7 text-xs' : 'h-9 text-sm'
  return (
    <div className="w-full">
      {label && <label htmlFor={inputId} className="block text-xs font-medium text-gray-600 mb-1">{label}</label>}
      <div className="relative flex items-center">
        {leftAddon && <div className="absolute left-3 text-gray-400">{leftAddon}</div>}
        <input
          id={inputId}
          className={`w-full border rounded-lg px-3 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${error ? 'border-red-300' : 'border-gray-200'} ${leftAddon ? 'pl-9' : ''} ${rightAddon ? 'pr-9' : ''} ${h} ${className}`}
          onChange={handleChange}
          {...props}
        />
        {rightAddon && <div className="absolute right-3 text-gray-400">{rightAddon}</div>}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

// ─── SELECT ───────────────────────────────────────────────────────────────────

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'size'> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
  placeholder?: string
  onChange?: ((value: string) => void) | React.ChangeEventHandler<HTMLSelectElement>
  size?: 'sm' | 'md'
}

export function Select({ label, error, options, placeholder, onChange, className = '', size = 'md', id, value, ...props }: SelectProps) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  const handleChange: React.ChangeEventHandler<HTMLSelectElement> = (e) => {
    if (!onChange) return
    try { (onChange as (v: string) => void)(e.target.value) } catch { (onChange as React.ChangeEventHandler<HTMLSelectElement>)(e) }
  }
  const h = size === 'sm' ? 'h-7 text-xs' : 'h-9 text-sm'
  return (
    <div className="w-full">
      {label && <label htmlFor={selectId} className="block text-xs font-medium text-gray-600 mb-1">{label}</label>}
      <select
        id={selectId}
        value={value}
        className={`w-full border rounded-lg px-3 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${error ? 'border-red-300' : 'border-gray-200'} ${h} ${className}`}
        onChange={handleChange}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ─── TEXTAREA ─────────────────────────────────────────────────────────────────

interface TextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  label?: string
  error?: string
  hint?: string
  onChange?: ((value: string) => void) | React.ChangeEventHandler<HTMLTextAreaElement>
}

export function Textarea({ label, error, hint, onChange, className = '', id, ...props }: TextareaProps) {
  const taId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  const handleChange: React.ChangeEventHandler<HTMLTextAreaElement> = (e) => {
    if (!onChange) return
    try { (onChange as (v: string) => void)(e.target.value) } catch { (onChange as React.ChangeEventHandler<HTMLTextAreaElement>)(e) }
  }
  return (
    <div className="w-full">
      {label && <label htmlFor={taId} className="block text-xs font-medium text-gray-600 mb-1">{label}</label>}
      <textarea
        id={taId}
        className={`w-full border rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${error ? 'border-red-300' : 'border-gray-200'} ${className}`}
        onChange={handleChange}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

// ─── SPINNER ──────────────────────────────────────────────────────────────────

export function Spinner({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = size === 'sm' ? 'w-3 h-3' : size === 'lg' ? 'w-8 h-8' : 'w-5 h-5'
  return <div className={`${s} border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin ${className}`} />
}

// ─── CARD ─────────────────────────────────────────────────────────────────────

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  kpi?: boolean
  label?: string
  value?: React.ReactNode
  sub?: string
  valueColor?: 'default' | 'green' | 'red' | 'blue' | 'amber'
}

export function Card({ children, className = '', padding = 'md', kpi, label, value, sub, valueColor = 'default' }: CardProps) {
  const p = padding === 'none' ? '' : padding === 'sm' ? 'p-3' : padding === 'lg' ? 'p-6' : 'p-4'
  const base = `bg-white border border-gray-200 rounded-xl shadow-sm ${p} ${className}`

  if (kpi) {
    const vc: Record<string, string> = { default: 'text-gray-900', green: 'text-green-700', red: 'text-red-600', blue: 'text-blue-700', amber: 'text-amber-600' }
    return (
      <div className={base}>
        <div className="text-xs text-gray-400 mb-1">{label}</div>
        <div className={`text-xl font-semibold ${vc[valueColor]}`}>{value}</div>
        {sub && <div className="text-[10.5px] text-gray-400 mt-0.5">{sub}</div>}
      </div>
    )
  }
  return <div className={base}>{children}</div>
}

// ─── MODAL ────────────────────────────────────────────────────────────────────

interface ModalProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
  open?: boolean
}

export function Modal({ title, subtitle, onClose, children, wide = false, open = true }: ModalProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <div className="font-semibold text-gray-900">{title}</div>
            {subtitle && <div className="text-xs text-gray-400 mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg ml-4 mt-0.5">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ─── AVATAR ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#185FA5','#3B6D11','#534AB7','#BA7517','#0F6E56','#A32D2D']

interface AvatarProps {
  firstName?: string
  lastName?: string
  name?: string
  avatarUrl?: string
  size?: 'sm' | 'md' | 'lg'
  color?: string
  initials?: string
}

export function Avatar({ firstName, lastName, name, avatarUrl, size = 'md', color, initials }: AvatarProps) {
  const s = size === 'sm' ? 'w-6 h-6 text-[9px]' : size === 'lg' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs'
  const displayName = name ?? `${firstName ?? ''} ${lastName ?? ''}`.trim()
  const init = initials ?? displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  const bg = color ?? AVATAR_COLORS[displayName.length % AVATAR_COLORS.length]
  if (avatarUrl) return <img src={avatarUrl} alt={displayName} className={`${s} rounded-full object-cover`} />
  return (
    <div className={`${s} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0`} style={{ background: bg }}>
      {init}
    </div>
  )
}

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, description, action }: { icon?: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="text-3xl mb-3">{icon}</div>}
      <div className="font-medium text-gray-700 mb-1">{title}</div>
      {description && <p className="text-sm text-gray-400 mb-4 max-w-sm">{description}</p>}
      {action}
    </div>
  )
}

// ─── AMOUNT ───────────────────────────────────────────────────────────────────

export function Amount({ value, currency = 'EUR', className = '', positive, suffix }: {
  value: number | string | { toNumber(): number }
  currency?: string
  className?: string
  positive?: boolean
  suffix?: string
}) {
  const n = typeof value === 'object' && 'toNumber' in value ? value.toNumber() : Number(value)
  const formatted = new Intl.NumberFormat('de-DE', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)
  return <span className={className}>{formatted}{suffix}</span>
}

// ─── TABLE ────────────────────────────────────────────────────────────────────

export function Table({ columns, rows, children, className = '' }: {
  columns?: (string | React.ReactNode)[]
  rows?: React.ReactNode[][]
  children?: React.ReactNode
  className?: string
}) {
  if (children) return <table className={`w-full text-sm ${className}`}>{children}</table>
  return (
    <table className={`w-full text-sm ${className}`}>
      {columns && (
        <thead>
          <tr className="border-b border-gray-100">
            {columns.map((col, i) => (
              <th key={i} className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide px-4 py-3 first:pl-4">{col}</th>
            ))}
          </tr>
        </thead>
      )}
      {rows && (
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-gray-700">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      )}
    </table>
  )
}

export function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`text-left text-xs font-medium text-gray-400 uppercase tracking-wide px-4 py-3 ${className}`}>{children}</th>
}

export function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-gray-700 ${className}`}>{children}</td>
}

// ─── FILTER CHIP ──────────────────────────────────────────────────────────────

export function FilterChip({ label, active, count, onClick }: { label: string; active?: boolean; count?: number; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
    >
      {label}
      {count !== undefined && (
        <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${active ? 'bg-white/20' : 'bg-gray-100'}`}>{count}</span>
      )}
    </button>
  )
}

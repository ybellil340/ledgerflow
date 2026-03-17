'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import { Avatar } from '@/components/ui'
import type { SessionUser } from '@/types'

// ─────────────────────────────────────────────
// NAV ITEMS
// ─────────────────────────────────────────────

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  badge?: number
  badgeVariant?: 'red' | 'amber'
  section: string
  requiredPermissions?: string[]
}

const NAV_ITEMS: NavItem[] = [
  {
    section: 'Overview',
    label: 'Dashboard',
    href: '/dashboard',
    icon: <GridIcon />,
  },
  {
    section: 'Finance',
    label: 'Cards',
    href: '/cards',
    icon: <CardIcon />,
  },
  {
    section: 'Finance',
    label: 'Expenses',
    href: '/expenses',
    icon: <ReceiptIcon />,
  },
  {
    section: 'Finance',
    label: 'Reimbursements',
    href: '/reimbursements',
    icon: <RefundIcon />,
  },
  {
    section: 'Finance',
    label: 'Invoices',
    href: '/invoices',
    icon: <InvoiceIcon />,
  },
  {
    section: 'Finance',
    label: 'Transactions',
    href: '/transactions',
    icon: <TxIcon />,
  },
  {
    section: 'Accounting',
    label: 'Accounting',
    href: '/accounting',
    icon: <BookIcon />,
    requiredPermissions: ['manage:accounting'],
  },
  {
    section: 'Accounting',
    label: 'Cash Flow',
    href: '/cashflow',
    icon: <ChartIcon />,
    requiredPermissions: ['view:analytics'],
  },
  {
    section: 'Accounting',
    label: 'Tax Advisor',
    href: '/tax-advisor',
    icon: <TaxIcon />,
    requiredPermissions: ['manage:tax_advisor'],
  },
  {
    section: 'Company',
    label: 'Team',
    href: '/team',
    icon: <TeamIcon />,
    requiredPermissions: ['manage:users'],
  },
  {
    section: 'Company',
    label: 'Settings',
    href: '/settings',
    icon: <SettingsIcon />,
  },
]

// ─────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────

interface SidebarProps {
  user: SessionUser
  organizationName: string
  planName?: string
  pendingApprovals?: number
  missingReceipts?: number
}

export function Sidebar({ user, organizationName, planName, pendingApprovals, missingReceipts }: SidebarProps) {
  const pathname = usePathname()

  const filteredItems = NAV_ITEMS.filter((item) => {
    if (!item.requiredPermissions) return true
    if (user.isSuperAdmin) return true
    return item.requiredPermissions.every((p) => user.permissions.includes(p as never))
  })

  const sections = Array.from(new Set(filteredItems.map((i) => i.section)))

  const badgeMap: Record<string, { count: number; variant: 'red' | 'amber' }> = {
    '/expenses': pendingApprovals ? { count: pendingApprovals, variant: 'red' } : { count: 0, variant: 'red' },
    '/cards': missingReceipts ? { count: missingReceipts, variant: 'amber' } : { count: 0, variant: 'amber' },
  }

  const initials = `${organizationName[0] ?? 'O'}`.toUpperCase()

  return (
    <aside className="w-[220px] flex-shrink-0 flex flex-col bg-white border-r border-gray-100 h-screen">
      {/* Logo */}
      <div className="h-[52px] flex items-center gap-2.5 px-4 border-b border-gray-100">
        <div className="w-7 h-7 bg-[#1a1a2e] rounded-lg flex items-center justify-center flex-shrink-0">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <rect x="1.5" y="1.5" width="5" height="5" rx="1" fill="white" opacity="0.9"/>
            <rect x="8.5" y="1.5" width="5" height="5" rx="1" fill="white" opacity="0.4"/>
            <rect x="1.5" y="8.5" width="5" height="5" rx="1" fill="white" opacity="0.4"/>
            <rect x="8.5" y="8.5" width="5" height="5" rx="1" fill="white" opacity="0.7"/>
          </svg>
        </div>
        <span className="text-sm font-semibold text-gray-900 tracking-tight">LedgerFlow</span>
        <span className="text-[9px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded ml-auto">DE</span>
      </div>

      {/* Company switcher */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors">
          <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-900 truncate">{organizationName}</div>
            {planName && <div className="text-[10px] text-gray-500">{planName} Plan</div>}
          </div>
          <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {sections.map((section) => (
          <div key={section} className="mb-1">
            <div className="px-2 py-2 text-[9px] font-semibold text-gray-400 uppercase tracking-[0.8px]">
              {section}
            </div>
            {filteredItems.filter((i) => i.section === section).map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
              const badge = badgeMap[item.href]
              const showBadge = badge && badge.count > 0

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all mb-0.5',
                    isActive
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  )}
                >
                  <span className={clsx('flex-shrink-0', isActive ? 'text-blue-600' : 'text-gray-400')}>
                    {item.icon}
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {showBadge && (
                    <span className={clsx(
                      'text-[9px] font-semibold rounded-full px-1.5 py-0.5 min-w-[18px] text-center',
                      badge.variant === 'red' ? 'bg-red-500 text-white' : 'bg-amber-400 text-amber-900'
                    )}>
                      {badge.count}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}

        {/* Admin link */}
        {user.isSuperAdmin && (
          <div className="mb-1">
            <div className="px-2 py-2 text-[9px] font-semibold text-gray-400 uppercase tracking-[0.8px]">Platform</div>
            <Link
              href="/admin"
              className={clsx(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all',
                pathname.startsWith('/admin') ? 'bg-red-50 text-red-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
              )}
            >
              <span className="text-gray-400"><ShieldIcon /></span>
              Admin
            </Link>
          </div>
        )}
      </nav>

      {/* User footer */}
      <div className="border-t border-gray-100 p-3">
        <div className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
          <Avatar firstName={user.firstName} lastName={user.lastName} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-900 truncate">{user.firstName} {user.lastName}</div>
            <div className="text-[10px] text-gray-500 truncate">{roleLabel(user.currentRole)}</div>
          </div>
          <button className="text-gray-400 hover:text-gray-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}

// ─────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────

interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  unreadNotifications?: number
}

export function Header({ title, subtitle, actions, unreadNotifications }: HeaderProps) {
  return (
    <header className="h-[52px] flex items-center px-6 gap-4 bg-white border-b border-gray-100 flex-shrink-0">
      <div className="flex-1 min-w-0">
        <h1 className="text-[15px] font-semibold text-gray-900 truncate">{title}</h1>
        {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <button className="relative w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {unreadNotifications && unreadNotifications > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          )}
        </button>
      </div>
    </header>
  )
}

// ─────────────────────────────────────────────
// APP SHELL
// ─────────────────────────────────────────────

interface AppShellProps {
  user: SessionUser
  organizationName: string
  planName?: string
  children: React.ReactNode
  pendingApprovals?: number
  missingReceipts?: number
}

export function AppShell({ user, organizationName, planName, children, pendingApprovals, missingReceipts }: AppShellProps) {
  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar
        user={user}
        organizationName={organizationName}
        planName={planName}
        pendingApprovals={pendingApprovals}
        missingReceipts={missingReceipts}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    SUPER_ADMIN: 'Platform Admin',
    COMPANY_ADMIN: 'Company Admin',
    FINANCE_MANAGER: 'Finance Manager',
    APPROVER: 'Approver',
    EMPLOYEE: 'Employee',
    TAX_ADVISOR: 'Tax Advisor',
  }
  return map[role] ?? role
}

// ─────────────────────────────────────────────
// ICONS
// ─────────────────────────────────────────────

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor" opacity="0.8"/>
      <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor" opacity="0.4"/>
      <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor" opacity="0.4"/>
      <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor" opacity="0.6"/>
    </svg>
  )
}
function CardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="1" y="6" width="12" height="1.8" fill="currentColor" opacity="0.4"/>
      <rect x="3" y="8.5" width="3" height="1.2" rx="0.4" fill="currentColor" opacity="0.6"/>
    </svg>
  )
}
function ReceiptIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2.5 1h9a.5.5 0 0 1 .5.5v11l-2-1.5-2 1.5-2-1.5-2 1.5V1.5a.5.5 0 0 1 .5-.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
      <line x1="4" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1"/>
      <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1"/>
      <line x1="4" y1="9" x2="7" y2="9" stroke="currentColor" strokeWidth="1"/>
    </svg>
  )
}
function RefundIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1a6 6 0 1 0 6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M7 4.5V7l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 1l3 1-1 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function InvoiceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="4" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1"/>
      <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1"/>
      <line x1="4" y1="9" x2="7" y2="9" stroke="currentColor" strokeWidth="1"/>
      <line x1="9" y1="9" x2="10" y2="9" stroke="currentColor" strokeWidth="1"/>
    </svg>
  )
}
function TxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M1 9l3-4 2.5 2.5L10 3l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function BookIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="4.5" y1="1.5" x2="4.5" y2="12.5" stroke="currentColor" strokeWidth="1"/>
      <line x1="7" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1"/>
      <line x1="7" y1="7.5" x2="10" y2="7.5" stroke="currentColor" strokeWidth="1"/>
    </svg>
  )
}
function ChartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <polyline points="1,11 4,6.5 7,8.5 10,3.5 13,5.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function TaxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M7 4v2.5l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}
function TeamIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="5" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M1 12.5c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <circle cx="10.5" cy="4.5" r="1.5" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M12.5 12c0-1.5-1-2.5-2-2.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M7 1.5v1M7 11.5v1M1.5 7h1M11.5 7h1M3.2 3.2l.7.7M10.1 10.1l.7.7M10.8 3.2l-.7.7M3.9 10.1l-.7.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}
function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1.5L2 3.5v4c0 3 2 4.8 5 5.5 3-.7 5-2.5 5-5.5v-4L7 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  )
}

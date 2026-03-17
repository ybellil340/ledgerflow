'use client'

import { usePathname } from 'next/navigation'

interface AppShellProps {
  title?: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  user?: any
  organizationName?: string
  planName?: string
  pendingApprovals?: number
  missingReceipts?: number
}

const NAV = [
  { section: 'Overview', items: [
    { id: 'dashboard',      label: 'Dashboard',       href: '/dashboard',              icon: 'D' },
  ]},
  { section: 'Finance', items: [
    { id: 'cards',          label: 'Cards',            href: '/cards',                  icon: 'C' },
    { id: 'expenses',       label: 'Expenses',         href: '/expenses',               icon: 'E' },
    { id: 'reimbursements', label: 'Reimbursements',   href: '/reimbursements',         icon: 'R' },
    { id: 'ap',             label: 'AP Invoices',      href: '/invoices/ap',            icon: 'I' },
    { id: 'ar',             label: 'AR Invoices',      href: '/invoices/ar',            icon: 'A' },
    { id: 'budgets',        label: 'Budgets',          href: '/budgets',                icon: 'B' },
  ]},
  { section: 'Directory', items: [
    { id: 'suppliers',      label: 'Suppliers',        href: '/suppliers',              icon: 'S' },
    { id: 'customers',      label: 'Customers',        href: '/customers',              icon: 'U' },
  ]},
  { section: 'Accounting', items: [
    { id: 'accounting',     label: 'Accounting',       href: '/accounting',             icon: 'G' },
    { id: 'cashflow',       label: 'Cash Flow',        href: '/cashflow',               icon: 'F' },
    { id: 'taxadvisor',     label: 'Tax Advisor',      href: '/tax-advisor',            icon: 'T' },
    { id: 'reports',        label: 'Reports',          href: '/reports',                icon: 'P' },
  ]},
  { section: 'Company', items: [
    { id: 'team',           label: 'Team',             href: '/team',                   icon: 'M' },
    { id: 'billing',        label: 'Billing',          href: '/billing',                icon: '$' },
    { id: 'integrations',   label: 'Integrations',     href: '/settings/integrations',  icon: 'X' },
    { id: 'notifications',  label: 'Notifications',    href: '/notifications',          icon: 'N' },
    { id: 'import',         label: 'Import data',      href: '/import',                 icon: 'V' },
  ]},
  { section: 'Platform', items: [
    { id: 'admin',          label: 'Admin',            href: '/admin',                  icon: 'Z' },
  ]},
]

export function AppShell({ title, subtitle, action, children }: AppShellProps) {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: '13px' }}>

      {/* Sidebar */}
      <div style={{ width: '210px', background: '#1a1a2e', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>

        {/* Logo */}
        <div style={{ padding: '14px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '26px', height: '26px', background: 'rgba(255,255,255,.13)', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>
            L
          </div>
          <span style={{ color: '#eaeaf8', fontWeight: 600, fontSize: '13.5px' }}>LedgerFlow</span>
          <span style={{ marginLeft: 'auto', fontSize: '8px', color: 'rgba(255,255,255,.2)', background: 'rgba(255,255,255,.07)', padding: '1px 5px', borderRadius: '4px' }}>DE</span>
        </div>

        {/* Nav */}
        <div style={{ flex: 1, padding: '8px' }}>
          {NAV.map(section => (
            <div key={section.section} style={{ marginBottom: '4px' }}>
              <div style={{ fontSize: '9px', fontWeight: 600, color: 'rgba(255,255,255,.22)', textTransform: 'uppercase', letterSpacing: '.8px', padding: '6px 6px 3px' }}>
                {section.section}
              </div>
              {section.items.map(item => {
                const active = pathname === item.href || pathname?.startsWith(item.href + '/')
                return (
                  <a
                    key={item.id}
                    href={item.href}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '7px',
                      padding: '6px 10px', borderRadius: '7px',
                      background: active ? 'rgba(255,255,255,.12)' : 'transparent',
                      color: active ? '#fff' : 'rgba(255,255,255,.5)',
                      fontSize: '12px', fontWeight: active ? 500 : 400,
                      textDecoration: 'none', transition: 'background .12s',
                    }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.07)' }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    <span style={{ fontSize: '13px', flexShrink: 0 }}>{item.icon}</span>
                    <span>{item.label}</span>
                  </a>
                )
              })}
            </div>
          ))}
        </div>

        {/* User footer */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', padding: '10px 8px' }}>
          <a href="/auth/login" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '7px', textDecoration: 'none' }}>
            <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#3B6D11', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: '#EAF3DE' }}>
              KM
            </div>
            <div>
              <div style={{ fontSize: '11.5px', fontWeight: 500, color: '#c8c8e0' }}>Katrin Muller</div>
              <div style={{ fontSize: '9.5px', color: 'rgba(255,255,255,.28)' }}>Company Admin</div>
            </div>
          </a>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#F5F5F3' }}>

        {/* Header */}
        {(title || action) && (
          <div style={{ height: '50px', background: '#fff', borderBottom: '1px solid #E8E8E4', display: 'flex', alignItems: 'center', padding: '0 20px', gap: '12px', flexShrink: 0 }}>
            <div style={{ flex: 1 }}>
              {title && <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>{title}</div>}
              {subtitle && <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '1px' }}>{subtitle}</div>}
            </div>
            {action}
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export default AppShell

export function Header({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
      <div style={{ flex: 1 }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: '12px', color: '#6B7280', margin: '2px 0 0' }}>{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

'use client'

import { useAuth } from '@/lib/store/auth'
import { AppShell } from './AppShell'

interface AppShellClientProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}

export function AppShellWrapper({ title, subtitle, action, children }: AppShellClientProps) {
  const { user } = useAuth()
  return (
    <AppShell
      user={user ?? { id: '', name: 'User', email: '', role: 'EMPLOYEE' }}
      organizationName="LedgerFlow"
      planName="Growth"
    >
      <div className="page-content">
        <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 600 }}>{title}</h1>
            {subtitle && <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
        {children}
      </div>
    </AppShell>
  )
}

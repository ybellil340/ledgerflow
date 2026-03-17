'use client'

import { useState } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { adminApi } from '@/lib/api/endpoints'
import { useAuth } from '@/lib/store/auth'
import { useToast } from '@/components/providers/error-system'
import {
  Button, Badge, Modal, Input, Card,
  Spinner, EmptyState, Amount, Table,
} from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlatformStats {
  totalOrgs: number
  activeOrgs: number
  totalUsers: number
  activeUsers30d: number
  newOrgsThisMonth: number
  totalExpenses: number
  totalVolume: number
  planBreakdown: { plan: string; count: number }[]
}

interface OrgRow {
  id: string
  name: string
  plan: string
  status: 'ACTIVE' | 'TRIALING' | 'SUSPENDED' | 'CANCELLED'
  userCount: number
  expenseCount: number
  createdAt: string
  adminEmail: string
  mrr: number
}

interface AuditLog {
  id: string
  action: string
  entityType: string
  entityId: string
  actor: { name: string; email: string }
  orgName: string
  createdAt: string
  metadata?: Record<string, unknown>
}

interface FeatureFlag {
  key: string
  description: string
  enabled: boolean
  rolloutPercent: number
}

type Tab = 'overview' | 'orgs' | 'users' | 'audit' | 'flags'

// ─── Feature flag toggle ───────────────────────────────────────────────────────

function FlagRow({ flag, onToggle }: {
  flag: FeatureFlag
  onToggle(key: string, enabled: boolean): void
}) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className="flex-1">
        <div className="text-sm font-mono font-medium">{flag.key}</div>
        <div className="text-xs text-gray-400 mt-0.5">{flag.description}</div>
        {flag.rolloutPercent < 100 && flag.enabled && (
          <div className="text-xs text-purple-600 mt-0.5">Rollout: {flag.rolloutPercent}%</div>
        )}
      </div>
      <button
        className="toggle"
        style={{ background: flag.enabled ? 'var(--green)' : '#e0e0de' }}
        onClick={() => onToggle(flag.key, !flag.enabled)}
      >
        <div
          className="toggle-knob"
          style={{ left: flag.enabled ? '19px' : '2px' }}
        />
      </button>
    </div>
  )
}

// ─── Impersonate modal ─────────────────────────────────────────────────────────

function ImpersonateModal({ org, onClose }: { org: OrgRow; onClose(): void }) {
  const { toast } = useToast()
  const mutation = useMutation<{ redirectUrl: string }>()

  async function confirm() {
    try {
      const result = await mutation.mutate(() => adminApi.impersonate(org.id))
      toast({ type: 'info', message: `Now impersonating ${org.name} — action logged` })
      onClose()
      if (result?.redirectUrl) window.location.href = result.redirectUrl
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <Modal title={`Impersonate — ${org.name}`} subtitle="This action is logged and audited" onClose={onClose}>
      <div className="info-box amber mb-4">
        <strong>Warning:</strong> You are about to log in as the company admin of <strong>{org.name}</strong>.
        All actions will appear under their account. Exit by logging out.
      </div>
      <p className="text-sm text-gray-500 mb-1">
        This impersonation event will be recorded in the platform audit log with your identity ({org.adminEmail}).
      </p>
      <div className="flex gap-2 mt-4 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={confirm} loading={mutation.isLoading}>Impersonate (logged)</Button>
      </div>
    </Modal>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { hasRole } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [impersonatingOrg, setImpersonatingOrg] = useState<OrgRow | null>(null)
  const [auditSearch, setAuditSearch] = useState('')

  // Guard — only SUPER_ADMIN
  if (!hasRole('SUPER_ADMIN')) {
    return (
      <AppShell title="Admin Backoffice" subtitle="Unauthorized">
        <EmptyState
          title="Access denied"
          description="This area requires SUPER_ADMIN privileges."
        />
      </AppShell>
    )
  }

  const { data: stats, isLoading: statsLoading } = useQuery<PlatformStats>(
    'admin/stats',
    () => adminApi.getPlatformStats()
  )

  const { data: orgsData, isLoading: orgsLoading } = useQuery<{ orgs: OrgRow[]; total: number }>(
    'admin/orgs',
    () => adminApi.listOrganizations()
  )

  const { data: auditData, isLoading: auditLoading } = useQuery<{ logs: AuditLog[]; total: number }>(
    `admin/audit${auditSearch ? `/${auditSearch}` : ''}`,
    () => adminApi.getAuditLogs({ search: auditSearch, limit: 50 })
  )

  const { data: flags, isLoading: flagsLoading } = useQuery<FeatureFlag[]>(
    'admin/flags',
    () => adminApi.listFeatureFlags()
  )

  const flagMutation = useMutation()

  async function toggleFlag(key: string, enabled: boolean) {
    try {
      await flagMutation.mutate(() => adminApi.setFeatureFlag(key, enabled))
      toast({ type: 'success', message: `${key} ${enabled ? 'enabled' : 'disabled'}` })
      invalidateQuery('admin/flags')
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'orgs', label: `Companies (${orgsData?.total ?? '—'})` },
    { key: 'users', label: 'Users' },
    { key: 'audit', label: 'Audit logs' },
    { key: 'flags', label: 'Feature flags' },
  ]

  return (
    <AppShell
      title="Admin Backoffice"
      subtitle="Super admin · Platform management"
    >
      <div className="tab-bar mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <>
          {statsLoading ? <Spinner /> : stats && (
            <>
              <div className="krow k5 mb-4">
                <Card kpi label="Total organizations" value={stats.totalOrgs} sub={`${stats.activeOrgs} active`} />
                <Card kpi label="Total users" value={stats.totalUsers} sub={`${stats.activeUsers30d} active (30d)`} valueColor="green" />
                <Card kpi label="New orgs this month" value={stats.newOrgsThisMonth} valueColor="green" />
                <Card kpi label="Total expenses" value={stats.totalExpenses} />
                <Card kpi label="Platform volume" value={<Amount value={stats.totalVolume} />} />
              </div>

              <div className="g2">
                <Card>
                  <div className="panel-title mb-3">Companies by plan</div>
                  {stats.planBreakdown.map(({ plan, count }) => (
                    <div key={plan} className="flex items-center gap-3 py-1.5">
                      <Badge label={plan} variant={plan === 'ENTERPRISE' ? 'amber' : plan === 'PRO' ? 'purple' : plan === 'GROWTH' ? 'blue' : 'gray'} className="min-w-[80px] text-center" />
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600 rounded-full"
                          style={{ width: stats.totalOrgs > 0 ? `${(count / stats.totalOrgs) * 100}%` : '4px' }}
                        />
                      </div>
                      <span className="text-sm font-medium w-6 text-right">{count}</span>
                    </div>
                  ))}
                </Card>

                <Card>
                  <div className="panel-title mb-3">Companies</div>
                  {(orgsData?.orgs ?? []).slice(0, 5).map((org) => (
                    <div key={org.id} className="flex items-center gap-2 py-2 border-b border-gray-50 last:border-0">
                      <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                        {org.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{org.name}</div>
                      </div>
                      <Badge label={org.plan} variant={org.plan === 'PRO' ? 'purple' : org.plan === 'GROWTH' ? 'blue' : 'gray'} size="sm" />
                      <button
                        className="apb apb-y text-[9.5px] px-2 py-0.5"
                        onClick={() => setImpersonatingOrg(org)}
                      >
                        Impersonate
                      </button>
                    </div>
                  ))}
                </Card>
              </div>
            </>
          )}
        </>
      )}

      {/* ── COMPANIES ── */}
      {tab === 'orgs' && (
        <Card className="p-0">
          {orgsLoading ? <Spinner /> : !orgsData?.orgs.length ? (
            <EmptyState title="No organizations" />
          ) : (
            <Table
              columns={['Company', 'Plan', 'Status', 'Users', 'Expenses', 'MRR', 'Created', '']}
              rows={orgsData.orgs.map((org) => [
                <div key="name">
                  <div className="font-medium text-sm">{org.name}</div>
                  <div className="text-xs text-gray-400">{org.adminEmail}</div>
                </div>,
                <Badge key="plan" label={org.plan} variant={org.plan === 'PRO' ? 'purple' : org.plan === 'GROWTH' ? 'blue' : 'gray'} />,
                <Badge key="status" status={org.status as any} />,
                org.userCount,
                org.expenseCount,
                <Amount key="mrr" value={org.mrr} suffix="/mo" />,
                new Date(org.createdAt).toLocaleDateString('de-DE'),
                <button key="imp" className="apb apb-y text-[9.5px]" onClick={() => setImpersonatingOrg(org)}>
                  Impersonate
                </button>,
              ])}
            />
          )}
        </Card>
      )}

      {/* ── AUDIT LOGS ── */}
      {tab === 'audit' && (
        <>
          <div className="filter-row mb-3">
            <input
              className="search-box"
              placeholder="Filter by action, user, or entity..."
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
            />
          </div>
          <Card className="p-0">
            {auditLoading ? <Spinner /> : !auditData?.logs.length ? (
              <EmptyState title="No audit logs" />
            ) : (
              <Table
                columns={['Timestamp', 'Actor', 'Action', 'Entity', 'Organization']}
                rows={auditData.logs.map((log) => [
                  <span key="ts" className="font-mono text-xs text-gray-400">
                    {new Date(log.createdAt).toLocaleString('de-DE')}
                  </span>,
                  <div key="actor">
                    <div className="text-xs font-medium">{log.actor.name}</div>
                    <div className="text-[10px] text-gray-400">{log.actor.email}</div>
                  </div>,
                  <Badge key="action" label={log.action} variant="gray" size="sm" />,
                  <span key="entity" className="text-xs font-mono text-gray-500">
                    {log.entityType}:{log.entityId.slice(0, 8)}
                  </span>,
                  <span key="org" className="text-xs text-gray-400">{log.orgName}</span>,
                ])}
              />
            )}
          </Card>
        </>
      )}

      {/* ── FEATURE FLAGS ── */}
      {tab === 'flags' && (
        <Card>
          <div className="panel-hdr mb-2">
            <span className="panel-title">Platform feature flags</span>
            <Badge label="Live — changes take effect immediately" variant="green" size="sm" />
          </div>
          {flagsLoading ? <Spinner /> : !flags?.length ? (
            <EmptyState title="No feature flags configured" />
          ) : (
            flags.map((flag) => (
              <FlagRow key={flag.key} flag={flag} onToggle={toggleFlag} />
            ))
          )}
        </Card>
      )}

      {impersonatingOrg && (
        <ImpersonateModal
          org={impersonatingOrg}
          onClose={() => setImpersonatingOrg(null)}
        />
      )}
    </AppShell>
  )
}

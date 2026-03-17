'use client'

/**
 * Audit Log page — full searchable history of all actions in the organization
 *
 * Shows: who did what, when, on which entity
 * Filters: by action type, by user, by entity type, date range
 * Wired to GET /api/admin?section=audit or a dedicated /api/audit endpoint
 *
 * Available to: COMPANY_ADMIN and FINANCE_MANAGER
 */

import React, { useState } from 'react'
import { usePaginated } from '@/lib/hooks'
import { api } from '@/lib/api/client'

interface AuditEntry {
  id: string
  action: string
  entityType: string
  entityId: string
  actorId?: string
  actorName?: string
  actorEmail?: string
  metadata?: Record<string, unknown>
  ipAddress?: string
  createdAt: string
}

// ─────────────────────────────────────────────
// ACTION REGISTRY (icon + label + color)
// ─────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  // Auth
  USER_LOGIN:              { icon: '🔑', label: 'Sign in',            color: '#185FA5', bg: '#E6F1FB' },
  USER_LOGOUT:             { icon: '🚪', label: 'Sign out',           color: '#9CA3AF', bg: '#f5f5f3' },
  USER_INVITED:            { icon: '✉️', label: 'User invited',        color: '#534AB7', bg: '#EEEDFE' },
  // Expenses
  EXPENSE_CREATED:         { icon: '🧾', label: 'Expense created',     color: '#185FA5', bg: '#E6F1FB' },
  EXPENSE_SUBMITTED:       { icon: '📤', label: 'Expense submitted',   color: '#185FA5', bg: '#E6F1FB' },
  EXPENSE_APPROVED:        { icon: '✅', label: 'Expense approved',    color: '#3B6D11', bg: '#EAF3DE' },
  EXPENSE_REJECTED:        { icon: '❌', label: 'Expense rejected',    color: '#A32D2D', bg: '#FCEBEB' },
  EXPENSE_FLAGGED:         { icon: '🚩', label: 'Expense flagged',     color: '#BA7517', bg: '#FAEEDA' },
  EXPENSE_EXPORTED:        { icon: '📊', label: 'Expense exported',    color: '#534AB7', bg: '#EEEDFE' },
  // Invoices
  INVOICE_AP_CREATED:      { icon: '📄', label: 'AP invoice created',  color: '#185FA5', bg: '#E6F1FB' },
  INVOICE_AP_APPROVED:     { icon: '✅', label: 'AP invoice approved', color: '#3B6D11', bg: '#EAF3DE' },
  INVOICE_AP_PAID:         { icon: '💸', label: 'AP invoice paid',     color: '#3B6D11', bg: '#EAF3DE' },
  INVOICE_AR_CREATED:      { icon: '📤', label: 'AR invoice created',  color: '#185FA5', bg: '#E6F1FB' },
  INVOICE_AR_SENT:         { icon: '✉️', label: 'AR invoice sent',     color: '#185FA5', bg: '#E6F1FB' },
  INVOICE_AR_PAID:         { icon: '💰', label: 'AR invoice paid',     color: '#3B6D11', bg: '#EAF3DE' },
  // Cards
  CARD_CREATED:            { icon: '💳', label: 'Card created',        color: '#185FA5', bg: '#E6F1FB' },
  CARD_FROZEN:             { icon: '🔒', label: 'Card frozen',         color: '#BA7517', bg: '#FAEEDA' },
  CARD_UNFROZEN:           { icon: '🔓', label: 'Card unfrozen',       color: '#3B6D11', bg: '#EAF3DE' },
  CARD_LIMIT_CHANGED:      { icon: '🔄', label: 'Card limit changed',  color: '#185FA5', bg: '#E6F1FB' },
  // DATEV
  DATEV_EXPORT:            { icon: '📊', label: 'DATEV export',        color: '#534AB7', bg: '#EEEDFE' },
  DATEV_PERIOD_LOCKED:     { icon: '🔒', label: 'Period locked',       color: '#534AB7', bg: '#EEEDFE' },
  // Settings
  ORG_PROFILE_UPDATED:     { icon: '🏢', label: 'Profile updated',     color: '#185FA5', bg: '#E6F1FB' },
  APPROVAL_POLICIES_UPDATED:{ icon: '⚙️', label: 'Policies updated',  color: '#185FA5', bg: '#E6F1FB' },
  // Admin
  USER_IMPERSONATED:       { icon: '👤', label: 'User impersonated',   color: '#A32D2D', bg: '#FCEBEB' },
  FEATURE_FLAG_TOGGLED:    { icon: '🚦', label: 'Feature flag toggled', color: '#BA7517', bg: '#FAEEDA' },
  // Import
  BULK_IMPORT:             { icon: '📥', label: 'Bulk import',         color: '#0F6E56', bg: '#E1F5EE' },
}

function getActionConfig(action: string) {
  return ACTION_CONFIG[action] ?? { icon: '⚡', label: action.replace(/_/g, ' '), color: '#9CA3AF', bg: '#f5f5f3' }
}

const ENTITY_TYPES = ['All', 'Expense', 'SupplierInvoice', 'CustomerInvoice', 'CorporateCard', 'Organization', 'User']

const ACTION_GROUPS: Record<string, string[]> = {
  'All': [],
  'Authentication': ['USER_LOGIN', 'USER_LOGOUT', 'USER_INVITED'],
  'Expenses': ['EXPENSE_CREATED', 'EXPENSE_SUBMITTED', 'EXPENSE_APPROVED', 'EXPENSE_REJECTED', 'EXPENSE_FLAGGED', 'EXPENSE_EXPORTED'],
  'Invoices': ['INVOICE_AP_CREATED', 'INVOICE_AP_APPROVED', 'INVOICE_AP_PAID', 'INVOICE_AR_CREATED', 'INVOICE_AR_SENT', 'INVOICE_AR_PAID'],
  'Cards': ['CARD_CREATED', 'CARD_FROZEN', 'CARD_UNFROZEN', 'CARD_LIMIT_CHANGED'],
  'Accounting': ['DATEV_EXPORT', 'DATEV_PERIOD_LOCKED'],
  'Admin': ['USER_IMPERSONATED', 'FEATURE_FLAG_TOGGLED', 'BULK_IMPORT', 'ORG_PROFILE_UPDATED'],
}

// ─────────────────────────────────────────────
// AUDIT ROW
// ─────────────────────────────────────────────

function AuditRow({ entry }: { entry: AuditEntry }) {
  const cfg = getActionConfig(entry.action)
  const [expanded, setExpanded] = useState(false)
  const hasMetadata = entry.metadata && Object.keys(entry.metadata).length > 0

  return (
    <>
      <tr
        onClick={() => hasMetadata && setExpanded(p => !p)}
        style={{ cursor: hasMetadata ? 'pointer' : 'default', background: expanded ? '#fafafa' : '#fff' }}
      >
        <td style={{ padding: '9px 12px', borderBottom: '.5px solid #f5f5f3', width: 28 }}>
          <span style={{ fontSize: 14 }}>{cfg.icon}</span>
        </td>
        <td style={{ padding: '9px 8px', borderBottom: '.5px solid #f5f5f3' }}>
          <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 10, background: cfg.bg, color: cfg.color, fontWeight: 500 }}>
            {cfg.label}
          </span>
        </td>
        <td style={{ padding: '9px 8px', borderBottom: '.5px solid #f5f5f3' }}>
          <div style={{ fontSize: 12, fontWeight: 500 }}>{entry.actorName ?? entry.actorEmail ?? 'System'}</div>
          {entry.actorEmail && entry.actorName && (
            <div style={{ fontSize: 10.5, color: '#9CA3AF' }}>{entry.actorEmail}</div>
          )}
        </td>
        <td style={{ padding: '9px 8px', borderBottom: '.5px solid #f5f5f3' }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#6B7280', background: '#f5f5f3', padding: '1px 6px', borderRadius: 4 }}>
            {entry.entityType}
          </span>
        </td>
        <td style={{ padding: '9px 8px', borderBottom: '.5px solid #f5f5f3', fontSize: 10.5, fontFamily: 'monospace', color: '#9CA3AF' }}>
          {entry.entityId.slice(0, 8)}…
        </td>
        <td style={{ padding: '9px 8px', borderBottom: '.5px solid #f5f5f3', fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
          {new Date(entry.createdAt).toLocaleString('de-DE', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </td>
        <td style={{ padding: '9px 8px', borderBottom: '.5px solid #f5f5f3', fontSize: 11, color: '#9CA3AF' }}>
          {entry.ipAddress}
        </td>
        <td style={{ padding: '9px 12px', borderBottom: '.5px solid #f5f5f3' }}>
          {hasMetadata && (
            <span style={{ fontSize: 10.5, color: '#9CA3AF', userSelect: 'none' }}>
              {expanded ? '▲' : '▼'}
            </span>
          )}
        </td>
      </tr>
      {expanded && hasMetadata && (
        <tr style={{ background: '#fafafa' }}>
          <td colSpan={8} style={{ padding: '0 12px 10px 52px', borderBottom: '.5px solid #f5f5f3' }}>
            <pre style={{ fontSize: 11, fontFamily: 'monospace', color: '#374151', background: '#f0f0ee', padding: '8px 12px', borderRadius: 6, overflow: 'auto', maxHeight: 200 }}>
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

// ─────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────

export default function AuditLogPage() {
  const [search, setSearch] = useState('')
  const [actionGroup, setActionGroup] = useState('All')
  const [entityType, setEntityType] = useState('All')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const params = new URLSearchParams()
  params.set('section', 'audit')
  if (search) params.set('q', search)
  if (actionGroup !== 'All') params.set('actions', ACTION_GROUPS[actionGroup].join(','))
  if (entityType !== 'All') params.set('entityType', entityType)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  params.set('limit', '50')

  const { data: envelope, isLoading, loadMore, hasMore } = usePaginated<AuditEntry>(
    `audit:${params.toString()}`,
    (cursor) => api.get(`/api/admin?${params.toString()}${cursor ? `&cursor=${cursor}` : ''}`),
    { pageSize: 50 }
  )

  const entries: AuditEntry[] = (envelope as Array<{ data: { entries: AuditEntry[] } }> | null)
    ?.flatMap(p => p.data.entries) ?? []

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by user, entity ID, action…"
          style={{ padding: '6px 10px', border: '.5px solid var(--border)', borderRadius: 7, fontSize: 12, minWidth: 220, flex: 1 }}
        />
        <select value={actionGroup} onChange={e => setActionGroup(e.target.value)}
          style={{ padding: '6px 10px', border: '.5px solid var(--border)', borderRadius: 7, fontSize: 12, background: '#fff' }}>
          {Object.keys(ACTION_GROUPS).map(g => <option key={g}>{g}</option>)}
        </select>
        <select value={entityType} onChange={e => setEntityType(e.target.value)}
          style={{ padding: '6px 10px', border: '.5px solid var(--border)', borderRadius: 7, fontSize: 12, background: '#fff' }}>
          {ENTITY_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          style={{ padding: '6px 8px', border: '.5px solid var(--border)', borderRadius: 7, fontSize: 12 }} />
        <span style={{ fontSize: 11, color: '#9CA3AF' }}>to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          style={{ padding: '6px 8px', border: '.5px solid var(--border)', borderRadius: 7, fontSize: 12 }} />
        {(search || actionGroup !== 'All' || entityType !== 'All' || from || to) && (
          <button onClick={() => { setSearch(''); setActionGroup('All'); setEntityType('All'); setFrom(''); setTo('') }}
            style={{ padding: '6px 12px', border: '.5px solid var(--border)', borderRadius: 7, background: '#fff', fontSize: 12, cursor: 'pointer', color: '#9CA3AF' }}>
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '.5px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid #E8E8E4', borderTopColor: '#185FA5', animation: 'spin .7s linear infinite' }} />
          </div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '50px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
            No audit events found for this filter
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8f8f6' }}>
                {['', 'Action', 'Actor', 'Entity type', 'Entity ID', 'Timestamp', 'IP', ''].map((h, i) => (
                  <th key={i} style={{ padding: '8px 8px', textAlign: 'left', fontSize: 10.5, fontWeight: 500, color: '#9CA3AF', borderBottom: '.5px solid var(--border)', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => <AuditRow key={entry.id} entry={entry} />)}
            </tbody>
          </table>
        )}
      </div>

      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button onClick={loadMore}
            style={{ padding: '8px 22px', border: '.5px solid var(--border)', borderRadius: 8, background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>
            Load more
          </button>
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 10.5, color: '#9CA3AF', textAlign: 'center' }}>
        Audit logs are retained for 10 years per §147 AO (Abgabenordnung)
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

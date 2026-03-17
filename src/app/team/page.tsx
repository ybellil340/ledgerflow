'use client'

import { useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { settingsApi } from '@/lib/api/endpoints'
import { useAuth } from '@/lib/store/auth'
import { useToast } from '@/components/providers/error-system'
import { Button, Badge, Modal, Input, Select, Card, Spinner, EmptyState, Table } from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'COMPANY_ADMIN' | 'FINANCE_MANAGER' | 'APPROVER' | 'EMPLOYEE'

interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  department?: string
  lastActiveAt?: string
  createdAt: string
  hasTwoFactor: boolean
  isActive: boolean
  avatarInitials: string
  avatarColor: string
}

interface Invitation {
  id: string
  email: string
  role: Role
  department?: string
  invitedBy: string
  expiresAt: string
  createdAt: string
}

interface Department {
  id: string
  name: string
  code: string
  memberCount: number
  monthlyBudget?: number
}

type Tab = 'members' | 'invitations' | 'departments'

// ─── Role descriptions ─────────────────────────────────────────────────────────

const ROLE_VARIANTS: Record<Role, string> = {
  COMPANY_ADMIN: 'purple',
  FINANCE_MANAGER: 'blue',
  APPROVER: 'green',
  EMPLOYEE: 'gray',
}

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  COMPANY_ADMIN: 'Full access — manage billing, settings, all data',
  FINANCE_MANAGER: 'Manage expenses, invoices, accounting, exports',
  APPROVER: 'Approve/reject expenses and invoices in their scope',
  EMPLOYEE: 'Submit expenses and view own data only',
}

// ─── Invite modal ──────────────────────────────────────────────────────────────

function InviteModal({ departments, onClose, onSuccess }: {
  departments: Department[]
  onClose(): void
  onSuccess(): void
}) {
  const [form, setForm] = useState({ email: '', role: 'EMPLOYEE' as Role, departmentId: '' })
  const { toast } = useToast()
  const mutation = useMutation()

  async function submit() {
    if (!form.email.includes('@')) {
      toast({ type: 'error', message: 'Enter a valid email address' })
      return
    }
    try {
      await mutation.mutate(() => settingsApi.inviteMember({
        email: form.email,
        role: form.role,
        departmentId: form.departmentId || undefined,
      }))
      toast({ type: 'success', message: `Invitation sent to ${form.email}` })
      invalidateQuery('team')
      onSuccess()
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <Modal title="Invite team member" subtitle="They'll receive an email to set up their account" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="f-label">Email address *</label>
          <Input
            type="email"
            value={form.email}
            onChange={(v) => setForm((f) => ({ ...f, email: v }))}
            placeholder="colleague@firma.de"
          />
        </div>
        <div>
          <label className="f-label">Role *</label>
          <Select
            value={form.role}
            onChange={(v) => setForm((f) => ({ ...f, role: v as Role }))}
            options={(['EMPLOYEE', 'APPROVER', 'FINANCE_MANAGER', 'COMPANY_ADMIN'] as Role[]).map((r) => ({
              value: r,
              label: r.replace(/_/g, ' '),
            }))}
          />
          <p className="text-xs text-gray-400 mt-1">{ROLE_DESCRIPTIONS[form.role]}</p>
        </div>
        <div>
          <label className="f-label">Department</label>
          <Select
            value={form.departmentId}
            onChange={(v) => setForm((f) => ({ ...f, departmentId: v }))}
            options={[
              { value: '', label: 'No department' },
              ...departments.map((d) => ({ value: d.id, label: `${d.name} (${d.code})` })),
            ]}
          />
        </div>
      </div>
      <div className="flex gap-2 mt-5 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={mutation.isLoading}>Send invitation</Button>
      </div>
    </Modal>
  )
}

// ─── Edit role modal ───────────────────────────────────────────────────────────

function EditMemberModal({ member, departments, onClose }: {
  member: TeamMember
  departments: Department[]
  onClose(): void
}) {
  const [role, setRole] = useState<Role>(member.role)
  const [departmentId, setDepartmentId] = useState(member.department ?? '')
  const { toast } = useToast()
  const mutation = useMutation()

  async function submit() {
    try {
      await mutation.mutate(() => settingsApi.updateMember(member.id, { role, departmentId: departmentId || undefined }))
      toast({ type: 'success', message: `${member.name} updated` })
      invalidateQuery('team')
      onClose()
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <Modal title={`Edit — ${member.name}`} subtitle={member.email} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="f-label">Role</label>
          <Select
            value={role}
            onChange={(v) => setRole(v as Role)}
            options={(['EMPLOYEE', 'APPROVER', 'FINANCE_MANAGER', 'COMPANY_ADMIN'] as Role[]).map((r) => ({
              value: r,
              label: r.replace(/_/g, ' '),
            }))}
          />
          <p className="text-xs text-gray-400 mt-1">{ROLE_DESCRIPTIONS[role]}</p>
        </div>
        <div>
          <label className="f-label">Department</label>
          <Select
            value={departmentId}
            onChange={setDepartmentId}
            options={[
              { value: '', label: 'No department' },
              ...departments.map((d) => ({ value: d.id, label: `${d.name} (${d.code})` })),
            ]}
          />
        </div>
      </div>
      <div className="flex gap-2 mt-5 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={mutation.isLoading}>Save changes</Button>
      </div>
    </Modal>
  )
}

// ─── Member avatar ─────────────────────────────────────────────────────────────

function Avatar({ initials, color }: { initials: string; color: string }) {
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
      style={{ background: color }}
    >
      {initials}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { can } = useAuth()
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('members')
  const [search, setSearch] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)

  const { data: members, isLoading: membersLoading } = useQuery<TeamMember[]>(
    'team/members',
    () => settingsApi.listMembers()
  )

  const { data: invitations, isLoading: invitationsLoading } = useQuery<Invitation[]>(
    'team/invitations',
    () => settingsApi.listInvitations()
  )

  const { data: departments, isLoading: depsLoading } = useQuery<Department[]>(
    'team/departments',
    () => settingsApi.listDepartments()
  )

  const revokeInvitation = useCallback(async (id: string) => {
    try {
      await settingsApi.revokeInvitation(id)
      toast({ type: 'info', message: 'Invitation revoked' })
      invalidateQuery('team')
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }, [toast])

  const resendInvitation = useCallback(async (id: string) => {
    try {
      await settingsApi.resendInvitation(id)
      toast({ type: 'success', message: 'Invitation resent' })
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }, [toast])

  const filteredMembers = useMemo(() => {
    if (!members) return []
    const q = search.toLowerCase()
    return q
      ? members.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.email.toLowerCase().includes(q) ||
            m.department?.toLowerCase().includes(q)
        )
      : members
  }, [members, search])

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'members', label: 'Members', count: members?.length },
    { key: 'invitations', label: 'Invitations', count: invitations?.length },
    { key: 'departments', label: 'Departments' },
  ]

  return (
    <AppShell
      title="Team"
      subtitle={members ? `${members.length} members - ${invitations?.length ?? 0} pending invitations` : 'Loading...'}
      action={
        can('team:invite') ? (
          <Button variant="primary" onClick={() => setShowInviteModal(true)}>+ Invite member</Button>
        ) : undefined
      }
    >
      <div className="tab-bar mb-4">
        {TABS.map((t) => (
          <button key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.count !== undefined && (
              <span className="ml-1.5 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── MEMBERS ── */}
      {tab === 'members' && (
        <>
          <div className="filter-row mb-3">
            <input
              className="search-box"
              placeholder="Search members by name, email, or department..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {membersLoading ? <Spinner /> : !filteredMembers.length ? (
            <EmptyState
              title={search ? 'No members match your search' : 'No team members yet'}
              action={can('team:invite') ? (
                <Button variant="primary" onClick={() => setShowInviteModal(true)}>+ Invite member</Button>
              ) : undefined}
            />
          ) : (
            <Card className="p-0 mb-4">
              <Table
                columns={['Member', 'Role', 'Department', 'Last active', '2FA', 'Joined', '']}
                rows={filteredMembers.map((m) => [
                  <div key="m" className="flex items-center gap-2.5">
                    <Avatar initials={m.avatarInitials} color={m.avatarColor} />
                    <div>
                      <div className="text-sm font-medium">{m.name}</div>
                      <div className="text-xs text-gray-400">{m.email}</div>
                    </div>
                  </div>,
                  <Badge key="r" label={m.role.replace(/_/g, ' ')} variant={ROLE_VARIANTS[m.role] as any} />,
                  <span key="d" className="text-gray-500 text-sm">{m.department || '—'}</span>,
                  <span key="la" className="text-gray-400 text-xs">{m.lastActiveAt ?? 'Never'}</span>,
                  <Badge key="2fa" label={m.hasTwoFactor ? 'Enabled' : 'Off'} variant={m.hasTwoFactor ? 'green' : 'gray'} size="sm" />,
                  <span key="j" className="text-gray-400 text-xs">{new Date(m.createdAt).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}</span>,
                  can('team:manage') ? (
                    <button key="e" className="apb text-xs" onClick={() => setEditingMember(m)}>Edit</button>
                  ) : null,
                ])}
              />
            </Card>
          )}

          {/* Department mini-cards */}
          {!depsLoading && (departments ?? []).length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {(departments ?? []).map((dept) => (
                <Card key={dept.id} className="p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm font-medium">{dept.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{dept.code}</div>
                    </div>
                    {can('team:manage') && (
                      <button className="apb text-[10px]">Edit</button>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">{dept.memberCount} member{dept.memberCount !== 1 ? 's' : ''}</div>
                  {dept.monthlyBudget && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      Budget: €{dept.monthlyBudget.toLocaleString('de-DE')}/mo
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── INVITATIONS ── */}
      {tab === 'invitations' && (
        invitationsLoading ? <Spinner /> : !invitations?.length ? (
          <EmptyState
            title="No pending invitations"
            description="Invite team members above to get started."
            action={can('team:invite') ? (
              <Button variant="primary" onClick={() => setShowInviteModal(true)}>+ Invite member</Button>
            ) : undefined}
          />
        ) : (
          <Card className="p-0">
            <Table
              columns={['Email', 'Role', 'Department', 'Invited by', 'Expires', '']}
              rows={invitations.map((inv) => [
                <span key="e" className="text-sm font-medium">{inv.email}</span>,
                <Badge key="r" label={inv.role.replace(/_/g, ' ')} variant={ROLE_VARIANTS[inv.role] as any} />,
                inv.department || '—',
                <span key="by" className="text-xs text-gray-400">{inv.invitedBy}</span>,
                <span key="exp" className="text-xs text-gray-400">{new Date(inv.expiresAt).toLocaleDateString('de-DE')}</span>,
                <div key="act" className="flex gap-1.5">
                  <button className="apb apb-y text-xs" onClick={() => resendInvitation(inv.id)}>Resend</button>
                  <button className="apb apb-n text-xs" onClick={() => revokeInvitation(inv.id)}>Revoke</button>
                </div>,
              ])}
            />
          </Card>
        )
      )}

      {/* ── DEPARTMENTS ── */}
      {tab === 'departments' && (
        depsLoading ? <Spinner /> : !departments?.length ? (
          <EmptyState title="No departments" description="Departments help organize team members and budget tracking." />
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {departments.map((dept) => (
              <Card key={dept.id} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-medium">{dept.name}</div>
                    <div className="text-xs text-gray-400 font-mono mt-0.5">{dept.code}</div>
                  </div>
                  {can('team:manage') && (
                    <button className="apb text-xs">Edit</button>
                  )}
                </div>
                <div className="text-sm text-gray-500 mb-1">
                  {dept.memberCount} member{dept.memberCount !== 1 ? 's' : ''}
                </div>
                {dept.monthlyBudget && (
                  <div className="text-xs text-gray-400">
                    Budget: €{dept.monthlyBudget.toLocaleString('de-DE')}/month
                  </div>
                )}
              </Card>
            ))}
          </div>
        )
      )}

      {showInviteModal && (
        <InviteModal
          departments={departments ?? []}
          onClose={() => setShowInviteModal(false)}
          onSuccess={() => setShowInviteModal(false)}
        />
      )}

      {editingMember && (
        <EditMemberModal
          member={editingMember}
          departments={departments ?? []}
          onClose={() => setEditingMember(null)}
        />
      )}
    </AppShell>
  )
}

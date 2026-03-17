'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Button, Badge, Card, Table, Th, Td, Input, Select, Modal, Textarea, Spinner, EmptyState, Avatar, statusBadge } from '@/components/ui'
import { Header } from '@/components/layout/AppShell'

interface Member {
  id: string
  role: string
  status: string
  joinedAt: string
  departmentId?: string
  user: { id: string; firstName: string; lastName: string; email: string; avatarUrl?: string; lastLoginAt?: string; twoFactorEnabled?: boolean }
  department?: { name: string }
}

interface Invitation {
  id: string
  email: string
  role: string
  expiresAt: string
  acceptedAt?: string
}

interface Department {
  id: string
  name: string
  code?: string
  budgetMonthly?: number
  _count?: { memberships: number }
}

const ROLE_OPTIONS = [
  { value: 'COMPANY_ADMIN', label: 'Company Admin' },
  { value: 'FINANCE_MANAGER', label: 'Finance Manager' },
  { value: 'APPROVER', label: 'Approver' },
  { value: 'EMPLOYEE', label: 'Employee' },
]

const ROLE_COLORS: Record<string, 'purple' | 'blue' | 'green' | 'gray'> = {
  COMPANY_ADMIN: 'purple',
  FINANCE_MANAGER: 'blue',
  APPROVER: 'green',
  EMPLOYEE: 'gray',
  TAX_ADVISOR: 'amber' as never,
}

export default function TeamPage() {
  const [tab, setTab] = useState<'members' | 'invitations' | 'departments'>('members')
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [deptOpen, setDeptOpen] = useState(false)

  const [inviteForm, setInviteForm] = useState({ email: '', role: 'EMPLOYEE', departmentId: '' })
  const [deptForm, setDeptForm] = useState({ name: '', code: '', budgetMonthly: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [membersRes, deptsRes] = await Promise.all([
      fetch('/api/settings/team'),
      fetch('/api/settings/departments'),
    ])
    const [membersData, deptsData] = await Promise.all([membersRes.json(), deptsRes.json()])
    setMembers(membersData.data?.members ?? [])
    setInvitations(membersData.data?.invitations ?? [])
    setDepartments(deptsData.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteForm),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to send invite'); return }
      setInviteOpen(false)
      setInviteForm({ email: '', role: 'EMPLOYEE', departmentId: '' })
      load()
    } catch { setError('Network error') } finally { setSubmitting(false) }
  }

  async function createDepartment(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/settings/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...deptForm, budgetMonthly: deptForm.budgetMonthly ? parseFloat(deptForm.budgetMonthly) : undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      setDeptOpen(false)
      setDeptForm({ name: '', code: '', budgetMonthly: '' })
      load()
    } catch { setError('Network error') } finally { setSubmitting(false) }
  }

  const activeMembers = members.filter((m) => m.status === 'ACTIVE')
  const pendingInvites = invitations.filter((i) => !i.acceptedAt && new Date(i.expiresAt) > new Date())

  return (
    <>
      <Header
        title="Team"
        subtitle={`${activeMembers.length} active members · ${pendingInvites.length} pending invitations`}
        actions={
          <div className="flex gap-2">
            {tab === 'departments' && (
              <Button variant="secondary" size="sm" onClick={() => setDeptOpen(true)}>+ Department</Button>
            )}
            <Button variant="primary" size="sm" onClick={() => setInviteOpen(true)}>+ Invite member</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Tab bar */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {(['members', 'invitations', 'departments'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all capitalize ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t === 'invitations' ? `Invitations ${pendingInvites.length > 0 ? `(${pendingInvites.length})` : ''}` : t}
            </button>
          ))}
        </div>

        {loading && <div className="flex items-center justify-center h-48"><Spinner size="lg" /></div>}

        {/* Members */}
        {!loading && tab === 'members' && (
          <Card padding="none">
            {activeMembers.length === 0 ? <EmptyState title="No team members" action={<Button variant="primary" size="sm" onClick={() => setInviteOpen(true)}>+ Invite first member</Button>} /> : (
              <Table>
                <thead><tr><Th>Member</Th><Th>Role</Th><Th>Department</Th><Th>Last active</Th><Th>2FA</Th><Th>Joined</Th><Th className="w-24" /></tr></thead>
                <tbody>
                  {activeMembers.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar firstName={m.user.firstName} lastName={m.user.lastName} avatarUrl={m.user.avatarUrl} size="sm" />
                          <div>
                            <div className="font-medium text-sm text-gray-900">{m.user.firstName} {m.user.lastName}</div>
                            <div className="text-xs text-gray-400">{m.user.email}</div>
                          </div>
                        </div>
                      </Td>
                      <Td><Badge variant={ROLE_COLORS[m.role] ?? 'gray'}>{m.role.replace('_', ' ')}</Badge></Td>
                      <Td><span className="text-xs text-gray-600">{m.department?.name ?? '—'}</span></Td>
                      <Td><span className="text-xs text-gray-500">{m.user.lastLoginAt ? new Date(m.user.lastLoginAt).toLocaleDateString('de-DE') : 'Never'}</span></Td>
                      <Td><Badge variant={m.user.twoFactorEnabled ? 'green' : 'gray'} size="sm">{m.user.twoFactorEnabled ? 'On' : 'Off'}</Badge></Td>
                      <Td><span className="text-xs text-gray-500">{new Date(m.joinedAt).toLocaleDateString('de-DE')}</span></Td>
                      <Td>
                        <button className="text-xs text-gray-400 hover:text-red-500 transition-colors">Remove</button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}

        {/* Invitations */}
        {!loading && tab === 'invitations' && (
          <Card padding="none">
            {invitations.length === 0 ? <EmptyState title="No invitations" description="Invite team members to join your workspace" action={<Button variant="primary" size="sm" onClick={() => setInviteOpen(true)}>+ Invite member</Button>} /> : (
              <Table>
                <thead><tr><Th>Email</Th><Th>Role</Th><Th>Sent</Th><Th>Expires</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {invitations.map((inv) => {
                    const expired = new Date(inv.expiresAt) <= new Date()
                    return (
                      <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                        <Td><span className="text-sm text-gray-900">{inv.email}</span></Td>
                        <Td><Badge variant={ROLE_COLORS[inv.role] ?? 'gray'}>{inv.role.replace('_', ' ')}</Badge></Td>
                        <Td><span className="text-xs text-gray-500">—</span></Td>
                        <Td><span className={`text-xs ${expired ? 'text-red-500' : 'text-gray-500'}`}>{new Date(inv.expiresAt).toLocaleDateString('de-DE')}</span></Td>
                        <Td>
                          {inv.acceptedAt
                            ? <Badge variant="green" size="sm">Accepted</Badge>
                            : expired
                            ? <Badge variant="red" size="sm">Expired</Badge>
                            : <Badge variant="amber" size="sm">Pending</Badge>}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        )}

        {/* Departments */}
        {!loading && tab === 'departments' && (
          <div className="grid grid-cols-3 gap-3">
            {departments.length === 0 ? (
              <div className="col-span-3">
                <EmptyState title="No departments" description="Create departments to organize your team and set budgets" action={<Button variant="primary" size="sm" onClick={() => setDeptOpen(true)}>+ Create department</Button>} />
              </div>
            ) : departments.map((dept) => (
              <Card key={dept.id}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-semibold text-gray-900">{dept.name}</div>
                    {dept.code && <div className="text-xs text-gray-400 font-mono">{dept.code}</div>}
                  </div>
                  <button className="text-xs text-gray-400 hover:text-gray-600">Edit</button>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{dept._count?.memberships ?? 0} members</span>
                  {dept.budgetMonthly && <span>Budget: €{dept.budgetMonthly.toLocaleString('de-DE', { minimumFractionDigits: 0 })}/mo</span>}
                </div>
              </Card>
            ))}
            <Card className="border-2 border-dashed border-gray-200 flex items-center justify-center cursor-pointer hover:border-gray-300 transition-colors" onClick={() => setDeptOpen(true)}>
              <div className="text-center text-gray-400">
                <div className="text-2xl mb-1">+</div>
                <div className="text-xs">New department</div>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Invite modal */}
      <Modal open={inviteOpen} onClose={() => { setInviteOpen(false); setError('') }} title="Invite team member" description="They'll receive an email with a link to join your workspace"
        footer={<><Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button><Button variant="primary" onClick={sendInvite} loading={submitting}>Send invitation</Button></>}
      >
        {error && <div className="mb-4 p-3 bg-red-50 rounded-lg text-sm text-red-700">{error}</div>}
        <div className="space-y-4">
          <Input label="Email address" type="email" value={inviteForm.email} onChange={(e) => setInviteForm((p) => ({ ...p, email: e.target.value }))} placeholder="colleague@company.de" required />
          <Select label="Role" value={inviteForm.role} onChange={(e) => setInviteForm((p) => ({ ...p, role: e.target.value }))} options={ROLE_OPTIONS} />
          <Select label="Department (optional)" value={inviteForm.departmentId} onChange={(e) => setInviteForm((p) => ({ ...p, departmentId: e.target.value }))}
            options={departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="No department" />

          <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700">
            <div className="font-semibold mb-1">Role permissions</div>
            <div className="space-y-0.5 text-blue-600">
              {inviteForm.role === 'COMPANY_ADMIN' && <p>Full access: manage team, cards, expenses, invoices, billing, and settings</p>}
              {inviteForm.role === 'FINANCE_MANAGER' && <p>Manage and approve expenses, invoices, accounting exports. Cannot manage billing or subscription.</p>}
              {inviteForm.role === 'APPROVER' && <p>Approve or reject expenses and invoices assigned to their department</p>}
              {inviteForm.role === 'EMPLOYEE' && <p>Submit expenses, upload receipts, request reimbursements. View own spending only.</p>}
            </div>
          </div>
        </div>
      </Modal>

      {/* Department modal */}
      <Modal open={deptOpen} onClose={() => { setDeptOpen(false); setError('') }} title="Create department"
        footer={<><Button variant="ghost" onClick={() => setDeptOpen(false)}>Cancel</Button><Button variant="primary" onClick={createDepartment} loading={submitting}>Create</Button></>}
      >
        {error && <div className="mb-4 p-3 bg-red-50 rounded-lg text-sm text-red-700">{error}</div>}
        <div className="space-y-4">
          <Input label="Department name" value={deptForm.name} onChange={(e) => setDeptForm((p) => ({ ...p, name: e.target.value }))} placeholder="Sales, Engineering, Marketing..." required />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Code (optional)" value={deptForm.code} onChange={(e) => setDeptForm((p) => ({ ...p, code: e.target.value }))} placeholder="SALES, ENG..." />
            <Input label="Monthly budget (optional)" type="number" value={deptForm.budgetMonthly} onChange={(e) => setDeptForm((p) => ({ ...p, budgetMonthly: e.target.value }))} leftAddon="€" placeholder="5000" />
          </div>
        </div>
      </Modal>
    </>
  )
}

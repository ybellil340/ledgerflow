'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Button, Badge, FilterChip, Card, Table, Th, Td, Avatar, Modal, Select, Spinner, EmptyState, statusBadge } from '@/components/ui'
import { Header } from '@/components/layout/AppShell'

interface Transaction {
  id: string
  merchant: string
  merchantCategory?: string
  amount: number
  currency: string
  transactionDate: string
  status: string
  isPersonal: boolean
  isSplit: boolean
  categoryId?: string
  accountingCode?: string
  vatCode?: { code: string; rate: number }
  card?: { lastFour: string; type: string; user: { firstName: string; lastName: string } }
  receipt?: { id: string; fileUrl: string } | null
  expense?: { id: string; status: string } | null
  splits?: Array<{ id: string; amount: number; description: string }>
}

const STATUS_FILTERS = ['', 'UNCATEGORIZED', 'CATEGORIZED', 'MATCHED', 'RECONCILED', 'FLAGGED', 'PERSONAL']
const LABEL = (s: string) => ({ '': 'All', UNCATEGORIZED: 'Uncategorized', CATEGORIZED: 'Categorized', MATCHED: 'Matched', RECONCILED: 'Reconciled', FLAGGED: 'Flagged', PERSONAL: 'Personal' }[s] ?? s)

const VAT_OPTIONS = [
  { value: '', label: 'No VAT' },
  { value: 'VSt19', label: '19% Vorsteuer' },
  { value: 'VSt7', label: '7% Vorsteuer' },
  { value: 'VSt0', label: 'Steuerfrei' },
  { value: 'EUV', label: 'EU innergemeinschaftlich' },
]

const CATEGORIES = ['Travel', 'Software', 'Meals', 'Equipment', 'Office', 'Marketing', 'Consulting', 'Banking', 'Other']

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkCategory, setBulkCategory] = useState('')
  const [bulkVat, setBulkVat] = useState('')

  const fetchTx = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), perPage: '30' })
    if (statusFilter) params.append('status', statusFilter)
    const res = await fetch(`/api/transactions?${params}`)
    const data = await res.json()
    setTransactions(data.data ?? [])
    setTotal(data.meta?.total ?? 0)
    const counts: Record<string, number> = {}
    for (const s of data.statusCounts ?? []) counts[s.status] = s.count
    setStatusCounts(counts)
    setLoading(false)
  }, [statusFilter, page])

  useEffect(() => { fetchTx() }, [fetchTx])

  function toggleAll() {
    selected.size === transactions.length
      ? setSelected(new Set())
      : setSelected(new Set(transactions.map((t) => t.id)))
  }

  async function bulkUpdate() {
    if (selected.size === 0) return
    const body: Record<string, unknown> = { ids: [...selected] }
    if (bulkCategory) body.categoryId = bulkCategory
    if (bulkVat) body.vatCodeId = bulkVat
    if (bulkCategory || bulkVat) body.status = 'CATEGORIZED'

    await fetch('/api/transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSelected(new Set())
    setBulkOpen(false)
    setBulkCategory('')
    setBulkVat('')
    fetchTx()
  }

  const uncategorizedCount = statusCounts['UNCATEGORIZED'] ?? 0
  const totalInflow = transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalOutflow = transactions.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)

  return (
    <>
      <Header
        title="Transactions"
        subtitle={`${total} transactions · bank & card feed`}
        actions={
          <Button variant="secondary" size="sm">
            ↓ Sync bank
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total transactions', value: total },
            { label: 'Inflow', value: `+€${totalInflow.toLocaleString('de-DE', { minimumFractionDigits: 0 })}`, color: 'text-green-700' },
            { label: 'Outflow', value: `−€${totalOutflow.toLocaleString('de-DE', { minimumFractionDigits: 0 })}`, color: 'text-gray-900' },
            { label: 'Uncategorized', value: uncategorizedCount, color: uncategorizedCount > 0 ? 'text-amber-600' : 'text-green-700' },
          ].map((kpi) => (
            <Card key={kpi.label} className="p-4">
              <div className="text-xs text-gray-500 mb-1">{kpi.label}</div>
              <div className={`text-xl font-semibold ${kpi.color ?? 'text-gray-900'}`}>{kpi.value}</div>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <FilterChip
              key={f}
              label={LABEL(f)}
              active={statusFilter === f}
              count={f && statusCounts[f] ? statusCounts[f] : undefined}
              onClick={() => { setStatusFilter(f); setPage(1) }}
            />
          ))}
          <div className="ml-auto flex gap-2">
            {selected.size > 0 && (
              <Button variant="primary" size="sm" onClick={() => setBulkOpen(true)}>
                Categorize {selected.size} selected
              </Button>
            )}
            <Button variant="secondary" size="sm">Export CSV</Button>
          </div>
        </div>

        {/* Table */}
        <Card padding="none">
          {loading ? (
            <div className="flex items-center justify-center h-48"><Spinner size="lg" /></div>
          ) : transactions.length === 0 ? (
            <EmptyState title="No transactions" description="Transactions appear here after bank sync or card activity" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th className="w-9">
                    <input type="checkbox" checked={selected.size === transactions.length} onChange={toggleAll} className="rounded border-gray-300" />
                  </Th>
                  <Th>Date</Th>
                  <Th>Merchant</Th>
                  <Th>Card / Source</Th>
                  <Th>Category</Th>
                  <Th>VAT</Th>
                  <Th>Receipt</Th>
                  <Th>Expense</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                    <Td>
                      <input
                        type="checkbox"
                        checked={selected.has(tx.id)}
                        onChange={() => setSelected((prev) => {
                          const next = new Set(prev)
                          if (next.has(tx.id)) next.delete(tx.id)
                          else next.add(tx.id)
                          return next
                        })}
                        className="rounded border-gray-300"
                      />
                    </Td>
                    <Td>
                      <span className="text-xs text-gray-600">
                        {new Date(tx.transactionDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}
                      </span>
                    </Td>
                    <Td>
                      <div className="font-medium text-sm text-gray-900">{tx.merchant}</div>
                      {tx.merchantCategory && <div className="text-[10px] text-gray-400">{tx.merchantCategory}</div>}
                    </Td>
                    <Td>
                      {tx.card ? (
                        <div>
                          <div className="text-xs font-medium text-gray-700">···· {tx.card.lastFour}</div>
                          <div className="text-[10px] text-gray-400">{tx.card.user.firstName} {tx.card.user.lastName[0]}.</div>
                        </div>
                      ) : <span className="text-xs text-gray-400">Bank</span>}
                    </Td>
                    <Td>
                      {tx.categoryId
                        ? <Badge variant="blue" size="sm">{tx.categoryId}</Badge>
                        : <span className="text-xs text-gray-400">—</span>}
                    </Td>
                    <Td>
                      {tx.vatCode
                        ? <span className="text-xs text-gray-700">{tx.vatCode.rate}%</span>
                        : <span className="text-xs text-gray-400">—</span>}
                    </Td>
                    <Td>
                      {tx.receipt
                        ? <Badge variant="green" size="sm">Attached</Badge>
                        : tx.amount < 0 ? <Badge variant="amber" size="sm">Missing</Badge> : <span className="text-xs text-gray-400">—</span>}
                    </Td>
                    <Td>
                      {tx.expense
                        ? <Badge variant="purple" size="sm">{tx.expense.status}</Badge>
                        : <span className="text-xs text-gray-400">—</span>}
                    </Td>
                    <Td className="text-right">
                      <span className={`text-sm font-semibold tabular-nums ${tx.amount > 0 ? 'text-green-700' : 'text-gray-900'}`}>
                        {tx.amount > 0 ? '+' : '−'}€{Math.abs(tx.amount).toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                      </span>
                    </Td>
                    <Td>{statusBadge(tx.status)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {total > 30 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">Showing {(page - 1) * 30 + 1}–{Math.min(page * 30, total)} of {total}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
                <Button variant="secondary" size="sm" disabled={page * 30 >= total} onClick={() => setPage((p) => p + 1)}>Next →</Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Bulk categorize modal */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={`Categorize ${selected.size} transactions`}
        description="Apply category and VAT code to all selected transactions at once"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={bulkUpdate} disabled={!bulkCategory && !bulkVat}>
              Apply to {selected.size} transactions
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Category"
            value={bulkCategory}
            onChange={(e) => setBulkCategory(e.target.value)}
            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            placeholder="Select category..."
          />
          <Select
            label="VAT code"
            value={bulkVat}
            onChange={(e) => setBulkVat(e.target.value)}
            options={VAT_OPTIONS}
            placeholder="Select VAT code..."
          />
          <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-700">
            <strong>DATEV note:</strong> Assigning the correct VAT code is required for DATEV export. For EU cross-border purchases, use EUV. For domestic 0% purchases, use Steuerfrei.
          </div>
        </div>
      </Modal>
    </>
  )
}

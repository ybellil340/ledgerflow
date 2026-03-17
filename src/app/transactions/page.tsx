'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { Spinner, EmptyState, Badge, Amount } from '@/components/ui'

interface Transaction {
  id: string
  transactionDate: string
  description: string
  amount: number
  currency: string
  status: string
  merchant?: string
  category?: string
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    fetch('/api/transactions')
      .then(r => r.json())
      .then(d => {
        const items = d?.data ?? []
        setTransactions(items)
        setTotal(items.length)
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  const totalInflow = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalOutflow = Math.abs(transactions.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0))

  return (
    <AppShell title="Transactions" subtitle={`${total} transactions · bank & card feed`}>
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total transactions', value: total, color: '' },
          { label: 'Inflow', value: `+€${totalInflow.toLocaleString('de-DE')}`, color: 'text-green-700' },
          { label: 'Outflow', value: `−€${totalOutflow.toLocaleString('de-DE')}`, color: 'text-gray-900' },
          { label: 'Uncategorized', value: transactions.filter(t => t.status === 'UNCATEGORIZED').length, color: 'text-amber-600' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">{kpi.label}</div>
            <div className={`text-xl font-semibold ${kpi.color || 'text-gray-900'}`}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !transactions.length ? (
        <EmptyState
          title="No transactions yet"
          description="Connect a bank account via Open Banking to import transactions automatically."
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Date', 'Description', 'Category', 'Amount', 'Status'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => (
                <tr key={tx.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-gray-500 text-xs">{tx.transactionDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3 font-medium">{tx.description || tx.merchant}</td>
                  <td className="px-4 py-3 text-gray-400">{tx.category || '—'}</td>
                  <td className={`px-4 py-3 font-medium ${tx.amount >= 0 ? 'text-green-700' : ''}`}>
                    {tx.amount >= 0 ? '+' : ''}€{Math.abs(tx.amount).toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={tx.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  )
}

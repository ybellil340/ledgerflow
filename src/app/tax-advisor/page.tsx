'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { taxAdvisorApi } from '@/lib/api/endpoints'
import { useToast } from '@/components/providers/error-system'
import {
  Button, Badge, Modal, Input, Textarea, Card,
  Spinner, EmptyState, Amount,
} from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientCompany {
  id: string
  name: string
  city: string
  legalForm: string
  industry: string
  plan: string
  isTrialing: boolean
  healthScore: number
  issues: { type: string; count: number; label: string; severity: 'low' | 'medium' | 'high' }[]
  lastExportDate?: string
  pendingReview: number
  openComments: number
  isLocked: boolean
}

interface ReviewItem {
  id: string
  type: 'expense' | 'ap_invoice' | 'ar_invoice'
  description: string
  amount: number
  date: string
  status: string
  vatCode?: string
  notes?: string
}

interface Comment {
  id: string
  author: string
  authorRole: string
  text: string
  createdAt: string
  isRead: boolean
}

// ─── Health ring ───────────────────────────────────────────────────────────────

function HealthRing({ score }: { score: number }) {
  const r = 18
  const circ = 2 * Math.PI * r
  const prog = (score / 100) * circ
  const color = score >= 80 ? '#3B6D11' : score >= 60 ? '#BA7517' : '#A32D2D'

  return (
    <div className="relative w-12 h-12 flex items-center justify-center flex-shrink-0">
      <svg
        width="48" height="48" viewBox="0 0 48 48"
        className="absolute inset-0"
        style={{ transform: 'rotate(-90deg)' }}
      >
        <circle cx="24" cy="24" r={r} fill="none" stroke="#f0f0ee" strokeWidth="4" />
        <circle
          cx="24" cy="24" r={r} fill="none"
          stroke={color} strokeWidth="4"
          strokeDasharray={`${prog} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="text-xs font-semibold" style={{ color }}>{score}</span>
    </div>
  )
}

// ─── Review drawer ─────────────────────────────────────────────────────────────

function ReviewDrawer({
  client,
  onClose,
}: {
  client: ClientCompany
  onClose(): void
}) {
  const { toast } = useToast()
  const [newComment, setNewComment] = useState('')
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())

  const { data: items, isLoading: itemsLoading } = useQuery<ReviewItem[]>(
    `tax-advisor/review/${client.id}`,
    () => taxAdvisorApi.getReviewQueue(client.id)
  )

  const { data: comments, isLoading: commentsLoading, refetch: refetchComments } = useQuery<Comment[]>(
    `tax-advisor/comments/${client.id}`,
    () => taxAdvisorApi.getComments(client.id)
  )

  const commentMutation = useMutation()

  async function sendComment() {
    if (!newComment.trim()) return
    try {
      await commentMutation.mutate(() =>
        taxAdvisorApi.addComment(client.id, { text: newComment })
      )
      setNewComment('')
      refetchComments()
      toast({ type: 'success', message: 'Comment sent to company' })
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  async function lockPeriod() {
    try {
      await taxAdvisorApi.lockPeriod(client.id, { period: 'Q1-2025' })
      toast({ type: 'success', message: 'Q1 2025 locked — no further changes allowed' })
      invalidateQuery(`tax-advisor/review/${client.id}`)
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 w-[520px] bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200">
      {/* Header */}
      <div className="p-4 border-b flex items-start justify-between">
        <div>
          <div className="font-semibold text-base">{client.name}</div>
          <div className="text-xs text-gray-400">{client.city} - {client.legalForm} - {client.industry}</div>
        </div>
        <div className="flex items-center gap-2">
          <HealthRing score={client.healthScore} />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg ml-2">✕</button>
        </div>
      </div>

      {/* Issues */}
      {client.issues.length > 0 && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex gap-2 flex-wrap">
          {client.issues.map((issue, i) => (
            <span key={i} className={`pill ${
              issue.severity === 'high' ? 'p-re' : issue.severity === 'medium' ? 'p-am' : 'p-gy'
            } text-[10px]`}>
              {issue.label} ({issue.count})
            </span>
          ))}
        </div>
      )}

      {/* Review queue */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold">Review queue</span>
          <Button variant="ghost" size="xs" onClick={lockPeriod}>🔒 Lock Q1 2025</Button>
        </div>

        {itemsLoading ? <Spinner /> : !items?.length ? (
          <div className="text-xs text-gray-300 text-center py-6">Queue is clear ✓</div>
        ) : (
          <div className="space-y-1.5 mb-6">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2.5 border border-gray-100 rounded-lg hover:border-gray-200 cursor-pointer"
                onClick={() => setSelectedItems((s) => {
                  const next = new Set(s)
                  next.has(item.id) ? next.delete(item.id) : next.add(item.id)
                  return next
                })}
              >
                <input
                  type="checkbox"
                  checked={selectedItems.has(item.id)}
                  onChange={() => {}}
                  className="rounded"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{item.description}</div>
                  <div className="text-xs text-gray-400">{item.date} - {item.type.replace('_', ' ')}</div>
                </div>
                <div className="text-sm font-medium flex-shrink-0"><Amount value={item.amount} /></div>
                {item.vatCode && (
                  <span className="pill p-pu text-[9px]">{item.vatCode}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Comments thread */}
        <div className="mt-2">
          <div className="text-sm font-semibold mb-3">Comments</div>
          {commentsLoading ? <Spinner /> : !comments?.length ? (
            <div className="text-xs text-gray-300 text-center py-4">No comments yet</div>
          ) : (
            <div className="space-y-3 mb-4">
              {comments.map((c) => (
                <div key={c.id} className={`p-3 rounded-lg text-sm ${c.isRead ? 'bg-gray-50' : 'bg-blue-50 border border-blue-100'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-xs">{c.author}</span>
                    <span className="text-[10px] text-gray-400">{c.authorRole}</span>
                    <span className="text-[10px] text-gray-300 ml-auto">{new Date(c.createdAt).toLocaleDateString('de-DE')}</span>
                  </div>
                  <p className="text-gray-600 text-xs leading-relaxed">{c.text}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 mt-3">
            <Textarea
              value={newComment}
              onChange={setNewComment}
              placeholder="Add a comment or request a document from the company..."
              rows={3}
              className="flex-1"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={sendComment}
            loading={commentMutation.isLoading}
            className="mt-2 w-full justify-center"
          >
            Send comment
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function TaxAdvisorPage() {
  const [selectedClient, setSelectedClient] = useState<ClientCompany | null>(null)

  const { data: portfolio, isLoading } = useQuery<{
    clients: ClientCompany[]
    totalMissingDocs: number
    vatAnomalies: number
    criticalClients: number
  }>(
    'tax-advisor/portfolio',
    () => taxAdvisorApi.getPortfolio()
  )

  const clients = portfolio?.clients ?? []

  return (
    <AppShell
      title="Tax Advisor Portal"
      subtitle="Client portfolio - Dr. Klaus Weber, Weber & Partner"
    >
      {/* KPIs */}
      <div className="krow k4 mb-4">
        <Card kpi label="Client companies" value={clients.length} />
        <Card kpi label="Critical health score" value={portfolio?.criticalClients ?? 0} valueColor="red" />
        <Card kpi label="Missing documents" value={portfolio?.totalMissingDocs ?? 0} valueColor="amber" />
        <Card kpi label="VAT anomalies" value={portfolio?.vatAnomalies ?? 0} valueColor="red" />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !clients.length ? (
        <EmptyState
          title="No clients yet"
          description="Your tax advisor account has no associated company clients."
        />
      ) : (
        <div className="space-y-2">
          {clients.map((client) => (
            <div
              key={client.id}
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-4 cursor-pointer hover:border-gray-300 transition-colors"
              onClick={() => setSelectedClient(client)}
            >
              <HealthRing score={client.healthScore} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{client.name}</span>
                  {client.isTrialing && <Badge label="Trial" variant="amber" size="sm" />}
                  {client.isLocked && <Badge label="🔒 Locked" variant="purple" size="sm" />}
                </div>
                <div className="text-xs text-gray-400 mb-1.5">
                  {client.city} - {client.legalForm} - {client.industry}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {client.issues.map((issue, i) => (
                    <span
                      key={i}
                      className={`pill text-[9px] ${
                        issue.severity === 'high' ? 'p-re' : issue.severity === 'medium' ? 'p-am' : 'p-gy'
                      }`}
                    >
                      {issue.label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex-shrink-0 text-right">
                <div className="text-xs text-gray-400 mb-2">
                  Last export: {client.lastExportDate ?? 'Never'}
                </div>
                <div className="flex gap-1.5 justify-end">
                  <Button
                    variant="success"
                    size="xs"
                    onClick={(e) => { e.stopPropagation(); setSelectedClient(client) }}
                  >
                    Review
                    {client.pendingReview > 0 && (
                      <span className="ml-1 bg-white/30 px-1 rounded-full text-[9px]">{client.pendingReview}</span>
                    )}
                  </Button>
                  <Button variant="ghost" size="xs">DATEV Export</Button>
                  {client.healthScore < 60 && (
                    <Button variant="warning" size="xs">⚠ Alert</Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review drawer */}
      {selectedClient && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setSelectedClient(null)}
          />
          <ReviewDrawer
            client={selectedClient}
            onClose={() => setSelectedClient(null)}
          />
        </>
      )}
    </AppShell>
  )
}

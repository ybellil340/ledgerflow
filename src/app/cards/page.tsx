'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { cardsApi } from '@/lib/api/endpoints'
import { useAuth } from '@/lib/store/auth'
import { useToast } from '@/components/providers/error-system'
import {
  Button, Badge, Modal, Input, Select, Card,
  Spinner, EmptyState, Amount, Table,
} from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CorporateCard {
  id: string
  last4: string
  holderName: string
  purpose: string
  type: 'VIRTUAL' | 'PHYSICAL'
  status: 'ACTIVE' | 'FROZEN' | 'CANCELLED' | 'PENDING'
  spentThisMonth: number
  monthlyLimit: number
  user: { id: string; name: string; email: string; department?: string }
  createdAt: string
  expiresAt: string
}

interface CardRequest {
  id: string
  requestedBy: { name: string; department?: string }
  cardType: 'VIRTUAL' | 'PHYSICAL'
  purpose: string
  requestedLimit: number
  restrictions?: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const CARD_COLORS: Record<string, string> = {
  ACTIVE: '#1a1a2e',
  FROZEN: '#4B5563',
  CANCELLED: '#9CA3AF',
  PENDING: '#534AB7',
}

function CardVisual({ card, onFreeze, onUnfreeze }: {
  card: CorporateCard
  onFreeze: (id: string) => void
  onUnfreeze: (id: string) => void
}) {
  const pct = Math.min(100, Math.round((card.spentThisMonth / card.monthlyLimit) * 100))
  const bg = CARD_COLORS[card.status] ?? '#1a1a2e'
  const overLimit = pct > 85

  return (
    <div className="card-wrap">
      <div
        className="card-face relative overflow-hidden rounded-xl p-4 h-36 flex flex-col justify-between"
        style={{ background: bg }}
      >
        {card.status === 'FROZEN' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl">
            <span className="text-white font-semibold text-sm">❄ Frozen</span>
          </div>
        )}
        <div className="w-8 h-5 rounded bg-yellow-400/80" />
        <div>
          <div className="text-white/50 text-xs font-mono mb-0.5">
            •••• •••• •••• {card.last4}
          </div>
          <div className="text-white text-sm font-medium">{card.holderName}</div>
          <div className="text-white/40 text-xs">{card.purpose}</div>
        </div>
      </div>

      <div className="card-body border border-t-0 rounded-b-xl px-3 py-2.5 bg-white">
        <div className="flex justify-between items-center mb-1.5">
          <Badge
            status={card.status as any}
            size="sm"
          />
          <span className="text-[10px] text-gray-400">
            {card.type} · Monthly limit
          </span>
        </div>

        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              background: overLimit ? '#E24B4A' : bg,
            }}
          />
        </div>
        <div className="flex justify-between text-[10.5px] mb-2">
          <span className="text-gray-400">
            Spent <strong className="text-gray-700">
              <Amount value={card.spentThisMonth} />
            </strong>
          </span>
          <span className="text-gray-400">/ <Amount value={card.monthlyLimit} /></span>
        </div>

        {card.status === 'ACTIVE' ? (
          <button
            onClick={() => onFreeze(card.id)}
            className="w-full text-center text-xs py-1.5 rounded-md bg-gray-50 hover:bg-gray-100 text-gray-500 border border-gray-200 transition-colors"
          >
            🔒 Freeze card
          </button>
        ) : card.status === 'FROZEN' ? (
          <button
            onClick={() => onUnfreeze(card.id)}
            className="w-full text-center text-xs py-1.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors"
          >
            ❄ Unfreeze card
          </button>
        ) : null}
      </div>
    </div>
  )
}

// ─── Request card modal ────────────────────────────────────────────────────────

function RequestCardModal({ onClose, onSuccess }: { onClose(): void; onSuccess(): void }) {
  const [form, setForm] = useState({
    cardType: 'VIRTUAL' as 'VIRTUAL' | 'PHYSICAL',
    purpose: '',
    monthlyLimit: '',
    restrictions: '',
  })
  const { toast } = useToast()
  const mutation = useMutation<CorporateCard>()

  async function submit() {
    if (!form.purpose || !form.monthlyLimit) {
      toast({ type: 'error', message: 'Purpose and limit are required' })
      return
    }
    try {
      await mutation.mutate(() =>
        cardsApi.create({
          cardType: form.cardType,
          purpose: form.purpose,
          monthlyLimit: parseFloat(form.monthlyLimit),
          restrictions: form.restrictions || undefined,
        })
      )
      toast({ type: 'success', message: 'Card request submitted for approval' })
      invalidateQuery('cards')
      onSuccess()
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <Modal title="Request corporate card" subtitle="Virtual cards are issued instantly. Physical cards arrive in 5–7 days." onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="f-label">Card type</label>
          <Select
            value={form.cardType}
            onChange={(v) => setForm((f) => ({ ...f, cardType: v as any }))}
            options={[
              { value: 'VIRTUAL', label: 'Virtual — instant, online purchases' },
              { value: 'PHYSICAL', label: 'Physical — arrives in 5–7 business days' },
            ]}
          />
        </div>
        <div>
          <label className="f-label">Purpose / use case *</label>
          <Input
            value={form.purpose}
            onChange={(v) => setForm((f) => ({ ...f, purpose: v }))}
            placeholder="e.g. Travel, Software subscriptions, Client entertainment"
          />
        </div>
        <div>
          <label className="f-label">Monthly spending limit (€) *</label>
          <Input
            type="number"
            value={form.monthlyLimit}
            onChange={(v) => setForm((f) => ({ ...f, monthlyLimit: v }))}
            placeholder="5000"
          />
        </div>
        <div>
          <label className="f-label">Merchant restrictions (optional)</label>
          <Input
            value={form.restrictions}
            onChange={(v) => setForm((f) => ({ ...f, restrictions: v }))}
            placeholder="e.g. Travel only, No cash withdrawals"
          />
        </div>
      </div>
      <div className="flex gap-2 mt-5 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={mutation.isLoading}>
          Submit request
        </Button>
      </div>
    </Modal>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function CardsPage() {
  const { can } = useAuth()
  const { toast } = useToast()
  const [showRequestModal, setShowRequestModal] = useState(false)

  const { data: cards, isLoading, refetch } = useQuery<CorporateCard[]>(
    'cards',
    () => cardsApi.list({ status: 'all' })
  )

  const { data: requestsData } = useQuery<{ requests: CardRequest[]; total: number }>(
    'cards/requests',
    () => cardsApi.listRequests()
  )

  const freezeMutation = useMutation()
  const unfreezeMutation = useMutation()

  const handleFreeze = useCallback(async (cardId: string) => {
    try {
      // Optimistic update
      await freezeMutation.mutate(() => cardsApi.freeze(cardId))
      toast({ type: 'success', message: 'Card frozen' })
      invalidateQuery('cards')
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }, [freezeMutation, toast])

  const handleUnfreeze = useCallback(async (cardId: string) => {
    try {
      await unfreezeMutation.mutate(() => cardsApi.unfreeze(cardId))
      toast({ type: 'success', message: 'Card unfrozen — now active' })
      invalidateQuery('cards')
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }, [unfreezeMutation, toast])

  const handleApproveRequest = useCallback(async (requestId: string) => {
    try {
      await cardsApi.approveRequest(requestId)
      toast({ type: 'success', message: 'Card request approved — card issued' })
      invalidateQuery('cards')
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }, [toast])

  const handleRejectRequest = useCallback(async (requestId: string) => {
    try {
      await cardsApi.rejectRequest(requestId, 'Rejected by approver')
      toast({ type: 'info', message: 'Card request rejected' })
      invalidateQuery('cards')
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }, [toast])

  const activeCards = cards?.filter((c) => c.status === 'ACTIVE') ?? []
  const frozenCards = cards?.filter((c) => c.status === 'FROZEN') ?? []
  const totalSpent = activeCards.reduce((s, c) => s + c.spentThisMonth, 0)
  const requests = requestsData?.requests ?? []

  return (
    <AppShell
      title="Corporate Cards"
      subtitle={
        cards
          ? `${activeCards.length} active · ${frozenCards.length} frozen · ${requests.length} pending`
          : 'Loading...'
      }
      action={
        <Button variant="primary" onClick={() => setShowRequestModal(true)}>
          + Request card
        </Button>
      }
    >
      {/* KPI strip */}
      <div className="krow k4 mb-4">
        <Card kpi label="Active cards" value={activeCards.length} />
        <Card kpi label="Monthly spend" value={<Amount value={totalSpent} />} />
        <Card kpi label="Frozen" value={frozenCards.length} valueColor="blue" />
        <Card kpi label="Requests pending" value={requests.filter(r => r.status === 'PENDING').length} valueColor="amber" />
      </div>

      {/* Card grid */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !cards?.length ? (
        <EmptyState
          title="No cards yet"
          description="Request a corporate card for yourself or a team member."
          action={<Button variant="primary" onClick={() => setShowRequestModal(true)}>+ Request card</Button>}
        />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {cards.map((card) => (
            <CardVisual
              key={card.id}
              card={card}
              onFreeze={handleFreeze}
              onUnfreeze={handleUnfreeze}
            />
          ))}
        </div>
      )}

      {/* Pending requests */}
      {requests.length > 0 && (
        <Card className="p-0">
          <div className="panel-hdr px-4 py-3 border-b border-gray-100">
            <span className="panel-title">Pending card requests</span>
            <Badge label={String(requests.filter(r => r.status === 'PENDING').length)} variant="amber" />
          </div>
          <Table
            columns={['Employee', 'Type', 'Purpose', 'Limit requested', 'Restrictions', 'Actions']}
            rows={requests.filter(r => r.status === 'PENDING').map((req) => [
              <div key="emp">
                <div className="text-sm font-medium">{req.requestedBy.name}</div>
                <div className="text-xs text-gray-400">{req.requestedBy.department}</div>
              </div>,
              <Badge key="type" label={req.cardType} variant={req.cardType === 'VIRTUAL' ? 'blue' : 'gray'} />,
              req.purpose,
              <Amount key="limit" value={req.requestedLimit} suffix="/mo" />,
              req.restrictions ? <Badge key="restr" label={req.restrictions} variant="purple" /> : '—',
              can('cards:approve') ? (
                <div key="actions" className="flex gap-1.5">
                  <button className="apb apb-y text-xs" onClick={() => handleApproveRequest(req.id)}>Approve</button>
                  <button className="apb apb-n text-xs" onClick={() => handleRejectRequest(req.id)}>Reject</button>
                </div>
              ) : null,
            ])}
          />
        </Card>
      )}

      {showRequestModal && (
        <RequestCardModal
          onClose={() => setShowRequestModal(false)}
          onSuccess={() => setShowRequestModal(false)}
        />
      )}
    </AppShell>
  )
}

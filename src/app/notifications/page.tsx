'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { notificationsApi } from '@/lib/api/endpoints'
import { useToast } from '@/components/providers/error-system'
import { Button, Badge, Card, Spinner, EmptyState } from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Notification {
  id: string
  type: 'EXPENSE' | 'INVOICE' | 'CARD' | 'APPROVAL' | 'TAX' | 'SYSTEM' | 'TAX_ADVISOR'
  title: string
  message: string
  isRead: boolean
  createdAt: string
  relatedEntityType?: string
  relatedEntityId?: string
}

// ─── Type icons ────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  EXPENSE: '🧾',
  INVOICE: '⏰',
  CARD: '💳',
  APPROVAL: '⏳',
  TAX: '📅',
  TAX_ADVISOR: '💬',
  SYSTEM: '📊',
}

const TYPE_LABELS: Record<string, string> = {
  EXPENSE: 'Expenses',
  INVOICE: 'Invoices',
  CARD: 'Cards',
  APPROVAL: 'Approvals',
  TAX: 'Tax',
  TAX_ADVISOR: 'Tax advisor',
  SYSTEM: 'System',
}

// ─── Notification row ──────────────────────────────────────────────────────────

function NotifRow({
  notif,
  onMarkRead,
}: {
  notif: Notification
  onMarkRead(id: string): void
}) {
  return (
    <div
      className={`notif-row flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50/50 transition-colors ${notif.isRead ? '' : 'bg-blue-50/30'}`}
      onClick={() => !notif.isRead && onMarkRead(notif.id)}
    >
      <div
        className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0 transition-colors"
        style={{ background: notif.isRead ? 'transparent' : 'var(--blue)' }}
      />
      <div className="text-lg flex-shrink-0 mt-0.5">{TYPE_ICONS[notif.type] ?? '🔔'}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <span className={`text-sm flex-1 ${notif.isRead ? 'font-normal text-gray-700' : 'font-medium text-gray-900'}`}>
            {notif.title}
          </span>
          <span className="text-[10.5px] text-gray-300 flex-shrink-0">{formatRelativeTime(notif.createdAt)}</span>
        </div>
        <div className="text-xs text-gray-400 leading-relaxed mt-0.5 line-clamp-2">{notif.message}</div>
        <div className="mt-1.5">
          <Badge label={TYPE_LABELS[notif.type] ?? notif.type} variant="gray" size="sm" />
        </div>
      </div>
    </div>
  )
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(isoDate).toLocaleDateString('de-DE')
}

function groupByDay(notifs: Notification[]): Record<string, Notification[]> {
  return notifs.reduce((acc: Record<string, Notification[]>, n) => {
    const d = new Date(n.createdAt)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    let key: string
    if (d.toDateString() === today.toDateString()) {
      key = 'Today'
    } else if (d.toDateString() === yesterday.toDateString()) {
      key = 'Yesterday'
    } else {
      key = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
    }
    ;(acc[key] = acc[key] || []).push(n)
    return acc
  }, {})
}

// ─── Main page ─────────────────────────────────────────────────────────────────

const TYPE_FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Approvals', value: 'APPROVAL' },
  { label: 'Invoices', value: 'INVOICE' },
  { label: 'Tax advisor', value: 'TAX_ADVISOR' },
  { label: 'Cards', value: 'CARD' },
  { label: 'Tax', value: 'TAX' },
]

export default function NotificationsPage() {
  const { toast } = useToast()
  const [typeFilter, setTypeFilter] = useState('all')

  const { data: notifData, isLoading, refetch } = useQuery<{
    notifications: Notification[]
    unread: number
    total: number
  }>(
    'notifications',
    () => notificationsApi.list({ limit: 50 })
  )

  const markReadMutation = useMutation()
  const markAllMutation = useMutation()

  const handleMarkRead = useCallback(async (id: string) => {
    try {
      await markReadMutation.mutate(() => notificationsApi.markRead(id))
      invalidateQuery('notifications')
    } catch (e: any) {
      // silently fail — not critical
    }
  }, [markReadMutation])

  const handleMarkAllRead = useCallback(async () => {
    try {
      await markAllMutation.mutate(() => notificationsApi.markAllRead())
      toast({ type: 'success', message: 'All notifications marked as read' })
      invalidateQuery('notifications')
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }, [markAllMutation, toast])

  const allNotifs = notifData?.notifications ?? []
  const filtered = typeFilter === 'all' ? allNotifs : allNotifs.filter((n) => n.type === typeFilter)
  const grouped = groupByDay(filtered)
  const unreadCount = notifData?.unread ?? 0

  return (
    <AppShell
      title="Notifications"
      subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="flex gap-1 flex-wrap">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`fchip${typeFilter === f.value ? ' on' : ''}`}
              onClick={() => setTypeFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAllRead}
              loading={markAllMutation.isLoading}
            >
              Mark all read
            </Button>
          )}
          <Button variant="ghost" size="sm">Clear old</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !filtered.length ? (
        <EmptyState
          title={typeFilter === 'all' ? 'No notifications' : `No ${TYPE_LABELS[typeFilter] ?? typeFilter} notifications`}
          description="You're all caught up."
        />
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([day, dayNotifs]) => {
            const unread = dayNotifs.filter((n) => !n.isRead)
            return (
              <div key={day}>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
                  {day}
                  {unread.length > 0 && (
                    <span className="ml-2 text-blue-600 normal-case">{unread.length} unread</span>
                  )}
                </div>
                <Card className="p-0 overflow-hidden">
                  {dayNotifs.map((n) => (
                    <NotifRow key={n.id} notif={n} onMarkRead={handleMarkRead} />
                  ))}
                </Card>
              </div>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}

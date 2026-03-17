'use client'

/**
 * LedgerFlow Real-time Client Hooks
 *
 * useSSE()           — subscribe to all SSE events, full EventSource lifecycle
 * useSSEEvent()      — subscribe to specific event types
 * useLiveNotifications() — wraps notifications + live unread count badge
 * useLiveDashboard() — patches KPI cards in real time without full refetch
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { invalidateQuery } from '@/lib/hooks'
import type { SSEEvent, SSEEventType } from './sse'

// ─────────────────────────────────────────────
// CORE useSSE HOOK
// ─────────────────────────────────────────────

interface UseSSEOptions {
  enabled?: boolean
  onEvent?: (event: SSEEvent) => void
  onConnect?: () => void
  onDisconnect?: () => void
  /** Max reconnect delay in ms. Default 30_000 */
  maxReconnectDelay?: number
}

export function useSSE(options: UseSSEOptions = {}) {
  const {
    enabled = true,
    maxReconnectDelay = 30_000,
    onEvent,
    onConnect,
    onDisconnect,
  } = options

  const [isConnected, setIsConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null)

  const esRef = useRef<EventSource | null>(null)
  const lastEventIdRef = useRef('')
  const reconnectDelay = useRef(1000)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const onEventRef = useRef(onEvent)
  const onConnectRef = useRef(onConnect)
  const onDisconnectRef = useRef(onDisconnect)
  onEventRef.current = onEvent
  onConnectRef.current = onConnect
  onDisconnectRef.current = onDisconnect

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close()

    const url = lastEventIdRef.current
      ? `/api/realtime?lastEventId=${encodeURIComponent(lastEventIdRef.current)}`
      : '/api/realtime'

    const es = new EventSource(url, { withCredentials: true })
    esRef.current = es

    es.addEventListener('connected', () => {
      setIsConnected(true)
      reconnectDelay.current = 1000
      onConnectRef.current?.()
    })

    es.onerror = () => {
      setIsConnected(false)
      es.close()
      onDisconnectRef.current?.()

      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, maxReconnectDelay)
        connect()
      }, reconnectDelay.current)
    }

    const handleMessage = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent
        if (event.eventId) lastEventIdRef.current = event.eventId
        setLastEvent(event)
        onEventRef.current?.(event)
      } catch {}
    }

    // Catch generic messages AND typed event messages
    es.onmessage = handleMessage

    const typedEvents: SSEEventType[] = [
      'expense.submitted', 'expense.approved', 'expense.rejected', 'expense.flagged',
      'expense.receipt_matched', 'invoice.ap.created', 'invoice.ap.approved',
      'invoice.ap.overdue', 'invoice.ar.paid', 'invoice.ar.overdue',
      'card.frozen', 'card.limit_approaching',
      'notification.new', 'notification.count_updated',
      'dashboard.kpi_updated', 'cashflow.updated',
      'org.member_joined', 'org.member_left',
    ]

    typedEvents.forEach((type) => {
      es.addEventListener(type, handleMessage as EventListener)
    })
  }, [maxReconnectDelay])

  useEffect(() => {
    if (!enabled) return
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      esRef.current?.close()
      esRef.current = null
      setIsConnected(false)
    }
  }, [enabled, connect])

  return { isConnected, lastEvent }
}

// ─────────────────────────────────────────────
// useSSEEvent — subscribe to one or more event types
// ─────────────────────────────────────────────

export function useSSEEvent<T = unknown>(
  type: SSEEventType | SSEEventType[],
  handler: (payload: T, event: SSEEvent<T>) => void,
  enabled = true
) {
  const types = Array.isArray(type) ? type : [type]
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useSSE({
    enabled,
    onEvent(event) {
      if (types.includes(event.type)) {
        handlerRef.current(event.payload as T, event as SSEEvent<T>)
      }
    },
  })
}

// ─────────────────────────────────────────────
// useLiveNotifications
// ─────────────────────────────────────────────

/**
 * Subscribes to notification.new and notification.count_updated events.
 * Triggers toast on new notification and keeps unread count in sync.
 */
export function useLiveNotifications(
  onNewNotification?: (n: { id: string; title: string; type: string }) => void
) {
  const [unreadCount, setUnreadCount] = useState(0)

  const { isConnected } = useSSE({
    onEvent(event) {
      if (event.type === 'notification.new') {
        const n = event.payload as { id: string; title: string; type: string }
        setUnreadCount((c) => c + 1)
        onNewNotification?.(n)
        invalidateQuery('notifications')
      }

      if (event.type === 'notification.count_updated') {
        const { delta, total } = event.payload as { delta?: number; total?: number }
        if (total !== undefined) {
          setUnreadCount(total)
        } else if (delta !== undefined) {
          setUnreadCount((c) => Math.max(0, c + delta))
        }
      }

      if (event.type === 'expense.approved' || event.type === 'expense.rejected') {
        // New notification was generated server-side — refresh notification list
        invalidateQuery('notifications')
        invalidateQuery('notification-count')
      }
    },
  })

  return { unreadCount, setUnreadCount, isConnected }
}

// ─────────────────────────────────────────────
// useLiveDashboard
// ─────────────────────────────────────────────

/**
 * Patches dashboard KPI state on server push without a full refetch.
 * Works alongside useQuery('dashboard') — call both, merge state.
 */
export function useLiveDashboard() {
  const [kpiDeltas, setKpiDeltas] = useState<Record<string, number>>({})

  useSSEEvent<Record<string, number>>('dashboard.kpi_updated', (deltas) => {
    setKpiDeltas((prev) => {
      const next = { ...prev }
      for (const [key, delta] of Object.entries(deltas)) {
        next[key] = (next[key] ?? 0) + delta
      }
      return next
    })
    // Also trigger full cache invalidation after 5s so next focus gets fresh data
    setTimeout(() => invalidateQuery('dashboard'), 5000)
  })

  useSSEEvent('expense.approved', () => {
    setKpiDeltas((prev) => ({
      ...prev,
      pendingApprovals: (prev.pendingApprovals ?? 0) - 1,
    }))
  })

  useSSEEvent('expense.submitted', () => {
    setKpiDeltas((prev) => ({
      ...prev,
      pendingApprovals: (prev.pendingApprovals ?? 0) + 1,
    }))
  })

  useSSEEvent('invoice.ap.overdue', () => {
    invalidateQuery('ap-invoices')
    invalidateQuery('cashflow')
  })

  useSSEEvent('invoice.ar.paid', () => {
    invalidateQuery('ar-invoices')
    invalidateQuery('cashflow')
    invalidateQuery('dashboard')
  })

  return { kpiDeltas }
}

// ─────────────────────────────────────────────
// useLiveApprovals — for managers watching approval queue
// ─────────────────────────────────────────────

export function useLiveApprovals(onNew?: (expense: unknown) => void) {
  useSSEEvent('expense.submitted', (payload) => {
    invalidateQuery('expenses')
    invalidateQuery('dashboard')
    onNew?.(payload)
  })

  useSSEEvent('expense.approved', () => {
    invalidateQuery('expenses')
  })

  useSSEEvent('expense.rejected', () => {
    invalidateQuery('expenses')
  })
}

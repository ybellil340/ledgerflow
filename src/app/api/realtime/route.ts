/**
 * GET /api/realtime
 *
 * Server-Sent Events endpoint. Authenticated users connect here to receive
 * live push events for their organization.
 *
 * Features:
 * - Last-Event-ID reconnect (browser retransmits after disconnect)
 * - 30s server keepalive pings prevent proxy timeouts
 * - Connection registered in SSERegistry → broadcast targets it
 * - Cleanup on disconnect (AbortSignal / stream cancel)
 *
 * Client usage:
 *   const es = new EventSource('/api/realtime')
 *   es.addEventListener('expense.approved', (e) => { ... })
 *
 * Or use the useSSE() hook from @/lib/realtime/client
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/session'
import { createSSEStream, sseRegistry } from '@/lib/realtime/sse'
import type { SessionUser } from '@/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs' // SSE requires Node.js runtime (not Edge)

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { stream, cleanup } = createSSEStream(session.id, session.currentOrganizationId)

  // Clean up if client disconnects
  req.signal.addEventListener('abort', cleanup)

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',       // Disable Nginx buffering
      'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL ?? '*',
    },
  })
})

/**
 * GET /api/realtime/stats (super admin only)
 */
export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  if (!session.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({ data: sseRegistry.getStats() })
})

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT HOOK  (src/lib/realtime/client.ts — exported separately for client bundle)
// ─────────────────────────────────────────────────────────────────────────────
//
// Note: This file is the API route. The hook below is the companion client module.
// It's documented here for co-location clarity but lives at src/lib/realtime/client.ts

/*
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { SSEEvent, SSEEventType } from './sse'

interface UseSSEOptions {
  onEvent?: (event: SSEEvent) => void
  onConnect?: () => void
  onDisconnect?: () => void
  maxReconnectDelay?: number
}

export function useSSE(options: UseSSEOptions = {}) {
  const [isConnected, setIsConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const lastEventIdRef = useRef<string>('')
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const reconnectDelay = useRef(1000)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close()

    const url = lastEventIdRef.current
      ? `/api/realtime?lastEventId=${lastEventIdRef.current}`
      : '/api/realtime'

    const es = new EventSource(url, { withCredentials: true })
    esRef.current = es

    es.addEventListener('connected', () => {
      setIsConnected(true)
      reconnectDelay.current = 1000 // Reset backoff
      optionsRef.current.onConnect?.()
    })

    es.onerror = () => {
      setIsConnected(false)
      es.close()
      optionsRef.current.onDisconnect?.()

      // Exponential backoff reconnect
      reconnectTimerRef.current = setTimeout(() => {
        reconnectDelay.current = Math.min(
          reconnectDelay.current * 2,
          options.maxReconnectDelay ?? 30_000
        )
        connect()
      }, reconnectDelay.current)
    }

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent
        lastEventIdRef.current = event.eventId
        setLastEvent(event)
        optionsRef.current.onEvent?.(event)
      } catch {}
    }

    // Register handlers for all event types so we can use addEventListener
    const allTypes: SSEEventType[] = [
      'expense.submitted', 'expense.approved', 'expense.rejected', 'expense.flagged',
      'expense.receipt_matched', 'invoice.ap.created', 'invoice.ap.approved',
      'invoice.ap.overdue', 'invoice.ar.paid', 'invoice.ar.overdue', 'card.frozen',
      'card.limit_approaching', 'notification.new', 'notification.count_updated',
      'dashboard.kpi_updated', 'cashflow.updated', 'org.member_joined', 'org.member_left',
    ]

    allTypes.forEach((type) => {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as SSEEvent
          lastEventIdRef.current = event.eventId
          setLastEvent(event)
          optionsRef.current.onEvent?.(event)
        } catch {}
      })
    })
  }, [options.maxReconnectDelay])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimerRef.current)
      esRef.current?.close()
    }
  }, [connect])

  return { isConnected, lastEvent }
}

// Convenience hook: fire a callback only for specific event types
export function useSSEEvent<T>(
  type: SSEEventType | SSEEventType[],
  handler: (payload: T) => void
) {
  const types = Array.isArray(type) ? type : [type]
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useSSE({
    onEvent(event) {
      if (types.includes(event.type)) {
        handlerRef.current(event.payload as T)
      }
    },
  })
}
*/

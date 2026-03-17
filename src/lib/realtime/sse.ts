/**
 * LedgerFlow Real-time Engine — Server-Sent Events
 *
 * Why SSE over WebSockets:
 *   - Works natively with Next.js App Router / Edge Runtime
 *   - No extra infrastructure (no socket.io server)
 *   - Auto-reconnect built into the browser EventSource API
 *   - HTTP/2 multiplexes efficiently
 *   - Sufficient for our push-only use case (notifications, live counts, balance updates)
 *
 * Architecture:
 *   - In-process connection registry per Next.js worker (Map<orgId, Set<SSEConnection>>)
 *   - For multi-instance prod: swap registry for Redis pub/sub (see RedisAdapter below)
 *   - Event types are typed and versioned for forwards compatibility
 *
 * Usage (server):
 *   import { sseRegistry } from '@/lib/realtime/sse'
 *   sseRegistry.broadcast('org_123', { type: 'expense.approved', payload: { id: '...' } })
 *
 * Usage (client):
 *   const { events, isConnected } = useSSE()
 */

import type { NextRequest } from 'next/server'

// ─────────────────────────────────────────────
// EVENT TYPES
// ─────────────────────────────────────────────

export type SSEEventType =
  // Expenses
  | 'expense.submitted'
  | 'expense.approved'
  | 'expense.rejected'
  | 'expense.flagged'
  | 'expense.receipt_matched'
  // Invoices
  | 'invoice.ap.created'
  | 'invoice.ap.approved'
  | 'invoice.ap.overdue'
  | 'invoice.ar.paid'
  | 'invoice.ar.overdue'
  // Cards
  | 'card.frozen'
  | 'card.limit_approaching'
  // Notifications
  | 'notification.new'
  | 'notification.count_updated'
  // Dashboard
  | 'dashboard.kpi_updated'
  | 'cashflow.updated'
  // Admin
  | 'org.member_joined'
  | 'org.member_left'
  // System
  | 'ping'
  | 'reconnect'

export interface SSEEvent<T = unknown> {
  type: SSEEventType
  payload: T
  organizationId: string
  actorId?: string        // User who triggered the event
  targetUserId?: string   // Specific user to notify (undefined = broadcast to org)
  timestamp: string       // ISO 8601
  eventId: string         // For SSE Last-Event-ID reconnect
}

// ─────────────────────────────────────────────
// CONNECTION REGISTRY
// ─────────────────────────────────────────────

interface SSEConnection {
  userId: string
  organizationId: string
  controller: ReadableStreamDefaultController<Uint8Array>
  connectedAt: Date
  lastPingAt: Date
}

class SSERegistry {
  // orgId → Set of active connections for that org
  private connections = new Map<string, Set<SSEConnection>>()
  // userId → Set of connections for that user (for targeted events)
  private userConnections = new Map<string, Set<SSEConnection>>()

  private encoder = new TextEncoder()
  private eventCounter = 0

  /** Register a new SSE connection */
  register(conn: SSEConnection): () => void {
    // Add to org bucket
    if (!this.connections.has(conn.organizationId)) {
      this.connections.set(conn.organizationId, new Set())
    }
    this.connections.get(conn.organizationId)!.add(conn)

    // Add to user bucket
    if (!this.userConnections.has(conn.userId)) {
      this.userConnections.set(conn.userId, new Set())
    }
    this.userConnections.get(conn.userId)!.add(conn)

    // Return cleanup function
    return () => this.unregister(conn)
  }

  private unregister(conn: SSEConnection): void {
    this.connections.get(conn.organizationId)?.delete(conn)
    this.userConnections.get(conn.userId)?.delete(conn)

    // Clean up empty sets
    if (this.connections.get(conn.organizationId)?.size === 0) {
      this.connections.delete(conn.organizationId)
    }
    if (this.userConnections.get(conn.userId)?.size === 0) {
      this.userConnections.delete(conn.userId)
    }
  }

  /** Broadcast to all members of an organization */
  broadcast<T>(organizationId: string, event: Omit<SSEEvent<T>, 'eventId' | 'timestamp' | 'organizationId'>): void {
    const conns = this.connections.get(organizationId)
    if (!conns || conns.size === 0) return

    const fullEvent: SSEEvent<T> = {
      ...event,
      organizationId,
      timestamp: new Date().toISOString(),
      eventId: `evt_${++this.eventCounter}_${Date.now()}`,
    }

    const sseString = this.formatSSE(fullEvent)
    const dead: SSEConnection[] = []

    for (const conn of conns) {
      // Skip if targeted to specific user
      if (fullEvent.targetUserId && conn.userId !== fullEvent.targetUserId) continue

      try {
        conn.controller.enqueue(this.encoder.encode(sseString))
      } catch {
        dead.push(conn)
      }
    }

    dead.forEach((conn) => this.unregister(conn))
  }

  /** Send to a specific user (all their connections/tabs) */
  sendToUser<T>(userId: string, event: Omit<SSEEvent<T>, 'eventId' | 'timestamp' | 'targetUserId'>): void {
    const conns = this.userConnections.get(userId)
    if (!conns || conns.size === 0) return

    const fullEvent: SSEEvent<T> = {
      ...event,
      targetUserId: userId,
      timestamp: new Date().toISOString(),
      eventId: `evt_${++this.eventCounter}_${Date.now()}`,
    }

    const sseString = this.formatSSE(fullEvent)
    const dead: SSEConnection[] = []

    for (const conn of conns) {
      try {
        conn.controller.enqueue(this.encoder.encode(sseString))
      } catch {
        dead.push(conn)
      }
    }

    dead.forEach((conn) => this.unregister(conn))
  }

  /** Send keepalive ping to all connections */
  ping(): void {
    for (const [orgId, conns] of this.connections) {
      this.broadcast(orgId, {
        type: 'ping',
        payload: { time: Date.now() },
        actorId: 'system',
      })
    }
  }

  /** Get stats for health check / admin */
  getStats() {
    let totalConnections = 0
    for (const conns of this.connections.values()) {
      totalConnections += conns.size
    }
    return {
      totalOrganizations: this.connections.size,
      totalConnections,
      totalUsers: this.userConnections.size,
    }
  }

  private formatSSE(event: SSEEvent): string {
    return [
      `id: ${event.eventId}`,
      `event: ${event.type}`,
      `data: ${JSON.stringify(event)}`,
      '',
      '',
    ].join('\n')
  }
}

// Singleton registry (per worker process)
export const sseRegistry = new SSERegistry()

// ─────────────────────────────────────────────
// KEEPALIVE TIMER (30s intervals)
// ─────────────────────────────────────────────

// Start in non-edge environments
if (typeof setInterval !== 'undefined' && process.env.NODE_ENV !== 'test') {
  setInterval(() => sseRegistry.ping(), 30_000)
}

// ─────────────────────────────────────────────
// SSE STREAM FACTORY
// ─────────────────────────────────────────────

/**
 * Creates a ReadableStream for the SSE response.
 * Call from GET /api/realtime handler.
 */
export function createSSEStream(userId: string, organizationId: string): {
  stream: ReadableStream<Uint8Array>
  cleanup: () => void
} {
  let cleanup: () => void = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const conn: SSEConnection = {
        userId,
        organizationId,
        controller,
        connectedAt: new Date(),
        lastPingAt: new Date(),
      }

      cleanup = sseRegistry.register(conn)

      // Send initial connected event
      const encoder = new TextEncoder()
      const connectEvent = [
        `event: connected`,
        `data: ${JSON.stringify({ type: 'connected', userId, organizationId, timestamp: new Date().toISOString() })}`,
        '',
        '',
      ].join('\n')
      controller.enqueue(encoder.encode(connectEvent))
    },

    cancel() {
      cleanup()
    },
  })

  return { stream, cleanup }
}

// ─────────────────────────────────────────────
// REDIS ADAPTER (for multi-instance production)
// ─────────────────────────────────────────────
//
// Drop-in replacement for sseRegistry.broadcast() when running multiple
// Next.js instances behind a load balancer (Vercel, ECS, etc.)
//
// Usage: set REDIS_URL env var, then uncomment below and swap sseRegistry
// for redisSSEBroadcast in your API routes.
//
// import { createClient } from 'redis'
//
// const CHANNEL = 'ledgerflow:sse'
//
// export async function initRedisSSE() {
//   const pub = createClient({ url: process.env.REDIS_URL })
//   const sub = createClient({ url: process.env.REDIS_URL })
//   await Promise.all([pub.connect(), sub.connect()])
//
//   // Subscribe — forward messages to local in-process registry
//   await sub.subscribe(CHANNEL, (message) => {
//     const { orgId, event } = JSON.parse(message)
//     sseRegistry.broadcast(orgId, event)
//   })
//
//   return {
//     broadcast: (orgId: string, event: object) =>
//       pub.publish(CHANNEL, JSON.stringify({ orgId, event })),
//   }
// }

// ─────────────────────────────────────────────
// TYPED BROADCAST HELPERS
// (import these in API routes instead of raw registry)
// ─────────────────────────────────────────────

export const realtimeEvents = {
  expenseApproved: (organizationId: string, expense: { id: string; merchant: string; grossAmount: number; currency: string }, actorId: string, ownerId: string) => {
    sseRegistry.broadcast(organizationId, { type: 'expense.approved', payload: expense, actorId, targetUserId: ownerId })
    sseRegistry.broadcast(organizationId, { type: 'notification.count_updated', payload: { delta: 1 }, actorId: 'system' })
  },

  expenseRejected: (organizationId: string, expense: { id: string; merchant: string }, actorId: string, ownerId: string) => {
    sseRegistry.broadcast(organizationId, { type: 'expense.rejected', payload: expense, actorId, targetUserId: ownerId })
    sseRegistry.broadcast(organizationId, { type: 'notification.count_updated', payload: { delta: 1 }, actorId: 'system' })
  },

  newNotification: (organizationId: string, userId: string, notification: { id: string; title: string; type: string }) => {
    sseRegistry.sendToUser(userId, { type: 'notification.new', payload: notification, organizationId, actorId: 'system' })
    sseRegistry.sendToUser(userId, { type: 'notification.count_updated', payload: { delta: 1 }, organizationId, actorId: 'system' })
  },

  invoiceOverdue: (organizationId: string, invoice: { id: string; supplierName: string; amount: number; daysOverdue: number }) => {
    sseRegistry.broadcast(organizationId, { type: 'invoice.ap.overdue', payload: invoice, actorId: 'system' })
  },

  cardLimitApproaching: (organizationId: string, card: { id: string; holderName: string; spent: number; limit: number }, targetUserId: string) => {
    sseRegistry.sendToUser(targetUserId, { type: 'card.limit_approaching', payload: card, organizationId, actorId: 'system' })
  },

  dashboardUpdated: (organizationId: string, kpiDeltas: Record<string, number>) => {
    sseRegistry.broadcast(organizationId, { type: 'dashboard.kpi_updated', payload: kpiDeltas, actorId: 'system' })
  },
}

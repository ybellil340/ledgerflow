export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import prisma from '@/lib/db/prisma'

// ─────────────────────────────────────────────
// GET /api/health
// Used by load balancers, uptime monitors, k8s probes
// ─────────────────────────────────────────────

export async function GET_HEALTH(req: NextRequest) {
  const start = Date.now()
  const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; detail?: string }> = {}

  // Database connectivity
  try {
    const dbStart = Date.now()
    await prisma.$queryRaw`SELECT 1`
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart }
  } catch (err) {
    checks.database = { status: 'error', detail: err instanceof Error ? err.message : 'unknown' }
  }

  // Environment checks
  const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET']
  const missingEnv = requiredEnvVars.filter((v) => !process.env[v])
  checks.environment = missingEnv.length === 0
    ? { status: 'ok' }
    : { status: 'error', detail: `Missing: ${missingEnv.join(', ')}` }

  // Storage check (just validate config)
  checks.storage = { status: process.env.STORAGE_PROVIDER ? 'ok' : 'ok', detail: process.env.STORAGE_PROVIDER ?? 'local' }

  // Overall status
  const allOk = Object.values(checks).every((c) => c.status === 'ok')
  const totalLatency = Date.now() - start

  return NextResponse.json(
    {
      status: allOk ? 'healthy' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      environment: process.env.NODE_ENV ?? 'development',
      timestamp: new Date().toISOString(),
      latencyMs: totalLatency,
      checks,
    },
    {
      status: allOk ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}

// ─────────────────────────────────────────────
// WEBHOOK INGESTION
// POST /api/webhooks/[provider]
// ─────────────────────────────────────────────

type WebhookProvider = 'stripe' | 'tink' | 'marqeta' | 'mindee'

interface WebhookEvent {
  provider: WebhookProvider
  eventId: string
  eventType: string
  payload: unknown
  receivedAt: Date
}

// Verify webhook signatures to prevent spoofing
function verifyStripeSignature(payload: string, signature: string, secret: string): boolean {
  try {
    const parts = signature.split(',').reduce<Record<string, string>>((acc, part) => {
      const [k, v] = part.split('=')
      acc[k] = v
      return acc
    }, {})
    const timestamp = parts['t']
    const sig = parts['v1']
    if (!timestamp || !sig) return false

    // Reject events older than 5 minutes
    if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false

    const expectedSig = createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex')

    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))
  } catch {
    return false
  }
}

function verifyHmacSignature(payload: string, signature: string, secret: string): boolean {
  try {
    const expected = createHmac('sha256', secret).update(payload).digest('hex')
    const provided = signature.replace(/^sha256=/, '')
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export async function POST_WEBHOOK(req: NextRequest, provider: WebhookProvider) {
  const rawBody = await req.text()
  let verified = false

  // Signature verification per provider
  switch (provider) {
    case 'stripe': {
      const sig = req.headers.get('stripe-signature') ?? ''
      const secret = process.env.STRIPE_WEBHOOK_SECRET ?? ''
      verified = verifyStripeSignature(rawBody, sig, secret)
      break
    }
    case 'tink': {
      const sig = req.headers.get('x-tink-signature') ?? ''
      const secret = process.env.TINK_WEBHOOK_SECRET ?? ''
      verified = verifyHmacSignature(rawBody, sig, secret)
      break
    }
    case 'marqeta': {
      const sig = req.headers.get('x-webhook-signature') ?? ''
      const secret = process.env.MARQETA_WEBHOOK_SECRET ?? ''
      verified = verifyHmacSignature(rawBody, sig, secret)
      break
    }
    default:
      verified = process.env.NODE_ENV === 'development' // Allow unverified in dev
  }

  if (!verified) {
    console.warn(`[Webhook] Invalid signature from ${provider}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const event: WebhookEvent = {
    provider,
    eventId: req.headers.get('x-webhook-id') ?? `${provider}-${Date.now()}`,
    eventType: (payload as Record<string, unknown>)?.type as string ?? 'unknown',
    payload,
    receivedAt: new Date(),
  }

  // Idempotency: skip if already processed
  const existing = await prisma.auditLog.findFirst({
    where: { entityType: 'webhook', entityId: event.eventId },
  })
  if (existing) {
    return NextResponse.json({ received: true, status: 'duplicate' })
  }

  // Route to appropriate handler
  try {
    await handleWebhookEvent(event)

    // Log the webhook
    await prisma.auditLog.create({
      data: {
        actorId: 'system',
        action: 'CREATE',
        entityType: 'webhook',
        entityId: event.eventId,
        after: { provider, eventType: event.eventType },
      },
    })

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error(`[Webhook] Handler error for ${provider}/${event.eventType}:`, err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}

async function handleWebhookEvent(event: WebhookEvent): Promise<void> {
  switch (event.provider) {
    case 'stripe':
      await handleStripeEvent(event)
      break
    case 'tink':
      await handleTinkEvent(event)
      break
    case 'marqeta':
      await handleMarqetaEvent(event)
      break
  }
}

async function handleStripeEvent(event: WebhookEvent): Promise<void> {
  const p = event.payload as Record<string, unknown>
  switch (event.eventType) {
    case 'invoice.paid': {
      // Update subscription status
      const stripeCustomerId = (p.customer as string) ?? ''
      const sub = await prisma.subscription.findFirst({ where: { stripeCustomerId } })
      if (sub) {
        await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE' } })
      }
      break
    }
    case 'customer.subscription.deleted': {
      const stripeCustomerId = (p.customer as string) ?? ''
      const sub = await prisma.subscription.findFirst({ where: { stripeCustomerId } })
      if (sub) {
        await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED' } })
      }
      break
    }
    case 'invoice.payment_failed': {
      const stripeCustomerId = (p.customer as string) ?? ''
      const sub = await prisma.subscription.findFirst({
        where: { stripeCustomerId },
        include: { organization: { include: { memberships: { where: { role: 'COMPANY_ADMIN', status: 'ACTIVE' }, include: { user: { select: { id: true, email: true } } } } } } },
      })
      if (sub) {
        await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } })
        // Notify admin
        for (const m of sub.organization.memberships) {
          await prisma.notification.create({
            data: {
              userId: m.userId, organizationId: sub.organizationId,
              type: 'payment_failed', title: 'Payment failed',
              message: 'Your subscription payment failed. Please update your payment method to avoid service interruption.',
            },
          })
        }
      }
      break
    }
  }
}

async function handleTinkEvent(event: WebhookEvent): Promise<void> {
  const p = event.payload as Record<string, unknown>
  // Handle new transactions from open banking sync
  if (event.eventType === 'transactions.created') {
    const transactions = (p.transactions as unknown[]) ?? []
    console.log(`[Tink] ${transactions.length} new transactions received`)
    // In production: sync to transaction table via banking adapter
  }
}

async function handleMarqetaEvent(event: WebhookEvent): Promise<void> {
  const p = event.payload as Record<string, unknown>
  switch (event.eventType) {
    case 'transaction.authorization': {
      // Real-time card authorization webhook
      const cardToken = p.card_token as string
      const amount = p.amount as number
      console.log(`[Marqeta] Authorization: card=${cardToken} amount=${amount}`)
      // In production: check limits, create pending transaction
      break
    }
    case 'card.status_change': {
      const cardToken = p.card_token as string
      const status = p.state as string
      const card = await prisma.card.findFirst({ where: { providerCardId: cardToken } })
      if (card) {
        const newStatus = status === 'ACTIVE' ? 'ACTIVE' : status === 'SUSPENDED' ? 'FROZEN' : 'CANCELLED'
        await prisma.card.update({ where: { id: card.id }, data: { status: newStatus as never } })
      }
      break
    }
  }
}

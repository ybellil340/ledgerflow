export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { encryptValue, decryptValue } from '@/lib/security'

// ─── Integration catalog ───────────────────────────────────────────────────────

const INTEGRATION_CATALOG = [
  {
    key: 'datev',
    name: 'DATEV eG',
    description: 'Official DATEV Buchungsstapel export & partner API',
    category: 'accounting',
    authType: 'manual',
    docsUrl: 'https://developer.datev.de',
    isComingSoon: false,
    isBeta: false,
  },
  {
    key: 'tink',
    name: 'Tink',
    description: 'Open banking (PSD2) — import bank transactions from 3,400+ European banks',
    category: 'banking',
    authType: 'oauth2',
    docsUrl: 'https://docs.tink.com',
    isBeta: false,
  },
  {
    key: 'stripe_issuing',
    name: 'Stripe Issuing',
    description: 'Power corporate card issuance with real-time spend controls',
    category: 'payments',
    authType: 'oauth2',
    docsUrl: 'https://stripe.com/docs/issuing',
    isBeta: true,
  },
  {
    key: 'mindee',
    name: 'Mindee OCR',
    description: 'AI-powered receipt & invoice OCR — auto-extract merchant, amount, VAT',
    category: 'ocr',
    authType: 'api_key',
    docsUrl: 'https://developers.mindee.com',
    isBeta: false,
  },
  {
    key: 'google_vision',
    name: 'Google Vision',
    description: 'Alternative OCR backend for receipt data extraction',
    category: 'ocr',
    authType: 'api_key',
    docsUrl: 'https://cloud.google.com/vision',
    isBeta: false,
  },
  {
    key: 'slack',
    name: 'Slack',
    description: 'Get expense approvals, invoice alerts, and payment reminders in Slack',
    category: 'notifications',
    authType: 'oauth2',
    docsUrl: 'https://api.slack.com',
    isBeta: false,
  },
  {
    key: 'resend',
    name: 'Resend',
    description: 'Transactional email delivery for invoice sending and notifications',
    category: 'notifications',
    authType: 'api_key',
    docsUrl: 'https://resend.com/docs',
    isBeta: false,
  },
  {
    key: 'datev_lohn',
    name: 'DATEV Lohn & Gehalt',
    description: 'Import payroll obligations for accurate cash flow forecasting',
    category: 'hr',
    authType: 'manual',
    docsUrl: 'https://developer.datev.de',
    isComingSoon: true,
    isBeta: false,
  },
] as const

type IntegrationKey = typeof INTEGRATION_CATALOG[number]['key']

// ─── OAuth configuration per provider ─────────────────────────────────────────

function getOAuthConfig(key: IntegrationKey, callbackUrl: string) {
  const configs: Partial<Record<IntegrationKey, { authUrl: string }>> = {
    tink: {
      authUrl:
        `https://api.tink.com/api/v1/oauth/authorize?` +
        new URLSearchParams({
          client_id: process.env.TINK_CLIENT_ID ?? 'TINK_CLIENT_ID_MISSING',
          redirect_uri: callbackUrl,
          scope: 'accounts:read,transactions:read,balances:read',
          market: 'DE',
          locale: 'de_DE',
          response_type: 'code',
        }).toString(),
    },
    stripe_issuing: {
      authUrl:
        `https://connect.stripe.com/oauth/authorize?` +
        new URLSearchParams({
          response_type: 'code',
          client_id: process.env.STRIPE_CLIENT_ID ?? 'STRIPE_CLIENT_ID_MISSING',
          scope: 'read_write',
          redirect_uri: callbackUrl,
          'stripe_user[business_type]': 'company',
          'stripe_user[country]': 'DE',
        }).toString(),
    },
    slack: {
      authUrl:
        `https://slack.com/oauth/v2/authorize?` +
        new URLSearchParams({
          client_id: process.env.SLACK_CLIENT_ID ?? 'SLACK_CLIENT_ID_MISSING',
          scope: 'incoming-webhook,chat:write',
          redirect_uri: callbackUrl,
        }).toString(),
    },
  }
  return configs[key] ?? null
}

// ─── GET — list integrations ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Load connected integrations from DB
  const connected = await prisma.integration.findMany({
    where: { organizationId: session.currentOrganizationId },
    select: {
      key: true,
      status: true,
      connectedAt: true,
      connectedBy: true,
      lastSyncAt: true,
      syncCount: true,
      errorMessage: true,
    },
  })

  const connectedMap = new Map(connected.map((c) => [c.key, c]))

  const integrations = INTEGRATION_CATALOG.map((catalog) => {
    const conn = connectedMap.get(catalog.key)
    return {
      ...catalog,
      id: catalog.key,
      status: conn?.status ?? 'DISCONNECTED',
      connectedAt: conn?.connectedAt?.toISOString(),
      connectedBy: conn?.connectedBy,
      lastSyncAt: conn?.lastSyncAt?.toISOString(),
      syncCount: conn?.syncCount,
      errorMessage: conn?.errorMessage,
    }
  })

  return NextResponse.json(integrations)
}

// ─── POST — actions ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!['COMPANY_ADMIN', 'FINANCE_MANAGER'].includes(session.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json()
  const { action, key } = body as { action: string; key: IntegrationKey }

  // ── Get OAuth URL ──
  if (action === 'get_oauth_url') {
    const callbackUrl = `${process.env.NEXT_PUBLIC_URL}/api/integrations/callback?key=${key}`
    const config = getOAuthConfig(key, callbackUrl)
    if (!config) {
      return NextResponse.json({ error: 'This integration does not support OAuth' }, { status: 400 })
    }
    return NextResponse.json({ authUrl: config.authUrl })
  }

  // ── Connect with API key ──
  if (action === 'connect') {
    const { apiKey } = body as { apiKey?: string }
    if (!apiKey) return NextResponse.json({ error: 'API key required' }, { status: 400 })

    const encryptedKey = encryptValue(apiKey)

    await prisma.integration.upsert({
      where: {
        organizationId_key: {
          organizationId: session.currentOrganizationId,
          key,
        },
      },
      update: {
        status: 'CONNECTED',
        encryptedCredentials: encryptedKey,
        connectedAt: new Date(),
        connectedBy: session.name,
        errorMessage: null,
      },
      create: {
        organizationId: session.currentOrganizationId,
        key,
        status: 'CONNECTED',
        encryptedCredentials: encryptedKey,
        connectedAt: new Date(),
        connectedBy: session.name,
      },
    })

    return NextResponse.json({ success: true })
  }

  // ── Disconnect ──
  if (action === 'disconnect') {
    await prisma.integration.updateMany({
      where: {
        organizationId: session.currentOrganizationId,
        key,
      },
      data: {
        status: 'DISCONNECTED',
        encryptedCredentials: null,
        lastSyncAt: null,
        syncCount: 0,
      },
    })

    return NextResponse.json({ success: true })
  }

  // ── Sync now ──
  if (action === 'sync') {
    const integration = await prisma.integration.findUnique({
      where: {
        organizationId_key: {
          organizationId: session.currentOrganizationId,
          key,
        },
      },
    })

    if (!integration || integration.status !== 'CONNECTED') {
      return NextResponse.json({ error: 'Integration not connected' }, { status: 400 })
    }

    // Fire sync based on integration type
    try {
      let syncCount = 0

      if (key === 'tink') {
        // Tink transaction sync would go here
        // const tink = new TinkAdapter(decryptValue(integration.encryptedCredentials!))
        // const txns = await tink.fetchTransactions(last30Days)
        // syncCount = await importTransactions(session.currentOrganizationId, txns)
        syncCount = 0 // placeholder
      }

      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          lastSyncAt: new Date(),
          syncCount: { increment: syncCount },
          status: 'CONNECTED',
          errorMessage: null,
        },
      })

      return NextResponse.json({ success: true, syncCount })
    } catch (err: any) {
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          status: 'ERROR',
          errorMessage: err.message ?? 'Sync failed',
        },
      })
      return NextResponse.json({ error: err.message ?? 'Sync failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

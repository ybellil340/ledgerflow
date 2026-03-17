import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/prisma'
import { encryptValue } from '@/lib/security'

type SupportedKey = 'tink' | 'stripe_issuing' | 'slack'

// ─── Token exchange per provider ───────────────────────────────────────────────

async function exchangeTinkCode(code: string): Promise<{ accessToken: string; scope: string }> {
  const res = await fetch('https://api.tink.com/api/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.TINK_CLIENT_ID ?? '',
      client_secret: process.env.TINK_CLIENT_SECRET ?? '',
      redirect_uri: `${process.env.NEXT_PUBLIC_URL}/api/integrations/callback?key=tink`,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Tink token exchange failed: ${res.status}`)
  return res.json()
}

async function exchangeStripeCode(code: string): Promise<{ access_token: string; stripe_user_id: string }> {
  const res = await fetch('https://connect.stripe.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_secret: process.env.STRIPE_SECRET_KEY ?? '',
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Stripe token exchange failed: ${res.status}`)
  return res.json()
}

async function exchangeSlackCode(code: string): Promise<{ access_token: string; incoming_webhook: { url: string } }> {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.SLACK_CLIENT_ID ?? '',
      client_secret: process.env.SLACK_CLIENT_SECRET ?? '',
      redirect_uri: `${process.env.NEXT_PUBLIC_URL}/api/integrations/callback?key=slack`,
    }),
  })
  if (!res.ok) throw new Error(`Slack token exchange failed: ${res.status}`)
  return res.json()
}

// ─── GET /api/integrations/callback?key=tink&code=... ─────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key') as SupportedKey | null
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const errorDesc = searchParams.get('error_description')

  // OAuth denial
  if (error) {
    const redirectUrl = new URL('/settings/integrations', process.env.NEXT_PUBLIC_URL)
    redirectUrl.searchParams.set('error', errorDesc ?? 'OAuth authorization denied')
    return NextResponse.redirect(redirectUrl)
  }

  if (!key || !code) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=missing_params', process.env.NEXT_PUBLIC_URL)
    )
  }

  // Validate session from cookie
  const session = await getSession(request)
  if (!session) {
    // Session expired during OAuth flow — redirect to login
    const loginUrl = new URL('/auth/login', process.env.NEXT_PUBLIC_URL)
    loginUrl.searchParams.set('redirect', '/settings/integrations')
    return NextResponse.redirect(loginUrl)
  }

  try {
    let credentialPayload: object

    if (key === 'tink') {
      const tokens = await exchangeTinkCode(code)
      credentialPayload = {
        accessToken: tokens.accessToken,
        scope: tokens.scope,
        provider: 'tink',
      }
    } else if (key === 'stripe_issuing') {
      const tokens = await exchangeStripeCode(code)
      credentialPayload = {
        accessToken: tokens.access_token,
        stripeUserId: tokens.stripe_user_id,
        provider: 'stripe_issuing',
      }
    } else if (key === 'slack') {
      const tokens = await exchangeSlackCode(code)
      credentialPayload = {
        accessToken: tokens.access_token,
        webhookUrl: tokens.incoming_webhook?.url,
        provider: 'slack',
      }
    } else {
      throw new Error(`Unsupported OAuth provider: ${key}`)
    }

    // Store encrypted credentials
    await prisma.integration.upsert({
      where: {
        organizationId_key: {
          organizationId: session.currentOrganizationId,
          key,
        },
      },
      update: {
        status: 'CONNECTED',
        encryptedCredentials: encryptValue(JSON.stringify(credentialPayload)),
        connectedAt: new Date(),
        connectedBy: session.name,
        errorMessage: null,
      },
      create: {
        organizationId: session.currentOrganizationId,
        key,
        status: 'CONNECTED',
        encryptedCredentials: encryptValue(JSON.stringify(credentialPayload)),
        connectedAt: new Date(),
        connectedBy: session.name,
      },
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        organizationId: session.currentOrganizationId,
        userId: session.id,
        action: 'INTEGRATION_CONNECTED',
        entityType: 'Integration',
        entityId: key,
        metadata: { provider: key },
      },
    })

    // Redirect back to integrations page with success
    return NextResponse.redirect(
      new URL(`/settings/integrations?connected=${key}`, process.env.NEXT_PUBLIC_URL)
    )
  } catch (err: any) {
    console.error('[OAuth callback]', key, err.message)

    // Mark integration as error state
    await prisma.integration.upsert({
      where: {
        organizationId_key: {
          organizationId: session.currentOrganizationId,
          key,
        },
      },
      update: {
        status: 'ERROR',
        errorMessage: err.message ?? 'OAuth callback failed',
      },
      create: {
        organizationId: session.currentOrganizationId,
        key,
        status: 'ERROR',
        errorMessage: err.message ?? 'OAuth callback failed',
      },
    })

    return NextResponse.redirect(
      new URL(
        `/settings/integrations?error=${encodeURIComponent(err.message ?? 'Connection failed')}`,
        process.env.NEXT_PUBLIC_URL
      )
    )
  }
}

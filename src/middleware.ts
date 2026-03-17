/**
 * LedgerFlow — Next.js Middleware
 * Runs on every request. Handles:
 * - Auth verification (JWT session cookie)
 * - Route protection (RBAC)
 * - Redirect to login for unauthenticated users
 * - Organization context injection
 * - Rate limiting placeholder
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

// Public routes that don't require auth
const PUBLIC_ROUTES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/accept-invite',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/accept-invite',
  '/_next',
  '/favicon.ico',
  '/robots.txt',
]

// Admin-only routes
const ADMIN_ROUTES = ['/admin', '/api/admin']

// Tax advisor routes
const TAX_ADVISOR_ROUTES = ['/tax-advisor', '/api/tax-advisor']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Allow public routes ───────────────────────────
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // ── Get session token ─────────────────────────────
  const token = request.cookies.get(
    process.env.SESSION_COOKIE_NAME ?? 'ledgerflow_session'
  )?.value

  if (!token) {
    // API routes return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // App routes redirect to login
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // ── Verify JWT ────────────────────────────────────
  let payload: {
    sub: string
    email: string
    role: string
    organizationId: string
    isSuperAdmin: boolean
    isTaxAdvisor: boolean
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    const { payload: verified } = await jwtVerify(token, secret)
    payload = verified as typeof payload
  } catch {
    // Invalid or expired token
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    const response = NextResponse.redirect(loginUrl)
    response.cookies.delete(process.env.SESSION_COOKIE_NAME ?? 'ledgerflow_session')
    return response
  }

  // ── RBAC checks ───────────────────────────────────

  // Admin routes
  if (ADMIN_ROUTES.some((r) => pathname.startsWith(r))) {
    if (!payload.isSuperAdmin) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  // Tax advisor portal
  if (TAX_ADVISOR_ROUTES.some((r) => pathname.startsWith(r))) {
    if (!payload.isTaxAdvisor && !['COMPANY_ADMIN', 'FINANCE_MANAGER'].includes(payload.role)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  // ── Inject user context into headers ─────────────
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-user-id', payload.sub)
  requestHeaders.set('x-user-email', payload.email)
  requestHeaders.set('x-user-role', payload.role)
  requestHeaders.set('x-organization-id', payload.organizationId)
  requestHeaders.set('x-is-super-admin', payload.isSuperAdmin ? '1' : '0')
  requestHeaders.set('x-is-tax-advisor', payload.isTaxAdvisor ? '1' : '0')

  // ── Rate limiting (placeholder for Upstash Redis) ─
  // TODO: Implement rate limiting
  // const rateLimitKey = `rate:${payload.sub}:${pathname}`
  // const { success } = await ratelimit.limit(rateLimitKey)
  // if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (Next.js static files)
     * - _next/image (Next.js image optimization)
     * - public files (images, fonts, etc.)
     */
    '/((?!_next/static|_next/image|images|fonts|.*\\..*$).*)',
  ],
}

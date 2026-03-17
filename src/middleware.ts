import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

// All public paths — no auth required
const PUBLIC_PREFIXES = [
  '/auth/',           // /auth/login, /auth/signup
  '/api/auth/',       // /api/auth/login, /api/auth/signup etc
  '/api/health',
  '/api/seed',        // one-time seed endpoint
  '/api/debug',       // debug endpoint
  '/invoice/',        // public invoice portal
  '/_next/',
  '/favicon',
  '/manifest',
  '/icons/',
  '/sw.',
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow all public paths
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Allow static files
  if (pathname.includes('.')) {
    return NextResponse.next()
  }

  const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'ledgerflow_session'
  const token = request.cookies.get(COOKIE_NAME)?.value

  // No token — redirect to login or return 401
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Verify JWT
  try {
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET ?? 'fallback-dev-secret-min-32-chars!!'
    )
    const { payload } = await jwtVerify(token, secret)

    // Inject context headers for API routes
    const headers = new Headers(request.headers)
    headers.set('x-user-id', String(payload.sub ?? ''))
    headers.set('x-user-role', String((payload as any).currentRole ?? ''))
    headers.set('x-organization-id', String((payload as any).currentOrganizationId ?? ''))
    headers.set('x-is-super-admin', (payload as any).isSuperAdmin ? '1' : '0')

    return NextResponse.next({ request: { headers } })
  } catch {
    // Bad token — clear it and redirect to login
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    const loginUrl = new URL('/auth/login', request.url)
    const response = NextResponse.redirect(loginUrl)
    response.cookies.delete(COOKIE_NAME)
    return response
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\..*).*)'],
}

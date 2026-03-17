import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import type { SessionUser } from '@/types'
import { getPermissionsForRole } from '@/lib/auth/rbac'

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'ledgerflow_session'
const JWT_EXPIRY = process.env.JWT_EXPIRY ?? '7d'

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is not set')
  return new TextEncoder().encode(secret)
}

// ─────────────────────────────────────────────
// SIGN TOKEN
// ─────────────────────────────────────────────

export async function signToken(payload: {
  sub: string
  email: string
  firstName: string
  lastName: string
  role: string
  organizationId: string
  isSuperAdmin: boolean
  isTaxAdvisor: boolean
  taxAdvisorFirmId?: string
}): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret())
}

// ─────────────────────────────────────────────
// VERIFY TOKEN
// ─────────────────────────────────────────────

export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    const role = payload.role as string
    return {
      id: payload.sub as string,
      email: payload.email as string,
      firstName: payload.firstName as string,
      lastName: payload.lastName as string,
      avatarUrl: (payload.avatarUrl as string) ?? null,
      currentOrganizationId: payload.organizationId as string,
      currentRole: role as SessionUser['currentRole'],
      isSuperAdmin: payload.isSuperAdmin as boolean,
      isTaxAdvisor: payload.isTaxAdvisor as boolean,
      taxAdvisorFirmId: payload.taxAdvisorFirmId as string | undefined,
      permissions: getPermissionsForRole(role as SessionUser['currentRole']),
    }
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────
// GET SESSION (server components & API routes)
// ─────────────────────────────────────────────

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}

export async function getSessionFromRequest(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}

// ─────────────────────────────────────────────
// SET / CLEAR SESSION COOKIE
// ─────────────────────────────────────────────

export function setSessionCookie(token: string) {
  const cookieStore = cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  })
}

export function clearSessionCookie() {
  const cookieStore = cookies()
  cookieStore.delete(COOKIE_NAME)
}

// ─────────────────────────────────────────────
// REQUIRE SESSION (throws if not authenticated)
// ─────────────────────────────────────────────

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession()
  if (!session) throw new AuthError('Unauthorized', 401)
  return session
}

export async function requirePermission(permission: string): Promise<SessionUser> {
  const session = await requireSession()
  if (!session.isSuperAdmin && !session.permissions.includes(permission as never)) {
    throw new AuthError('Forbidden', 403)
  }
  return session
}

// ─────────────────────────────────────────────
// AUTH ERROR
// ─────────────────────────────────────────────

export class AuthError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'AuthError'
  }
}

// ─────────────────────────────────────────────
// API ROUTE HELPER — wraps handlers with auth
// ─────────────────────────────────────────────

import { NextResponse } from 'next/server'

type Handler<T = unknown> = (req: NextRequest, session: SessionUser, params?: T) => Promise<NextResponse>

export function withAuth<T = unknown>(handler: Handler<T>, requiredPermission?: string) {
  return async (req: NextRequest, context?: { params: T }): Promise<NextResponse> => {
    try {
      const session = await getSession()
      if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

      if (requiredPermission && !session.isSuperAdmin && !session.permissions.includes(requiredPermission as never)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      return handler(req, session, context?.params)
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      console.error('[withAuth] Unhandled error:', err)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}

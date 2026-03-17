import { SignJWT, jwtVerify } from 'jose'
import { NextRequest, NextResponse } from 'next/server'
import type { SessionUser } from '@/types'
import { getPermissionsForRole } from '@/lib/auth/rbac'

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'ledgerflow_session'
const JWT_EXPIRY = process.env.JWT_EXPIRY ?? '7d'

function getSecret() {
  const secret = process.env.JWT_SECRET ?? 'fallback-dev-secret-min-32-chars!!'
  return new TextEncoder().encode(secret)
}

// ─── SIGN TOKEN ───────────────────────────────────────────────────────────────

export async function signToken(payload: {
  sub: string
  email: string
  firstName?: string | null
  lastName?: string | null
  role: string
  organizationId: string
  isSuperAdmin?: boolean
  isTaxAdvisor?: boolean
  taxAdvisorFirmId?: string | null
}): Promise<string> {
  const role = payload.role as SessionUser['currentRole']
  return new SignJWT({
    sub: payload.sub,
    email: payload.email,
    firstName: payload.firstName ?? '',
    lastName: payload.lastName ?? '',
    name: `${payload.firstName ?? ''} ${payload.lastName ?? ''}`.trim(),
    currentRole: role,
    currentOrganizationId: payload.organizationId,
    isSuperAdmin: payload.isSuperAdmin ?? false,
    isTaxAdvisor: payload.isTaxAdvisor ?? false,
    taxAdvisorFirmId: payload.taxAdvisorFirmId,
    permissions: getPermissionsForRole(role),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret())
}

// ─── VERIFY TOKEN ─────────────────────────────────────────────────────────────

export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return payload as unknown as SessionUser
  } catch {
    return null
  }
}

// ─── GET SESSION FROM REQUEST ─────────────────────────────────────────────────

export async function getSession(req?: NextRequest): Promise<SessionUser | null> {
  // Always read from the request object — never from next/headers cookies()
  if (req) {
    const token = req.cookies.get(COOKIE_NAME)?.value
    if (!token) return null
    return verifyToken(token)
  }
  // Server component fallback — use next/headers dynamically
  try {
    const { cookies } = await import('next/headers')
    const cookieStore = cookies()
    const token = (cookieStore as any).get(COOKIE_NAME)?.value
    if (!token) return null
    return verifyToken(token)
  } catch {
    return null
  }
}

export async function getSessionFromRequest(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}

// ─── AUTH ERRORS ──────────────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(message: string, public status: number = 401) {
    super(message)
    this.name = 'AuthError'
  }
}

// ─── withAuth MIDDLEWARE ──────────────────────────────────────────────────────

type Handler<T = unknown> = (
  req: NextRequest,
  session: SessionUser,
  params?: T
) => Promise<NextResponse>

export function withAuth<T = unknown>(handler: Handler<T>, requiredPermission?: string) {
  return async (req: NextRequest, context?: { params: T }): Promise<NextResponse> => {
    try {
      const session = await getSessionFromRequest(req)
      if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

      if (
        requiredPermission &&
        !session.isSuperAdmin &&
        !(session.permissions as string[]).includes(requiredPermission)
      ) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      return handler(req, session, context?.params)
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      console.error('[withAuth]', err)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}

export async function requireSession(req: NextRequest): Promise<SessionUser> {
  const session = await getSessionFromRequest(req)
  if (!session) throw new AuthError('Unauthorized', 401)
  return session
}

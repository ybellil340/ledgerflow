export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

/**
 * GET /api/auth/me
 *
 * Returns the current authenticated user from the session cookie.
 * Used by the client AuthContext on mount to hydrate the session
 * without re-entering credentials.
 *
 * Returns 401 if no valid session, 200 with user data if authenticated.
 */
export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  // Return full user data for client-side state
  return NextResponse.json({
    data: {
      id: session.id,
      email: session.email,
      firstName: session.firstName,
      lastName: session.lastName,
      currentOrganizationId: session.currentOrganizationId,
      currentRole: session.currentRole,
      isSuperAdmin: session.isSuperAdmin,
      isTaxAdvisor: session.isTaxAdvisor,
      taxAdvisorFirmId: session.taxAdvisorFirmId,
      organizations: session.organizations,
      // Client-side needs to know permissions for UI rendering
      permissions: session.permissions,
    },
  })
})

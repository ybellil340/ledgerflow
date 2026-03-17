import { NextRequest, NextResponse } from 'next/server'
import { clearSessionCookie, getSession } from '@/lib/auth/session'
import prisma from '@/lib/db/prisma'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (session) {
    await prisma.auditLog.create({
      data: {
        organizationId: session.currentOrganizationId,
        actorId: session.id,
        action: 'LOGOUT',
        entityType: 'user',
        entityId: session.id,
      },
    })
  }
  clearSessionCookie()
  return NextResponse.json({ data: { success: true } })
}

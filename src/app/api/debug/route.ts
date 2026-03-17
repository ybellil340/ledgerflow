export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db/prisma'

export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get('secret')
  if (secret !== (process.env.SEED_SECRET ?? 'seed-ledgerflow-demo')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const users = await prisma.user.findMany({ select: { id: true, email: true, isActive: true } })
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, ownerId: true } })
  const memberships = await prisma.organizationMembership.findMany({ 
    select: { userId: true, organizationId: true, role: true, status: true } 
  })
  const subs = await prisma.subscription.findMany({ 
    select: { organizationId: true, plan: true, status: true } 
  })

  return NextResponse.json({ users, orgs, memberships, subs })
}

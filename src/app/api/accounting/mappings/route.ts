export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import { SKR03_EXPENSE_ACCOUNTS, DEFAULT_VAT_CODES } from '@/lib/services/datev-export'
import type { SessionUser } from '@/types'

const MappingSchema = z.object({
  categoryName: z.string().min(1).max(100),
  accountingCode: z.string().min(1).max(20),
  description: z.string().optional(),
  vatCodeId: z.string().cuid().optional(),
})

// ─── GET /api/accounting/mappings ────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const [mappings, vatCodes] = await Promise.all([
    prisma.accountingMapping.findMany({
      where: { organizationId: session.currentOrganizationId, isActive: true },
      include: { vatCode: true },
      orderBy: { categoryName: 'asc' },
    }),
    prisma.vATCode.findMany({
      where: { organizationId: session.currentOrganizationId, isActive: true },
      orderBy: { rate: 'desc' },
    }),
  ])

  // Attach SKR03 reference data
  const skr03Reference = Object.entries(SKR03_EXPENSE_ACCOUNTS).map(([key, val]) => ({
    key,
    code: val.code,
    description: val.description,
  }))

  return NextResponse.json({
    data: { mappings, vatCodes, skr03Reference },
  })
}, 'manage:accounting')

// ─── POST /api/accounting/mappings ───────────

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()

  // Bulk seed from SKR03 defaults
  if (body.seedDefaults) {
    const defaults = [
      { categoryName: 'Travel', accountingCode: '4670', description: 'Reisekosten Arbeitnehmer' },
      { categoryName: 'Meals', accountingCode: '4674', description: 'Bewirtungskosten' },
      { categoryName: 'Accommodation', accountingCode: '4671', description: 'Übernachtungskosten' },
      { categoryName: 'Software', accountingCode: '4980', description: 'EDV-Kosten / Software' },
      { categoryName: 'Equipment', accountingCode: '4830', description: 'Werkzeuge und Kleingeräte' },
      { categoryName: 'Office', accountingCode: '4910', description: 'Bürobedarf' },
      { categoryName: 'Phone', accountingCode: '4920', description: 'Telefon und Internet' },
      { categoryName: 'Marketing', accountingCode: '4600', description: 'Werbekosten' },
      { categoryName: 'Consulting', accountingCode: '4970', description: 'Beratungskosten' },
      { categoryName: 'Insurance', accountingCode: '4360', description: 'Versicherungsbeiträge' },
      { categoryName: 'Banking', accountingCode: '4970', description: 'Bankgebühren' },
      { categoryName: 'Rent', accountingCode: '4210', description: 'Miete und Pacht' },
    ]

    const created = await Promise.all(
      defaults.map((d) =>
        prisma.accountingMapping.upsert({
          where: { organizationId_categoryName: { organizationId: session.currentOrganizationId, categoryName: d.categoryName } },
          update: { accountingCode: d.accountingCode, description: d.description },
          create: { ...d, organizationId: session.currentOrganizationId },
        })
      )
    )

    await prisma.auditLog.create({
      data: {
        organizationId: session.currentOrganizationId, actorId: session.id,
        action: 'CREATE', entityType: 'accounting_mapping', entityId: 'bulk_seed',
        after: { count: created.length, type: 'SKR03_defaults' },
      },
    })

    return NextResponse.json({ data: created, message: `${created.length} default mappings applied` })
  }

  // Single mapping
  const data = MappingSchema.parse(body)

  const mapping = await prisma.accountingMapping.upsert({
    where: { organizationId_categoryName: { organizationId: session.currentOrganizationId, categoryName: data.categoryName } },
    update: { accountingCode: data.accountingCode, description: data.description, vatCodeId: data.vatCodeId },
    create: { ...data, organizationId: session.currentOrganizationId },
    include: { vatCode: true },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId, actorId: session.id,
      action: 'UPDATE', entityType: 'accounting_mapping', entityId: mapping.id,
      after: { categoryName: data.categoryName, accountingCode: data.accountingCode },
    },
  })

  return NextResponse.json({ data: mapping })
}, 'manage:accounting')

// ─── PATCH /api/accounting/mappings/[id] ────

export const PATCH = withAuth(async (req: NextRequest, session: SessionUser) => {
  const id = req.url.split('/mappings/')[1]?.split('?')[0]
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

  const mapping = await prisma.accountingMapping.findFirst({
    where: { id, organizationId: session.currentOrganizationId },
  })
  if (!mapping) return NextResponse.json({ error: 'Mapping not found' }, { status: 404 })

  const body = await req.json()
  const data = MappingSchema.partial().parse(body)

  const updated = await prisma.accountingMapping.update({
    where: { id },
    data,
    include: { vatCode: true },
  })

  return NextResponse.json({ data: updated })
}, 'export:accounting')

// ─── GET /api/accounting/vat ─────────────────

export async function getVATCodes(session: SessionUser) {
  const vatCodes = await prisma.vATCode.findMany({
    where: { organizationId: session.currentOrganizationId, isActive: true },
    orderBy: { rate: 'desc' },
  })
  return vatCodes
}

export async function seedVATCodes(organizationId: string) {
  for (const vat of DEFAULT_VAT_CODES) {
    await prisma.vATCode.upsert({
      where: { organizationId_code: { organizationId, code: vat.code } },
      update: {},
      create: { ...vat, organizationId },
    })
  }
}

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

// ─── SUPPLIER SCHEMAS ────────────────────────

const SupplierSchema = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().optional(),
  vatId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().length(2).default('DE'),
  iban: z.string().max(34).optional(),
  bic: z.string().max(11).optional(),
  paymentTerms: z.number().int().min(0).default(30),
  notes: z.string().optional(),
})

// ─── GET /api/invoices/suppliers ────────────

export const GET_SUPPLIERS = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '50'), 100)

  const where: Record<string, unknown> = {
    organizationId: session.currentOrganizationId,
    isActive: true,
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { vatId: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [total, suppliers] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      include: {
        _count: { select: { invoices: true } },
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  // Enrich with total invoiced amounts
  const invoiceSums = await prisma.supplierInvoice.groupBy({
    by: ['supplierId'],
    where: {
      organizationId: session.currentOrganizationId,
      supplierId: { in: suppliers.map((s) => s.id) },
    },
    _sum: { grossAmount: true },
  })
  const sumMap = Object.fromEntries(invoiceSums.map((s) => [s.supplierId, Number(s._sum.grossAmount ?? 0)]))

  return NextResponse.json({
    data: suppliers.map((s) => ({ ...s, totalInvoiced: sumMap[s.id] ?? 0 })),
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
  })
})

export const POST_SUPPLIER = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const data = SupplierSchema.parse(body)

  const supplier = await prisma.supplier.create({
    data: { ...data, organizationId: session.currentOrganizationId },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId, actorId: session.id,
      action: 'CREATE', entityType: 'supplier', entityId: supplier.id,
      after: { name: supplier.name },
    },
  })

  return NextResponse.json({ data: supplier }, { status: 201 })
}, 'manage:invoices')

// ─── CUSTOMER SCHEMAS ────────────────────────

const CustomerSchema = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().optional(),
  vatId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().length(2).default('DE'),
  paymentTerms: z.number().int().min(0).default(30),
  currency: z.string().length(3).default('EUR'),
  notes: z.string().optional(),
})

export const GET_CUSTOMERS = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '50'), 100)

  const where: Record<string, unknown> = {
    organizationId: session.currentOrganizationId,
    isActive: true,
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { vatId: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      include: { _count: { select: { invoices: true } } },
      orderBy: { name: 'asc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  const revenueSums = await prisma.customerInvoice.groupBy({
    by: ['customerId'],
    where: {
      organizationId: session.currentOrganizationId,
      customerId: { in: customers.map((c) => c.id) },
      status: 'PAID',
    },
    _sum: { total: true },
  })
  const revenueMap = Object.fromEntries(revenueSums.map((s) => [s.customerId, Number(s._sum.total ?? 0)]))

  return NextResponse.json({
    data: customers.map((c) => ({ ...c, totalRevenue: revenueMap[c.id] ?? 0 })),
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
  })
})

export const POST_CUSTOMER = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const data = CustomerSchema.parse(body)

  const customer = await prisma.customer.create({
    data: { ...data, organizationId: session.currentOrganizationId },
  })

  return NextResponse.json({ data: customer }, { status: 201 })
}, 'manage:invoices')

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

// ─── GET /api/transactions ───────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)

  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '25'), 100)
  const status = searchParams.getAll('status')
  const cardId = searchParams.get('cardId')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')
  const amountMin = searchParams.get('amountMin')
  const amountMax = searchParams.get('amountMax')
  const merchant = searchParams.get('merchant')
  const search = searchParams.get('search')

  const where: Record<string, unknown> = {
    organizationId: session.currentOrganizationId,
    parentId: null, // exclude split children from top-level
  }

  if (status.length > 0) where.status = { in: status }
  if (cardId) where.cardId = cardId
  if (dateFrom || dateTo) {
    where.transactionDate = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo) } : {}),
    }
  }
  if (amountMin || amountMax) {
    where.amount = {
      ...(amountMin ? { gte: parseFloat(amountMin) } : {}),
      ...(amountMax ? { lte: parseFloat(amountMax) } : {}),
    }
  }
  if (merchant) where.merchant = { contains: merchant, mode: 'insensitive' }
  if (search) {
    where.OR = [
      { merchant: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [total, items] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      include: {
        card: {
          select: {
            id: true, lastFour: true, type: true,
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        receipt: { select: { id: true, fileUrl: true, ocrProcessed: true } },
        vatCode: { select: { id: true, code: true, rate: true } },
        expense: { select: { id: true, status: true, merchant: true } },
        splits: { select: { id: true, amount: true, description: true } },
      },
      orderBy: { transactionDate: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ])

  // Status counts
  const statusCounts = await prisma.transaction.groupBy({
    by: ['status'],
    where: { organizationId: session.currentOrganizationId, parentId: null },
    _count: { status: true },
    _sum: { amount: true },
  })

  return NextResponse.json({
    data: items,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    statusCounts: statusCounts.map((s) => ({
      status: s.status,
      count: s._count.status,
      total: Number(s._sum.amount ?? 0),
    })),
  })
})

// ─── PATCH /api/transactions — bulk categorize ───────

const BulkUpdateSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(100),
  categoryId: z.string().optional(),
  vatCodeId: z.string().cuid().optional(),
  status: z.enum(['CATEGORIZED', 'RECONCILED', 'FLAGGED', 'PERSONAL']).optional(),
  accountingCode: z.string().optional(),
})

export const PATCH = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const data = BulkUpdateSchema.parse(body)

  // Verify all transactions belong to org
  const count = await prisma.transaction.count({
    where: { id: { in: data.ids }, organizationId: session.currentOrganizationId },
  })
  if (count !== data.ids.length) {
    return NextResponse.json({ error: 'Some transactions not found' }, { status: 404 })
  }

  const updateData: Record<string, unknown> = {}
  if (data.categoryId !== undefined) updateData.merchantCategory = data.categoryId
  if (data.vatCodeId !== undefined) updateData.vatCodeId = data.vatCodeId
  if (data.status !== undefined) updateData.status = data.status
  if (data.accountingCode !== undefined) updateData.accountingCode = data.accountingCode

  await prisma.transaction.updateMany({
    where: { id: { in: data.ids }, organizationId: session.currentOrganizationId },
    data: updateData,
  })

  await prisma.auditLog.create({
    data: {
      organizationId: session.currentOrganizationId,
      actorId: session.id,
      action: 'UPDATE',
      entityType: 'transaction',
      entityId: data.ids.join(','),
      after: { ...updateData, count: data.ids.length },
    },
  })

  return NextResponse.json({ data: { updated: data.ids.length } })
})

// ─── POST /api/transactions — import (mock bank sync) ─

const ImportTransactionSchema = z.object({
  transactions: z.array(z.object({
    externalId: z.string(),
    merchant: z.string(),
    amount: z.number(),
    currency: z.string().default('EUR'),
    transactionDate: z.string().datetime(),
    description: z.string().optional(),
    cardId: z.string().cuid().optional(),
    merchantCategory: z.string().optional(),
  })).min(1).max(500),
})

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  // Only admins and finance managers can import transactions
  if (!['COMPANY_ADMIN', 'FINANCE_MANAGER', 'SUPER_ADMIN'].includes(session.currentRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { transactions } = ImportTransactionSchema.parse(body)

  let imported = 0
  let skipped = 0

  for (const tx of transactions) {
    const existing = await prisma.transaction.findFirst({
      where: { externalId: tx.externalId, organizationId: session.currentOrganizationId },
    })
    if (existing) { skipped++; continue }

    await prisma.transaction.create({
      data: {
        organizationId: session.currentOrganizationId,
        externalId: tx.externalId,
        merchant: tx.merchant,
        amount: tx.amount,
        currency: tx.currency,
        transactionDate: new Date(tx.transactionDate),
        description: tx.description,
        cardId: tx.cardId,
        merchantCategory: tx.merchantCategory,
        status: 'UNCATEGORIZED',
      },
    })
    imported++
  }

  return NextResponse.json({ data: { imported, skipped, total: transactions.length } })
}, 'manage:expenses')

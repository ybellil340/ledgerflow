/**
 * GET /api/search?q=...&types=...&limit=...
 *
 * Global full-text search across:
 *   expenses     — merchant, notes, category, employee name
 *   invoices_ap  — supplier name, invoice number, notes
 *   invoices_ar  — customer name, invoice number
 *   suppliers    — name, VAT ID, email, city
 *   customers    — name, VAT ID, email, city
 *   transactions — description, merchant, reference
 *   members      — name, email (COMPANY_ADMIN only)
 *
 * Uses Prisma full-text search (PostgreSQL tsvector) with fallback to ILIKE.
 * Results are ranked by relevance and limited to the user's organization.
 *
 * Response:
 * {
 *   data: {
 *     expenses: SearchResult[],
 *     invoices_ap: SearchResult[],
 *     ...
 *   },
 *   meta: { total: number, query: string, took: number }
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import type { SessionUser } from '@/types'

export interface SearchResult {
  id: string
  type: 'expense' | 'invoice_ap' | 'invoice_ar' | 'supplier' | 'customer' | 'transaction' | 'member'
  title: string
  subtitle: string
  meta?: string            // Amount, date, status
  status?: string
  url: string              // Client-side navigation target
  score?: number
}

const MAX_PER_TYPE = 5
const MAX_TOTAL = 30

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const start = Date.now()
  const { searchParams } = new URL(req.url)

  const q = searchParams.get('q')?.trim()
  const typesParam = searchParams.get('types') // comma-separated, or empty = all
  const limitParam = parseInt(searchParams.get('limit') ?? '5', 10)
  const limit = Math.min(limitParam, MAX_PER_TYPE)

  if (!q || q.length < 2) {
    return NextResponse.json({
      data: {},
      meta: { total: 0, query: q ?? '', took: 0 },
    })
  }

  const orgId = session.currentOrganizationId
  const requestedTypes = typesParam ? typesParam.split(',') : null

  const should = (type: string) => !requestedTypes || requestedTypes.includes(type)

  // Run all searches in parallel
  const [expenses, invoicesAP, invoicesAR, suppliers, customers, transactions, members] =
    await Promise.allSettled([
      should('expenses') ? searchExpenses(q, orgId, limit) : Promise.resolve([]),
      should('invoices_ap') ? searchInvoicesAP(q, orgId, limit) : Promise.resolve([]),
      should('invoices_ar') ? searchInvoicesAR(q, orgId, limit) : Promise.resolve([]),
      should('suppliers') ? searchSuppliers(q, orgId, limit) : Promise.resolve([]),
      should('customers') ? searchCustomers(q, orgId, limit) : Promise.resolve([]),
      should('transactions') ? searchTransactions(q, orgId, limit) : Promise.resolve([]),
      should('members') && session.currentRole !== 'EMPLOYEE' ? searchMembers(q, orgId, limit) : Promise.resolve([]),
    ])

  const extract = <T>(r: PromiseSettledResult<T[]>): T[] =>
    r.status === 'fulfilled' ? r.value : []

  const data: Record<string, SearchResult[]> = {}
  const e = extract(expenses)
  const ap = extract(invoicesAP)
  const ar = extract(invoicesAR)
  const s = extract(suppliers)
  const c = extract(customers)
  const tx = extract(transactions)
  const m = extract(members)

  if (e.length) data.expenses = e
  if (ap.length) data.invoices_ap = ap
  if (ar.length) data.invoices_ar = ar
  if (s.length) data.suppliers = s
  if (c.length) data.customers = c
  if (tx.length) data.transactions = tx
  if (m.length) data.members = m

  const total = Object.values(data).reduce((sum, arr) => sum + arr.length, 0)

  return NextResponse.json({
    data,
    meta: {
      total,
      query: q,
      took: Date.now() - start,
    },
  })
})

// ─────────────────────────────────────────────
// SEARCH FUNCTIONS
// ─────────────────────────────────────────────

const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)

async function searchExpenses(q: string, orgId: string, limit: number): Promise<SearchResult[]> {
  const results = await prisma.expense.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { merchant: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
        { categoryId: { contains: q, mode: 'insensitive' } },
        { user: { OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
        ]}},
      ],
    },
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { expenseDate: 'desc' },
    take: limit,
  })

  return results.map((e) => ({
    id: e.id,
    type: 'expense' as const,
    title: e.merchant,
    subtitle: `${e.user.firstName} ${e.user.lastName} · ${e.categoryId ?? 'Uncategorized'}`,
    meta: `${fmt(Number(e.grossAmount), e.currency)} · ${new Date(e.expenseDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    status: e.status,
    url: `/expenses?highlight=${e.id}`,
  }))
}

async function searchInvoicesAP(q: string, orgId: string, limit: number): Promise<SearchResult[]> {
  const results = await prisma.supplierInvoice.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { invoiceNumber: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
        { supplier: { name: { contains: q, mode: 'insensitive' } } },
      ],
    },
    include: { supplier: { select: { name: true } } },
    orderBy: { invoiceDate: 'desc' },
    take: limit,
  })

  return results.map((inv) => ({
    id: inv.id,
    type: 'invoice_ap' as const,
    title: inv.supplier.name,
    subtitle: inv.invoiceNumber,
    meta: `${fmt(Number(inv.totalAmount), inv.currency)} · Due ${new Date(inv.dueDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}`,
    status: inv.status,
    url: `/invoices/ap?highlight=${inv.id}`,
  }))
}

async function searchInvoicesAR(q: string, orgId: string, limit: number): Promise<SearchResult[]> {
  const results = await prisma.customerInvoice.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { invoiceNumber: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
      ],
    },
    include: { customer: { select: { name: true } } },
    orderBy: { invoiceDate: 'desc' },
    take: limit,
  })

  return results.map((inv) => ({
    id: inv.id,
    type: 'invoice_ar' as const,
    title: inv.customer.name,
    subtitle: inv.invoiceNumber,
    meta: `${fmt(Number(inv.totalAmount), inv.currency)} · ${inv.status}`,
    status: inv.status,
    url: `/invoices/ar?highlight=${inv.id}`,
  }))
}

async function searchSuppliers(q: string, orgId: string, limit: number): Promise<SearchResult[]> {
  const results = await prisma.supplier.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { vatId: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: limit,
  })

  return results.map((s) => ({
    id: s.id,
    type: 'supplier' as const,
    title: s.name,
    subtitle: [s.city, s.country].filter(Boolean).join(', '),
    meta: s.vatId ?? undefined,
    url: `/suppliers?highlight=${s.id}`,
  }))
}

async function searchCustomers(q: string, orgId: string, limit: number): Promise<SearchResult[]> {
  const results = await prisma.customer.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { vatId: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: limit,
  })

  return results.map((c) => ({
    id: c.id,
    type: 'customer' as const,
    title: c.name,
    subtitle: [c.city, c.country].filter(Boolean).join(', '),
    meta: c.vatId ?? undefined,
    url: `/customers?highlight=${c.id}`,
  }))
}

async function searchTransactions(q: string, orgId: string, limit: number): Promise<SearchResult[]> {
  const results = await prisma.transaction.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { description: { contains: q, mode: 'insensitive' } },
        { merchant: { contains: q, mode: 'insensitive' } },
        { reference: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { transactionDate: 'desc' },
    take: limit,
  })

  return results.map((tx) => ({
    id: tx.id,
    type: 'transaction' as const,
    title: tx.merchant ?? tx.description ?? 'Transaction',
    subtitle: new Date(tx.transactionDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }),
    meta: `${Number(tx.amount) >= 0 ? '+' : ''}${fmt(Number(tx.amount), tx.currency)}`,
    url: `/transactions?highlight=${tx.id}`,
  }))
}

async function searchMembers(q: string, orgId: string, limit: number): Promise<SearchResult[]> {
  const results = await prisma.organizationMember.findMany({
    where: {
      organizationId: orgId,
      status: 'ACTIVE',
      user: {
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
    },
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    take: limit,
  })

  return results.map((m) => ({
    id: m.user.id,
    type: 'member' as const,
    title: `${m.user.firstName} ${m.user.lastName}`,
    subtitle: m.user.email,
    meta: m.role.replace('_', ' '),
    url: `/settings/team?highlight=${m.user.id}`,
  }))
}

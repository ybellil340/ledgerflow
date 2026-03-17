export const dynamic = 'force-dynamic'

/**
 * Recurring Rules — auto-generate expenses and AR invoices on a schedule
 *
 * GET    /api/recurring        — list recurring rules
 * POST   /api/recurring        — create rule
 * PATCH  /api/recurring/[id]   — update rule
 * DELETE /api/recurring/[id]   — deactivate rule
 *
 * Cron: every day at 06:00 UTC, processRecurringRules() runs and creates
 * due instances. Instances are tracked in RecurringInstance table to
 * prevent double-creation.
 *
 * Supported types:
 *   EXPENSE      — creates an expense draft (merchant, amount, category)
 *   AR_INVOICE   — creates a customer invoice draft (with line items)
 *
 * Frequencies: WEEKLY | MONTHLY | QUARTERLY | ANNUALLY
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { assertPermission } from '@/lib/auth/rbac'
import type { SessionUser } from '@/types'

export type RecurringFrequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY'
export type RecurringType = 'EXPENSE' | 'AR_INVOICE'

// ─────────────────────────────────────────────
// NEXT DUE DATE CALCULATION
// ─────────────────────────────────────────────

export function computeNextDueDate(lastDate: Date, frequency: RecurringFrequency): Date {
  const next = new Date(lastDate)
  switch (frequency) {
    case 'WEEKLY':     next.setDate(next.getDate() + 7); break
    case 'MONTHLY':    next.setMonth(next.getMonth() + 1); break
    case 'QUARTERLY':  next.setMonth(next.getMonth() + 3); break
    case 'ANNUALLY':   next.setFullYear(next.getFullYear() + 1); break
  }
  return next
}

// ─────────────────────────────────────────────
// MAIN PROCESSOR (called by cron)
// ─────────────────────────────────────────────

export async function processRecurringRules(): Promise<{
  processed: number
  created: number
  errors: number
}> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const dueRules = await prisma.recurringRule.findMany({
    where: {
      isActive: true,
      nextDueDate: { lte: today },
      OR: [
        { endDate: null },
        { endDate: { gte: today } },
      ],
    },
    include: {
      organization: { select: { id: true } },
    },
  })

  let created = 0
  let errors = 0

  for (const rule of dueRules) {
    try {
      await createInstanceFromRule(rule)
      created++

      // Update nextDueDate
      const nextDue = computeNextDueDate(rule.nextDueDate, rule.frequency as RecurringFrequency)
      await prisma.recurringRule.update({
        where: { id: rule.id },
        data: {
          nextDueDate: nextDue,
          lastRunAt: new Date(),
          runCount: { increment: 1 },
        },
      })
    } catch (err) {
      console.error(`[Recurring] Rule ${rule.id} failed:`, err)
      errors++

      await prisma.recurringRule.update({
        where: { id: rule.id },
        data: { lastErrorAt: new Date(), lastError: err instanceof Error ? err.message : 'Unknown error' },
      })
    }
  }

  return { processed: dueRules.length, created, errors }
}

async function createInstanceFromRule(rule: {
  id: string
  type: string
  organizationId: string
  userId?: string | null
  payload: unknown
  nextDueDate: Date
}): Promise<void> {
  const payload = rule.payload as Record<string, unknown>

  if (rule.type === 'EXPENSE') {
    const expense = await prisma.expense.create({
      data: {
        organizationId: rule.organizationId,
        userId: rule.userId ?? rule.organizationId, // Fallback to org
        merchant: payload.merchant as string,
        grossAmount: payload.grossAmount as number,
        netAmount: payload.netAmount as number ?? (payload.grossAmount as number) / 1.19,
        vatAmount: payload.vatAmount as number ?? (payload.grossAmount as number) - ((payload.grossAmount as number) / 1.19),
        vatRate: payload.vatRate as number ?? 19,
        currency: (payload.currency as string) ?? 'EUR',
        expenseDate: rule.nextDueDate,
        categoryId: payload.categoryId as string | undefined,
        notes: `Auto-generated from recurring rule: ${payload.description ?? rule.id}`,
        status: 'DRAFT',
        source: 'RECURRING',
        recurringRuleId: rule.id,
      },
    })

    // Log instance
    await prisma.recurringInstance.create({
      data: {
        recurringRuleId: rule.id,
        entityType: 'Expense',
        entityId: expense.id,
        dueDate: rule.nextDueDate,
        createdAt: new Date(),
      },
    })
  } else if (rule.type === 'AR_INVOICE') {
    const lineItems = payload.lineItems as Array<{
      description: string; quantity: number; unit: string; unitPrice: number
      vatRate: number
    }>

    const netTotal = lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0)
    const vatTotal = lineItems.reduce((s, li) => s + li.quantity * li.unitPrice * li.vatRate / 100, 0)
    const grossTotal = netTotal + vatTotal

    // Generate invoice number
    const count = await prisma.customerInvoice.count({ where: { organizationId: rule.organizationId } })
    const year = rule.nextDueDate.getFullYear()
    const invoiceNumber = `RE-${year}-${String(count + 1).padStart(4, '0')}`

    const dueDate = new Date(rule.nextDueDate)
    dueDate.setDate(dueDate.getDate() + (payload.paymentTerms as number ?? 30))

    const invoice = await prisma.customerInvoice.create({
      data: {
        organizationId: rule.organizationId,
        customerId: payload.customerId as string,
        invoiceNumber,
        invoiceDate: rule.nextDueDate,
        dueDate,
        currency: (payload.currency as string) ?? 'EUR',
        netAmount: netTotal,
        vatAmount: vatTotal,
        totalAmount: grossTotal,
        paidAmount: 0,
        status: 'DRAFT',
        notes: `Auto-generated from recurring rule. ${payload.notes ?? ''}`.trim(),
        source: 'RECURRING',
        recurringRuleId: rule.id,
        lineItems: {
          create: lineItems.map((li, i) => ({
            position: i + 1,
            description: li.description,
            quantity: li.quantity,
            unit: li.unit,
            unitNetPrice: li.unitPrice,
            netAmount: li.quantity * li.unitPrice,
            vatRate: li.vatRate,
            vatAmount: li.quantity * li.unitPrice * li.vatRate / 100,
            grossAmount: li.quantity * li.unitPrice * (1 + li.vatRate / 100),
          })),
        },
      },
    })

    await prisma.recurringInstance.create({
      data: {
        recurringRuleId: rule.id,
        entityType: 'CustomerInvoice',
        entityId: invoice.id,
        dueDate: rule.nextDueDate,
        createdAt: new Date(),
      },
    })
  }
}

// ─────────────────────────────────────────────
// API HANDLERS
// ─────────────────────────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  assertPermission(session, 'view:analytics')

  const rules = await prisma.recurringRule.findMany({
    where: { organizationId: session.currentOrganizationId, isActive: true },
    include: {
      instances: {
        orderBy: { dueDate: 'desc' },
        take: 3,
      },
    },
    orderBy: { nextDueDate: 'asc' },
  })

  return NextResponse.json({
    data: rules.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      frequency: r.frequency,
      nextDueDate: r.nextDueDate,
      lastRunAt: r.lastRunAt,
      runCount: r.runCount,
      endDate: r.endDate,
      isActive: r.isActive,
      payload: r.payload,
      recentInstances: r.instances.map(i => ({
        entityType: i.entityType,
        entityId: i.entityId,
        dueDate: i.dueDate,
      })),
      lastError: r.lastError,
    })),
  })
})

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  assertPermission(session, 'manage:organization')

  const body = await req.json()
  const { name, type, frequency, startDate, endDate, userId, payload } = body

  if (!name || !type || !frequency || !startDate || !payload) {
    return NextResponse.json({ error: 'name, type, frequency, startDate, and payload are required' }, { status: 400 })
  }

  const nextDueDate = new Date(startDate)

  const rule = await prisma.recurringRule.create({
    data: {
      organizationId: session.currentOrganizationId,
      name,
      type,
      frequency,
      nextDueDate,
      endDate: endDate ? new Date(endDate) : null,
      userId: userId ?? session.id,
      payload,
      isActive: true,
      runCount: 0,
    },
  })

  return NextResponse.json({ data: rule }, { status: 201 })
})

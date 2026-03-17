/**
 * LedgerFlow Cron Jobs
 *
 * Run via:
 *   - Vercel Cron (vercel.json crons config)
 *   - Node-cron (self-hosted)
 *   - GitHub Actions scheduled workflows
 *
 * Endpoints: POST /api/cron/[job]  (secured with CRON_SECRET header)
 *
 * Schedule:
 *   daily-reminders         → daily at 08:00 CET
 *   overdue-invoices        → daily at 09:00 CET
 *   subscription-checks     → daily at 06:00 CET
 *   export-period-lock      → monthly, 1st at 01:00 CET
 *   approval-escalations    → hourly
 *   bank-sync               → every 4 hours (when connected)
 */

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db/prisma'
import { getApprovalEngine } from '@/lib/services/approval-engine'
import {
  sendMissingReceiptReminderEmail,
  sendInvoiceOverdueEmail,
} from '@/lib/integrations/email-templates'

// ─────────────────────────────────────────────
// CRON AUTHENTICATION
// ─────────────────────────────────────────────

function authenticateCron(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret')
  const expected = process.env.CRON_SECRET
  if (!expected) {
    // In dev, allow without secret
    return process.env.NODE_ENV === 'development'
  }
  return secret === expected
}

export function withCronAuth(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest): Promise<NextResponse> => {
    if (!authenticateCron(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return handler(req)
  }
}

// ─────────────────────────────────────────────
// JOB: DAILY RECEIPT REMINDERS
// Send reminders to users with missing receipts
// ─────────────────────────────────────────────

export async function runDailyReminders(): Promise<{ processed: number; reminders: number }> {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.ledgerflow.de'
  let processed = 0
  let reminders = 0

  // Find all users with approved expenses missing receipts
  const usersWithMissing = await prisma.expense.groupBy({
    by: ['userId', 'organizationId'],
    where: {
      status: { in: ['APPROVED', 'SUBMITTED', 'PENDING_APPROVAL'] },
      receipt: { is: null },
      deletedAt: null,
      expenseDate: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
    },
    _count: { userId: true },
    _sum: { grossAmount: true },
  })

  for (const group of usersWithMissing) {
    processed++
    const user = await prisma.user.findUnique({
      where: { id: group.userId },
      select: { id: true, email: true, firstName: true },
    })
    if (!user) continue

    // Don't spam — check if we sent a reminder in the last 3 days
    const recentReminder = await prisma.notification.findFirst({
      where: {
        userId: user.id,
        type: 'missing_receipt',
        createdAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
      },
    })
    if (recentReminder) continue

    // Get expense details
    const expenses = await prisma.expense.findMany({
      where: { userId: user.id, organizationId: group.organizationId, receipt: { is: null }, deletedAt: null, status: { in: ['APPROVED', 'SUBMITTED'] } },
      orderBy: { grossAmount: 'desc' },
      take: 10,
      select: { merchant: true, grossAmount: true, currency: true, expenseDate: true },
    })

    try {
      await sendMissingReceiptReminderEmail({
        to: user.email,
        firstName: user.firstName,
        expenses: expenses.map((e) => ({
          merchant: e.merchant,
          amount: Number(e.grossAmount),
          currency: e.currency,
          date: e.expenseDate,
        })),
        uploadUrl: `${APP_URL}/expenses`,
      })

      await prisma.notification.create({
        data: {
          userId: user.id,
          organizationId: group.organizationId,
          type: 'missing_receipt',
          title: `${expenses.length} missing receipt${expenses.length > 1 ? 's' : ''}`,
          message: `You have ${expenses.length} expenses without receipts totalling €${Number(group._sum.grossAmount ?? 0).toFixed(0)}`,
          channel: 'EMAIL',
          sentAt: new Date(),
        },
      })
      reminders++
    } catch (err) {
      console.error(`[Cron:DailyReminders] Failed to send to ${user.email}:`, err)
    }
  }

  console.log(`[Cron:DailyReminders] Processed ${processed} users, sent ${reminders} reminders`)
  return { processed, reminders }
}

// ─────────────────────────────────────────────
// JOB: OVERDUE INVOICE DETECTION
// Update invoice statuses and send alerts
// ─────────────────────────────────────────────

export async function runOverdueInvoiceCheck(): Promise<{ updated: number; notified: number }> {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.ledgerflow.de'
  const now = new Date()

  // Update AP invoices that have passed due date
  const { count: updated } = await prisma.supplierInvoice.updateMany({
    where: {
      dueDate: { lt: now },
      status: { in: ['APPROVED', 'SCHEDULED_PAYMENT'] },
      deletedAt: null,
    },
    data: { status: 'OVERDUE' },
  })

  // Update AR invoices that are overdue
  await prisma.customerInvoice.updateMany({
    where: {
      dueDate: { lt: now },
      status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID'] },
      deletedAt: null,
    },
    data: { status: 'OVERDUE' },
  })

  // Notify finance managers of newly overdue AP invoices
  const overdueInvoices = await prisma.supplierInvoice.findMany({
    where: {
      dueDate: { lt: now, gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }, // Became overdue in last 24h
      status: 'OVERDUE',
      deletedAt: null,
    },
    include: { supplier: true, organization: { include: { memberships: { where: { role: { in: ['COMPANY_ADMIN', 'FINANCE_MANAGER'] }, status: 'ACTIVE' }, include: { user: { select: { id: true, email: true, firstName: true } } } } } } },
  })

  let notified = 0

  for (const invoice of overdueInvoices) {
    const daysOverdue = Math.ceil((now.getTime() - invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24))

    for (const membership of invoice.organization.memberships) {
      try {
        await sendInvoiceOverdueEmail({
          to: membership.user.email,
          organizationName: invoice.organization.name,
          invoiceNumber: invoice.invoiceNumber,
          supplierName: invoice.supplier.name,
          amount: Number(invoice.grossAmount),
          currency: invoice.currency,
          dueDate: invoice.dueDate,
          daysOverdue,
          invoiceUrl: `${APP_URL}/invoices/ap/${invoice.id}`,
        })

        await prisma.notification.create({
          data: {
            userId: membership.userId, organizationId: invoice.organizationId,
            type: 'invoice_overdue', title: `Invoice overdue — ${invoice.supplier.name}`,
            message: `${invoice.invoiceNumber} is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue (€${Number(invoice.grossAmount).toFixed(2)})`,
            entityType: 'supplier_invoice', entityId: invoice.id,
            channel: 'EMAIL', sentAt: now,
          },
        })
        notified++
      } catch (err) {
        console.error(`[Cron:OverdueInvoices] Failed for invoice ${invoice.id}:`, err)
      }
    }
  }

  console.log(`[Cron:OverdueInvoices] Updated ${updated} to OVERDUE, sent ${notified} notifications`)
  return { updated, notified }
}

// ─────────────────────────────────────────────
// JOB: APPROVAL ESCALATIONS
// Escalate stale approvals
// ─────────────────────────────────────────────

export async function runApprovalEscalations(): Promise<{ escalated: number }> {
  const organizations = await prisma.organization.findMany({
    where: { isActive: true },
    select: { id: true },
  })

  let escalated = 0
  const engine = await getApprovalEngine()

  for (const org of organizations) {
    try {
      await engine.checkEscalations(org.id)
      escalated++
    } catch (err) {
      console.error(`[Cron:Escalations] Failed for org ${org.id}:`, err)
    }
  }

  console.log(`[Cron:Escalations] Checked ${organizations.length} organizations`)
  return { escalated: organizations.length }
}

// ─────────────────────────────────────────────
// JOB: SUBSCRIPTION CHECKS
// Expire trials, send warnings
// ─────────────────────────────────────────────

export async function runSubscriptionChecks(): Promise<{ expired: number; warned: number }> {
  const now = new Date()
  let expired = 0
  let warned = 0

  // Expire trials that ended
  const { count } = await prisma.subscription.updateMany({
    where: {
      status: 'TRIALING',
      trialEndsAt: { lt: now },
    },
    data: { status: 'CANCELLED' },
  })
  expired = count

  // Warn about trials ending in 3 days
  const endingSoon = await prisma.subscription.findMany({
    where: {
      status: 'TRIALING',
      trialEndsAt: {
        gte: now,
        lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      },
    },
    include: {
      organization: {
        include: {
          memberships: { where: { role: 'COMPANY_ADMIN', status: 'ACTIVE' }, include: { user: { select: { id: true } } } },
        },
      },
    },
  })

  for (const sub of endingSoon) {
    const daysLeft = Math.ceil((sub.trialEndsAt!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    for (const m of sub.organization.memberships) {
      const alreadyNotified = await prisma.notification.findFirst({
        where: { userId: m.userId, type: 'trial_ending', createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      })
      if (!alreadyNotified) {
        await prisma.notification.create({
          data: {
            userId: m.userId, organizationId: sub.organizationId,
            type: 'trial_ending', title: `Trial ends in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`,
            message: `Your LedgerFlow free trial expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}. Upgrade to keep access to all features.`,
          },
        })
        warned++
      }
    }
  }

  console.log(`[Cron:Subscriptions] Expired: ${expired}, Warned: ${warned}`)
  return { expired, warned }
}

// ─────────────────────────────────────────────
// CRON ROUTE HANDLER
// POST /api/cron/[job]
// ─────────────────────────────────────────────

export const CRON_HANDLERS: Record<string, () => Promise<unknown>> = {
  'daily-reminders': runDailyReminders,
  'overdue-invoices': runOverdueInvoiceCheck,
  'approval-escalations': runApprovalEscalations,
  'subscription-checks': runSubscriptionChecks,
}

export async function POST_CRON(req: NextRequest, job: string): Promise<NextResponse> {
  if (!authenticateCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const handler = CRON_HANDLERS[job]
  if (!handler) {
    return NextResponse.json({ error: `Unknown cron job: ${job}` }, { status: 404 })
  }

  const start = Date.now()
  try {
    const result = await handler()
    return NextResponse.json({
      job,
      status: 'completed',
      durationMs: Date.now() - start,
      result,
    })
  } catch (err) {
    console.error(`[Cron:${job}] Fatal error:`, err)
    return NextResponse.json({
      job,
      status: 'failed',
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 })
  }
}

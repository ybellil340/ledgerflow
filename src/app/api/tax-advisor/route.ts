import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

// ─── GET /api/tax-advisor/portfolio ──────────
// Returns all client companies the advisor has access to

export const GET_PORTFOLIO = withAuth(async (req: NextRequest, session: SessionUser) => {
  if (!session.isTaxAdvisor && !['COMPANY_ADMIN', 'SUPER_ADMIN'].includes(session.currentRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Get all organizations the tax advisor has access to
  const links = await prisma.taxAdvisorClientLink.findMany({
    where: {
      firmId: session.taxAdvisorFirmId ?? undefined,
      isActive: true,
      ...(session.isTaxAdvisor ? {} : { organizationId: session.currentOrganizationId }),
    },
    include: {
      organization: {
        select: {
          id: true, name: true, legalName: true, vatId: true,
          legalForm: true, city: true, industry: true,
        },
      },
    },
  })

  // For each org, compute health metrics
  const portfolioItems = await Promise.all(links.map(async (link) => {
    const orgId = link.organizationId
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [
      missingReceipts,
      uncategorized,
      vatAnomalies,
      unexportedExpenses,
      unreviewedComments,
      lastExport,
    ] = await Promise.all([
      // Expenses without receipts
      prisma.expense.count({
        where: { organizationId: orgId, status: { in: ['APPROVED'] }, receipt: { is: null }, deletedAt: null },
      }),
      // Uncategorized transactions
      prisma.transaction.count({
        where: { organizationId: orgId, status: 'UNCATEGORIZED' },
      }),
      // VAT anomalies: approved expenses with no VAT code
      prisma.expense.count({
        where: { organizationId: orgId, status: { in: ['APPROVED', 'EXPORTED'] }, vatCodeId: null, grossAmount: { gt: 50 }, deletedAt: null },
      }),
      // Approved but not yet exported
      prisma.expense.count({
        where: { organizationId: orgId, status: 'APPROVED', exportBatchId: null, deletedAt: null },
      }),
      // Comments needing review (external-visible, unread)
      prisma.comment.count({
        where: {
          entityType: { in: ['expense', 'supplier_invoice', 'customer_invoice'] },
          visibility: 'EXTERNAL',
          // In a real system: filter by unread for this advisor
        },
      }),
      // Last export
      prisma.exportBatch.findFirst({
        where: { organizationId: orgId, status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, periodEnd: true, format: true },
      }),
    ])

    // Determine unexported periods
    const unexportedPeriods: string[] = []
    if (unexportedExpenses > 0) {
      const oldest = await prisma.expense.findFirst({
        where: { organizationId: orgId, status: 'APPROVED', exportBatchId: null, deletedAt: null },
        orderBy: { expenseDate: 'asc' },
        select: { expenseDate: true },
      })
      if (oldest) {
        const d = oldest.expenseDate
        unexportedPeriods.push(`${d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`)
      }
    }

    return {
      organization: link.organization,
      permissions: { canExport: link.canExport, canComment: link.canComment, canLockPeriods: link.canLockPeriods },
      metrics: {
        missingDocuments: missingReceipts,
        uncategorizedTransactions: uncategorized,
        vatAnomalies,
        unexportedExpenses,
        unexportedPeriods,
        unreviewedComments,
        lastExportDate: lastExport?.createdAt?.toISOString().slice(0, 10),
        lastExportFormat: lastExport?.format,
      },
      healthScore: computeHealthScore({ missingReceipts, uncategorized, vatAnomalies, unexportedExpenses }),
    }
  }))

  return NextResponse.json({ data: portfolioItems })
}, 'manage:tax_advisor')

// ─── GET /api/tax-advisor/review/:orgId ──────
// Tax advisor review queue for a specific client

export const GET_REVIEW_QUEUE = withAuth(async (req: NextRequest, session: SessionUser) => {
  const orgId = req.url.split('/review/')[1]?.split('?')[0]
  if (!orgId) return NextResponse.json({ error: 'Organization ID required' }, { status: 400 })

  // Verify access
  if (session.isTaxAdvisor) {
    const link = await prisma.taxAdvisorClientLink.findFirst({
      where: { organizationId: orgId, firmId: session.taxAdvisorFirmId, isActive: true },
    })
    if (!link) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'all'

  const [missingReceipts, vatIssues, uncategorized, pendingExport, overdueAP] = await Promise.all([
    // Approved expenses without receipts
    prisma.expense.findMany({
      where: { organizationId: orgId, status: 'APPROVED', receipt: { is: null }, deletedAt: null },
      include: { user: { select: { firstName: true, lastName: true } }, department: true },
      orderBy: { expenseDate: 'desc' },
      take: 20,
    }),

    // VAT anomalies
    prisma.expense.findMany({
      where: { organizationId: orgId, status: { in: ['APPROVED'] }, vatCodeId: null, grossAmount: { gt: 50 }, deletedAt: null },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { grossAmount: 'desc' },
      take: 20,
    }),

    // Uncategorized transactions
    prisma.transaction.findMany({
      where: { organizationId: orgId, status: 'UNCATEGORIZED' },
      include: { card: { select: { lastFour: true, user: { select: { firstName: true, lastName: true } } } } },
      orderBy: { transactionDate: 'desc' },
      take: 20,
    }),

    // Approved expenses ready to export
    prisma.expense.findMany({
      where: { organizationId: orgId, status: 'APPROVED', exportBatchId: null, deletedAt: null },
      include: { vatCode: true, department: true },
      orderBy: { expenseDate: 'asc' },
      take: 50,
    }),

    // Overdue AP invoices
    prisma.supplierInvoice.findMany({
      where: {
        organizationId: orgId,
        status: { notIn: ['PAID', 'CANCELLED', 'EXPORTED'] },
        dueDate: { lt: new Date() },
        deletedAt: null,
      },
      include: { supplier: true },
      orderBy: { dueDate: 'asc' },
      take: 10,
    }),
  ])

  return NextResponse.json({
    data: { missingReceipts, vatIssues, uncategorized, pendingExport, overdueAP },
    counts: {
      missingReceipts: missingReceipts.length,
      vatIssues: vatIssues.length,
      uncategorized: uncategorized.length,
      pendingExport: pendingExport.length,
      overdueAP: overdueAP.length,
    },
  })
}, 'manage:tax_advisor')

// ─── POST /api/tax-advisor/comment ───────────

const CommentSchema = z.object({
  organizationId: z.string().cuid(),
  entityType: z.string(),
  entityId: z.string().cuid(),
  content: z.string().min(1).max(5000),
  visibility: z.enum(['INTERNAL', 'EXTERNAL']).default('EXTERNAL'),
  // Optional: request a document
  requestDocument: z.boolean().optional(),
})

export const POST_COMMENT = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const data = CommentSchema.parse(body)

  // Verify advisor has access to this org
  if (session.isTaxAdvisor) {
    const link = await prisma.taxAdvisorClientLink.findFirst({
      where: { organizationId: data.organizationId, firmId: session.taxAdvisorFirmId, isActive: true },
    })
    if (!link || !link.canComment) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const comment = await prisma.comment.create({
    data: {
      authorId: session.id,
      content: data.content,
      visibility: data.visibility,
      entityType: data.entityType,
      entityId: data.entityId,
      ...(data.entityType === 'expense' ? { expenseId: data.entityId } : {}),
      ...(data.entityType === 'supplier_invoice' ? { supplierInvoiceId: data.entityId } : {}),
      ...(data.entityType === 'customer_invoice' ? { customerInvoiceId: data.entityId } : {}),
    },
    include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
  })

  // Notify finance team if comment is from advisor
  if (session.isTaxAdvisor) {
    const admins = await prisma.organizationMembership.findMany({
      where: { organizationId: data.organizationId, role: { in: ['COMPANY_ADMIN', 'FINANCE_MANAGER'] }, status: 'ACTIVE' },
    })
    for (const admin of admins) {
      await prisma.notification.create({
        data: {
          userId: admin.userId, organizationId: data.organizationId,
          type: 'tax_advisor_comment', title: 'Tax advisor comment',
          message: `${session.firstName} ${session.lastName} left a comment on a ${data.entityType.replace('_', ' ')}`,
          entityType: data.entityType, entityId: data.entityId,
        },
      })
    }
  }

  // If document request, create missing receipt notification
  if (data.requestDocument) {
    if (data.entityType === 'expense') {
      const expense = await prisma.expense.findUnique({ where: { id: data.entityId } })
      if (expense) {
        await prisma.notification.create({
          data: {
            userId: expense.userId, organizationId: data.organizationId,
            type: 'missing_receipt', title: 'Receipt requested',
            message: `Your tax advisor requests a receipt for expense at ${expense.merchant}`,
            entityType: 'expense', entityId: data.entityId,
          },
        })
      }
    }
  }

  return NextResponse.json({ data: comment }, { status: 201 })
}, 'manage:tax_advisor')

// ─── POST /api/tax-advisor/lock-period ───────

const LockPeriodSchema = z.object({
  organizationId: z.string().cuid(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  locked: z.boolean(),
})

export const POST_LOCK = withAuth(async (req: NextRequest, session: SessionUser) => {
  const body = await req.json()
  const data = LockPeriodSchema.parse(body)

  // Only advisors with lock permission or company admins
  if (session.isTaxAdvisor) {
    const link = await prisma.taxAdvisorClientLink.findFirst({
      where: { organizationId: data.organizationId, firmId: session.taxAdvisorFirmId, isActive: true },
    })
    if (!link || !link.canLockPeriods) return NextResponse.json({ error: 'Not authorized to lock periods' }, { status: 403 })
  }

  // Find all export batches in this period and lock/unlock them
  await prisma.exportBatch.updateMany({
    where: {
      organizationId: data.organizationId,
      periodStart: { gte: new Date(data.periodStart) },
      periodEnd: { lte: new Date(data.periodEnd) },
    },
    data: {
      isLocked: data.locked,
      lockedAt: data.locked ? new Date() : null,
    },
  })

  await prisma.auditLog.create({
    data: {
      organizationId: data.organizationId, actorId: session.id,
      action: 'PERIOD_LOCK', entityType: 'export_batch', entityId: 'period',
      after: { locked: data.locked, periodStart: data.periodStart, periodEnd: data.periodEnd },
    },
  })

  return NextResponse.json({
    data: { locked: data.locked, period: `${data.periodStart.slice(0, 10)} – ${data.periodEnd.slice(0, 10)}` },
  })
}, 'manage:tax_advisor')

// ─── HEALTH SCORE ────────────────────────────

function computeHealthScore(metrics: {
  missingReceipts: number
  uncategorized: number
  vatAnomalies: number
  unexportedExpenses: number
}): number {
  let score = 100
  score -= Math.min(metrics.missingReceipts * 2, 30)
  score -= Math.min(metrics.uncategorized * 1, 20)
  score -= Math.min(metrics.vatAnomalies * 3, 30)
  score -= Math.min(metrics.unexportedExpenses * 0.5, 20)
  return Math.max(0, Math.round(score))
}

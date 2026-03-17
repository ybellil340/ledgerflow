/**
 * GET  /api/settings/company  — get company profile + all settings
 * PATCH /api/settings/company  — update company profile
 * PATCH /api/settings/company/approval-policies — configure approval rules
 * PATCH /api/settings/company/datev — DATEV-specific settings
 * PATCH /api/settings/company/notifications — org-level notification preferences
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { assertPermission } from '@/lib/auth/rbac'
import { validateGermanVATId } from '@/lib/security'
import type { SessionUser } from '@/types'

// ─────────────────────────────────────────────
// GET /api/settings/company
// ─────────────────────────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  assertPermission(session, 'view:analytics')

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.currentOrganizationId },
    include: {
      approvalPolicies: {
        where: { isActive: true },
        orderBy: { threshold: 'asc' },
      },
      _count: {
        select: {
          members: { where: { status: 'ACTIVE' } },
          expenses: true,
          supplierInvoices: true,
          customerInvoices: true,
        },
      },
    },
  })

  return NextResponse.json({
    data: {
      // Company profile
      id: org.id,
      name: org.name,
      legalForm: org.legalForm,
      registrationNumber: org.registrationNumber,
      vatId: org.vatId,
      taxNumber: org.taxNumber,
      address: {
        street: org.street,
        city: org.city,
        postalCode: org.postalCode,
        state: org.state,
        country: org.country,
      },
      contact: {
        email: org.email,
        phone: org.phone,
        website: org.website,
      },
      // DATEV
      datev: {
        consultantNumber: org.datevConsultantNumber,
        clientNumber: org.datevClientNumber,
        skrVersion: org.skrVersion ?? 'SKR03',
        fiscalYearStart: org.fiscalYearStart ?? '01-01',
        vatPeriod: org.vatPeriod ?? 'MONTHLY',
        exportCurrency: org.exportCurrency ?? 'EUR',
        lastExportAt: org.lastDATEVExportAt,
      },
      // Approval config
      approvalPolicies: org.approvalPolicies,
      // Banking
      defaultCurrency: org.defaultCurrency ?? 'EUR',
      supportedCurrencies: org.supportedCurrencies ?? ['EUR'],
      // Subscription
      plan: org.plan,
      onboardingComplete: org.onboardingComplete,
      // Stats
      stats: {
        activeMembers: org._count.members,
        totalExpenses: org._count.expenses,
        totalAPInvoices: org._count.supplierInvoices,
        totalARInvoices: org._count.customerInvoices,
      },
    },
  })
})

// ─────────────────────────────────────────────
// PATCH /api/settings/company
// ─────────────────────────────────────────────

export const PATCH = withAuth(async (req: NextRequest, session: SessionUser) => {
  assertPermission(session, 'manage:organization')

  const body = await req.json()
  const { section, ...data } = body

  switch (section) {
    case 'profile':
      return updateProfile(session.currentOrganizationId, data)
    case 'datev':
      return updateDATEV(session.currentOrganizationId, data)
    case 'approval_policies':
      return updateApprovalPolicies(session.currentOrganizationId, data, session)
    case 'currencies':
      return updateCurrencies(session.currentOrganizationId, data)
    default:
      return NextResponse.json({ error: 'Unknown settings section' }, { status: 400 })
  }
})

async function updateProfile(orgId: string, data: Record<string, unknown>) {
  // Validate German VAT ID if provided
  if (data.vatId && typeof data.vatId === 'string') {
    const vatValid = validateGermanVATId(data.vatId)
    if (!vatValid.valid) {
      return NextResponse.json({ error: `Invalid VAT ID: ${vatValid.reason}` }, { status: 400 })
    }
  }

  const org = await prisma.organization.update({
    where: { id: orgId },
    data: {
      name: data.name as string | undefined,
      legalForm: data.legalForm as string | undefined,
      registrationNumber: data.registrationNumber as string | undefined,
      vatId: data.vatId as string | undefined,
      taxNumber: data.taxNumber as string | undefined,
      street: (data.address as Record<string, string> | undefined)?.street,
      city: (data.address as Record<string, string> | undefined)?.city,
      postalCode: (data.address as Record<string, string> | undefined)?.postalCode,
      state: (data.address as Record<string, string> | undefined)?.state,
      country: (data.address as Record<string, string> | undefined)?.country,
      email: (data.contact as Record<string, string> | undefined)?.email,
      phone: (data.contact as Record<string, string> | undefined)?.phone,
      website: (data.contact as Record<string, string> | undefined)?.website,
      updatedAt: new Date(),
    },
  })

  // Audit log
  await prisma.auditLog.create({
    data: {
      organizationId: orgId,
      action: 'ORG_PROFILE_UPDATED',
      entityType: 'Organization',
      entityId: orgId,
      metadata: { changedFields: Object.keys(data) },
    },
  })

  return NextResponse.json({ data: { success: true, name: org.name } })
}

async function updateDATEV(orgId: string, data: Record<string, unknown>) {
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      datevConsultantNumber: data.consultantNumber as string | undefined,
      datevClientNumber: data.clientNumber as string | undefined,
      skrVersion: data.skrVersion as string | undefined,
      fiscalYearStart: data.fiscalYearStart as string | undefined,
      vatPeriod: data.vatPeriod as string | undefined,
      exportCurrency: data.exportCurrency as string | undefined,
    },
  })

  return NextResponse.json({ data: { success: true } })
}

async function updateApprovalPolicies(
  orgId: string,
  data: Record<string, unknown>,
  session: SessionUser
) {
  const { policies } = data as {
    policies: Array<{
      id?: string
      name: string
      threshold: number
      requiresReceiptAbove: number
      steps: Array<{
        level: number
        approverRole?: string
        approverId?: string
        timeoutHours?: number
      }>
    }>
  }

  if (!Array.isArray(policies)) {
    return NextResponse.json({ error: 'policies must be an array' }, { status: 400 })
  }

  // Replace all policies in a transaction
  await prisma.$transaction([
    // Deactivate existing
    prisma.approvalPolicy.updateMany({
      where: { organizationId: orgId },
      data: { isActive: false },
    }),
    // Upsert new
    ...policies.map((p) =>
      prisma.approvalPolicy.upsert({
        where: { id: p.id ?? 'new' },
        create: {
          organizationId: orgId,
          name: p.name,
          threshold: p.threshold,
          requiresReceiptAbove: p.requiresReceiptAbove,
          isActive: true,
          steps: { create: p.steps },
        },
        update: {
          name: p.name,
          threshold: p.threshold,
          requiresReceiptAbove: p.requiresReceiptAbove,
          isActive: true,
        },
      })
    ),
  ])

  await prisma.auditLog.create({
    data: {
      organizationId: orgId,
      action: 'APPROVAL_POLICIES_UPDATED',
      entityType: 'Organization',
      entityId: orgId,
      metadata: { policyCount: policies.length, updatedBy: session.id },
    },
  })

  return NextResponse.json({ data: { success: true, policyCount: policies.length } })
}

async function updateCurrencies(orgId: string, data: Record<string, unknown>) {
  const { defaultCurrency, supportedCurrencies } = data as {
    defaultCurrency: string
    supportedCurrencies: string[]
  }

  if (!supportedCurrencies.includes(defaultCurrency)) {
    return NextResponse.json({ error: 'defaultCurrency must be in supportedCurrencies' }, { status: 400 })
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { defaultCurrency, supportedCurrencies },
  })

  return NextResponse.json({ data: { success: true } })
}

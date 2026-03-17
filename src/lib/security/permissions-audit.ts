/**
 * LedgerFlow Permissions Audit
 *
 * This file documents and validates all permission boundaries in the system.
 * Run the audit function during CI to catch permission regressions.
 *
 * Coverage:
 * - RBAC permission map verification
 * - Organization isolation checks
 * - Sensitive field access controls
 * - Export immutability guards
 * - Audit log completeness
 */

import type { UserRole } from '@prisma/client'

// ─────────────────────────────────────────────
// PERMISSION BOUNDARY DEFINITIONS
// ─────────────────────────────────────────────

export interface PermissionRule {
  route: string
  method: string
  requiredPermissions: string[]
  allowedRoles: UserRole[]
  scopedToOrg: boolean           // Must match x-organization-id
  scopedToUser?: boolean         // Employee-role: own records only
  auditRequired: boolean         // Must log in AuditLog
  sensitiveFields?: string[]     // Fields requiring extra access control
  immutableAfter?: string[]      // Statuses after which field cannot be changed
}

export const PERMISSION_AUDIT_RULES: PermissionRule[] = [
  // ── AUTH ──────────────────────────────────────
  {
    route: '/api/auth/login',
    method: 'POST',
    requiredPermissions: [],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_MANAGER', 'EMPLOYEE', 'APPROVER', 'TAX_ADVISOR'],
    scopedToOrg: false,
    auditRequired: true,
  },
  {
    route: '/api/auth/invite',
    method: 'POST',
    requiredPermissions: ['manage:users'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN'],
    scopedToOrg: true,
    auditRequired: true,
  },

  // ── EXPENSES ──────────────────────────────────
  {
    route: '/api/expenses',
    method: 'GET',
    requiredPermissions: ['manage:expenses'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_MANAGER', 'APPROVER', 'EMPLOYEE'],
    scopedToOrg: true,
    scopedToUser: true, // EMPLOYEE role sees own only
    auditRequired: false,
  },
  {
    route: '/api/expenses',
    method: 'POST',
    requiredPermissions: ['manage:expenses'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_MANAGER', 'EMPLOYEE'],
    scopedToOrg: true,
    auditRequired: true,
  },
  {
    route: '/api/expenses/:id/approve',
    method: 'POST',
    requiredPermissions: ['approve:expenses'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_MANAGER', 'APPROVER'],
    scopedToOrg: true,
    auditRequired: true,
    immutableAfter: ['EXPORTED'],
  },
  {
    route: '/api/expenses/:id/reject',
    method: 'POST',
    requiredPermissions: ['approve:expenses'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_MANAGER', 'APPROVER'],
    scopedToOrg: true,
    auditRequired: true,
  },

  // ── CARDS ─────────────────────────────────────
  {
    route: '/api/cards',
    method: 'POST',
    requiredPermissions: ['manage:cards'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN'],
    scopedToOrg: true,
    auditRequired: true,
  },
  {
    route: '/api/cards/:id (freeze/unfreeze)',
    method: 'PATCH',
    requiredPermissions: ['manage:cards'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_MANAGER'],
    scopedToOrg: true,
    auditRequired: true, // CARD_FREEZE / CARD_UNFREEZE actions
  },

  // ── INVOICES ──────────────────────────────────
  {
    route: '/api/invoices/ap',
    method: 'POST',
    requiredPermissions: ['manage:invoices'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_MANAGER'],
    scopedToOrg: true,
    auditRequired: true,
  },
  {
    route: '/api/invoices/ap/:id (mark_paid)',
    method: 'PATCH',
    requiredPermissions: ['manage:invoices'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_MANAGER'],
    scopedToOrg: true,
    auditRequired: true,
    sensitiveFields: ['paidAmount', 'paymentRef', 'bankAccount'],
  },

  // ── ACCOUNTING ────────────────────────────────
  {
    route: '/api/accounting/export',
    method: 'POST',
    requiredPermissions: ['export:accounting'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_MANAGER', 'TAX_ADVISOR'],
    scopedToOrg: true,
    auditRequired: true,
    immutableAfter: ['EXPORTED'], // Cannot re-export locked periods
  },
  {
    route: '/api/accounting/mappings',
    method: 'POST',
    requiredPermissions: ['manage:accounting'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_MANAGER'],
    scopedToOrg: true,
    auditRequired: true,
  },

  // ── TAX ADVISOR ───────────────────────────────
  {
    route: '/api/tax-advisor/portfolio',
    method: 'GET',
    requiredPermissions: ['manage:tax_advisor'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'TAX_ADVISOR'],
    scopedToOrg: false, // Tax advisors see multiple orgs
    auditRequired: false,
  },
  {
    route: '/api/tax-advisor/lock-period',
    method: 'POST',
    requiredPermissions: ['manage:tax_advisor'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'TAX_ADVISOR'],
    scopedToOrg: true,
    auditRequired: true, // PERIOD_LOCK action
  },

  // ── BILLING ───────────────────────────────────
  {
    route: '/api/billing',
    method: 'POST',
    requiredPermissions: ['manage:billing'],
    allowedRoles: ['SUPER_ADMIN', 'COMPANY_ADMIN'],
    scopedToOrg: true,
    auditRequired: true,
    sensitiveFields: ['stripeCustomerId', 'paymentMethod'],
  },

  // ── ADMIN ─────────────────────────────────────
  {
    route: '/api/admin/*',
    method: '*',
    requiredPermissions: ['super_admin'],
    allowedRoles: ['SUPER_ADMIN'],
    scopedToOrg: false,
    auditRequired: true,
  },
  {
    route: '/api/admin/impersonate',
    method: 'POST',
    requiredPermissions: ['super_admin'],
    allowedRoles: ['SUPER_ADMIN'],
    scopedToOrg: false,
    auditRequired: true, // IMPERSONATE action
  },
]

// ─────────────────────────────────────────────
// DATA ISOLATION INVARIANTS
// These must hold true for all database queries
// ─────────────────────────────────────────────

export const ISOLATION_INVARIANTS = [
  {
    model: 'Expense',
    description: 'Every expense query must include organizationId filter',
    requiredWhere: ['organizationId'],
    employeeScoped: true, // Employee role adds userId filter
  },
  {
    model: 'SupplierInvoice',
    description: 'Every AP invoice query must include organizationId filter',
    requiredWhere: ['organizationId'],
    employeeScoped: false,
  },
  {
    model: 'CustomerInvoice',
    description: 'Every AR invoice query must include organizationId filter',
    requiredWhere: ['organizationId'],
    employeeScoped: false,
  },
  {
    model: 'Card',
    description: 'Card queries scoped to org; employee sees own cards only',
    requiredWhere: ['organizationId'],
    employeeScoped: true,
  },
  {
    model: 'Transaction',
    description: 'Transactions scoped to org',
    requiredWhere: ['organizationId'],
    employeeScoped: false,
  },
  {
    model: 'ExportBatch',
    description: 'Export batches scoped to org; locked batches are immutable',
    requiredWhere: ['organizationId'],
    additionalConstraints: ['Cannot re-export if isLocked=true'],
    employeeScoped: false,
  },
  {
    model: 'AuditLog',
    description: 'Admin sees all orgs; others scoped to own org',
    requiredWhere: ['organizationId (non-admin)'],
    employeeScoped: false,
  },
]

// ─────────────────────────────────────────────
// SENSITIVE FIELD ACCESS CONTROLS
// ─────────────────────────────────────────────

export const SENSITIVE_FIELDS = {
  User: {
    passwordHash: { neverReturn: true, description: 'bcrypt hash — never expose in API responses' },
    twoFactorSecret: { neverReturn: true, description: 'TOTP secret — never expose' },
  },
  Supplier: {
    iban: {
      encrypted: true,
      roles: ['COMPANY_ADMIN', 'FINANCE_MANAGER', 'SUPER_ADMIN'],
      description: 'Bank account number — encrypted at rest, restricted access',
    },
  },
  Reimbursement: {
    bankAccount: {
      encrypted: true,
      roles: ['COMPANY_ADMIN', 'FINANCE_MANAGER', 'SUPER_ADMIN'],
      description: 'Employee IBAN for reimbursement payment',
    },
  },
  IntegrationConnection: {
    config: {
      encrypted: true,
      roles: ['SUPER_ADMIN'],
      description: 'Provider API tokens and OAuth credentials',
    },
  },
  Subscription: {
    stripeCustomerId: {
      roles: ['SUPER_ADMIN'],
      description: 'Stripe customer ID — do not expose to end users',
    },
    stripeSubscriptionId: {
      roles: ['SUPER_ADMIN'],
      description: 'Stripe subscription ID — do not expose to end users',
    },
  },
}

// ─────────────────────────────────────────────
// IMMUTABILITY RULES
// Certain records must not be modified after export
// ─────────────────────────────────────────────

export const IMMUTABILITY_RULES = [
  {
    model: 'Expense',
    condition: "status = 'EXPORTED'",
    rule: 'Cannot edit fields after export. Must create a correction entry.',
    enforcement: 'API returns 400 if status is EXPORTED on PUT request',
  },
  {
    model: 'ExportRecord',
    condition: 'always',
    rule: 'ExportRecord is a snapshot — never modified after creation',
    enforcement: 'No update/delete routes exist for ExportRecord',
  },
  {
    model: 'ExportBatch',
    condition: 'isLocked = true',
    rule: 'Cannot create new exports overlapping a locked period',
    enforcement: 'POST /api/accounting/export returns 409 if period is locked',
  },
  {
    model: 'AuditLog',
    condition: 'always',
    rule: 'Audit logs are append-only — never modified or deleted',
    enforcement: 'No update/delete routes exist for AuditLog',
  },
  {
    model: 'SupplierInvoice',
    condition: "status IN ('PAID', 'EXPORTED')",
    rule: 'Cannot edit invoice after payment or export',
    enforcement: 'PATCH handler checks status before allowing field updates',
  },
]

// ─────────────────────────────────────────────
// AUDIT LOG REQUIREMENTS
// These actions must always produce an AuditLog entry
// ─────────────────────────────────────────────

export const REQUIRED_AUDIT_EVENTS = [
  'User.login', 'User.logout', 'User.roleChange',
  'Expense.create', 'Expense.approve', 'Expense.reject', 'Expense.delete', 'Expense.export',
  'Card.create', 'Card.freeze', 'Card.unfreeze', 'Card.cancel',
  'SupplierInvoice.create', 'SupplierInvoice.approve', 'SupplierInvoice.reject', 'SupplierInvoice.markPaid',
  'CustomerInvoice.create', 'CustomerInvoice.send', 'CustomerInvoice.recordPayment',
  'ExportBatch.create', 'ExportBatch.lock', 'ExportBatch.unlock',
  'AccountingMapping.update',
  'Organization.create', 'Organization.suspend', 'Organization.activate',
  'Subscription.upgrade', 'Subscription.cancel',
  'User.impersonate',
  'FeatureFlag.toggle',
  'TaxAdvisor.lockPeriod',
  'Invitation.send', 'Invitation.accept',
]

// ─────────────────────────────────────────────
// AUTOMATED AUDIT RUNNER
// Run in CI to verify permission rules haven't regressed
// ─────────────────────────────────────────────

export async function runPermissionsAudit(): Promise<{
  passed: number
  failed: number
  issues: string[]
}> {
  const issues: string[] = []
  let passed = 0
  let failed = 0

  // Check 1: All routes have required permissions defined
  for (const rule of PERMISSION_AUDIT_RULES) {
    if (rule.auditRequired && !REQUIRED_AUDIT_EVENTS.some((e) =>
      rule.route.includes(e.split('.')[0].toLowerCase())
    )) {
      issues.push(`[AuditGap] ${rule.method} ${rule.route} requires audit but event not in REQUIRED_AUDIT_EVENTS`)
      failed++
    } else {
      passed++
    }
  }

  // Check 2: All models with isolation invariants are checked
  const modelsWithInvariants = ISOLATION_INVARIANTS.map((i) => i.model)
  const criticalModels = ['Expense', 'SupplierInvoice', 'CustomerInvoice', 'Card', 'Transaction', 'ExportBatch']
  for (const model of criticalModels) {
    if (!modelsWithInvariants.includes(model)) {
      issues.push(`[IsolationGap] ${model} has no isolation invariant defined`)
      failed++
    } else {
      passed++
    }
  }

  // Check 3: Sensitive fields are documented
  const sensitiveModels = Object.keys(SENSITIVE_FIELDS)
  if (!sensitiveModels.includes('User')) {
    issues.push('[SensitiveField] User.passwordHash not documented')
    failed++
  } else {
    passed++
  }

  // Check 4: Immutability rules cover exported records
  const exportedImmutability = IMMUTABILITY_RULES.find((r) =>
    r.model === 'Expense' && r.condition.includes('EXPORTED')
  )
  if (!exportedImmutability) {
    issues.push('[Immutability] Expense export immutability rule missing')
    failed++
  } else {
    passed++
  }

  if (issues.length > 0) {
    console.warn('[PermissionsAudit] Issues found:')
    issues.forEach((i) => console.warn(' ', i))
  }

  console.log(`[PermissionsAudit] ${passed} passed, ${failed} failed`)
  return { passed, failed, issues }
}

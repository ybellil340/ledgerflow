import type { UserRole, Permission, SessionUser } from '@/types'

// ─────────────────────────────────────────────
// ROLE → PERMISSIONS MAP
// ─────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: [
    'super_admin',
    'manage:organization',
    'manage:users',
    'manage:cards',
    'manage:expenses',
    'manage:invoices',
    'manage:accounting',
    'manage:billing',
    'view:analytics',
    'approve:expenses',
    'approve:invoices',
    'approve:reimbursements',
    'export:accounting',
    'manage:tax_advisor',
  ],

  COMPANY_ADMIN: [
    'manage:organization',
    'manage:users',
    'manage:cards',
    'manage:expenses',
    'manage:invoices',
    'manage:accounting',
    'manage:billing',
    'view:analytics',
    'approve:expenses',
    'approve:invoices',
    'approve:reimbursements',
    'export:accounting',
    'manage:tax_advisor',
  ],

  FINANCE_MANAGER: [
    'manage:expenses',
    'manage:invoices',
    'manage:accounting',
    'view:analytics',
    'approve:expenses',
    'approve:invoices',
    'approve:reimbursements',
    'export:accounting',
  ],

  APPROVER: [
    'approve:expenses',
    'approve:invoices',
    'approve:reimbursements',
    'view:analytics',
  ],

  EMPLOYEE: [
    'manage:expenses', // own only
  ],

  TAX_ADVISOR: [
    'view:analytics',
    'export:accounting',
    'manage:tax_advisor',
  ],
}

// ─────────────────────────────────────────────
// PERMISSION CHECKS
// ─────────────────────────────────────────────

export function getPermissionsForRole(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? []
}

export function hasPermission(user: SessionUser, permission: Permission): boolean {
  if (user.isSuperAdmin) return true
  return user.permissions.includes(permission)
}

export function hasAnyPermission(user: SessionUser, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(user, p))
}

export function hasAllPermissions(user: SessionUser, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(user, p))
}

// Scoped checks — some actions are only allowed on own resources for lower roles
export function canManageExpense(user: SessionUser, expenseOwnerId: string): boolean {
  if (hasPermission(user, 'super_admin')) return true
  if (hasPermission(user, 'manage:expenses')) {
    // Finance managers and above can manage any expense
    if (['COMPANY_ADMIN', 'FINANCE_MANAGER', 'SUPER_ADMIN'].includes(user.currentRole)) return true
    // Employees can only manage their own
    return user.id === expenseOwnerId
  }
  return false
}

export function canApproveExpense(user: SessionUser): boolean {
  return hasPermission(user, 'approve:expenses')
}

export function canExportAccounting(user: SessionUser): boolean {
  return hasPermission(user, 'export:accounting')
}

export function canManageUsers(user: SessionUser): boolean {
  return hasPermission(user, 'manage:users')
}

export function canManageBilling(user: SessionUser): boolean {
  return hasPermission(user, 'manage:billing')
}

export function canAccessAdmin(user: SessionUser): boolean {
  return hasPermission(user, 'super_admin')
}

export function canAccessTaxAdvisorPortal(user: SessionUser): boolean {
  return user.isTaxAdvisor || hasPermission(user, 'manage:tax_advisor')
}

// ─────────────────────────────────────────────
// ROUTE GUARDS
// ─────────────────────────────────────────────

export const ROUTE_PERMISSIONS: Record<string, Permission[]> = {
  '/dashboard': [],
  '/cards': ['manage:cards'],
  '/expenses': ['manage:expenses'],
  '/invoices': ['manage:invoices'],
  '/reimbursements': ['manage:expenses'],
  '/transactions': ['manage:expenses'],
  '/accounting': ['manage:accounting'],
  '/accounting/export': ['export:accounting'],
  '/cashflow': ['view:analytics'],
  '/tax-advisor': ['manage:tax_advisor'],
  '/team': ['manage:users'],
  '/settings': [],
  '/settings/billing': ['manage:billing'],
  '/admin': ['super_admin'],
}

export function canAccessRoute(user: SessionUser, path: string): boolean {
  // Find the most specific matching route
  const matchedRoute = Object.keys(ROUTE_PERMISSIONS)
    .filter((route) => path.startsWith(route))
    .sort((a, b) => b.length - a.length)[0]

  if (!matchedRoute) return true
  const required = ROUTE_PERMISSIONS[matchedRoute]
  if (required.length === 0) return true
  return hasAnyPermission(user, required)
}

// ─────────────────────────────────────────────
// APPROVAL WORKFLOW
// ─────────────────────────────────────────────

export interface ApprovalContext {
  entityType: 'expense' | 'reimbursement' | 'supplier_invoice' | 'spend_request' | 'card_request'
  amount: number
  departmentId?: string
  costCenterId?: string
  userId: string
  organizationId: string
}

export interface ApprovalRequirement {
  requiresApproval: boolean
  steps: ApprovalStepRequirement[]
  autoApprove: boolean
  reason?: string
}

export interface ApprovalStepRequirement {
  stepNumber: number
  name: string
  approverId?: string
  approverRole?: UserRole
  amountThreshold?: number
}

// Evaluate if an entity needs approval based on policy
export function evaluateApprovalRequirement(
  context: ApprovalContext,
  policy: {
    rules: Array<{ conditions: Record<string, unknown>; priority: number }>
    steps: Array<{
      stepNumber: number
      name: string
      approverId?: string | null
      approverRole?: UserRole | null
      autoApproveBelow?: number | null
    }>
  } | null
): ApprovalRequirement {
  if (!policy) {
    // Default: no approval needed under €100, single manager approval above
    if (context.amount < 100) {
      return { requiresApproval: false, steps: [], autoApprove: true, reason: 'Below auto-approve threshold' }
    }
    return {
      requiresApproval: true,
      steps: [{ stepNumber: 1, name: 'Manager Approval', approverRole: 'APPROVER' }],
      autoApprove: false,
    }
  }

  // Check auto-approve threshold for first step
  const firstStep = policy.steps[0]
  if (firstStep?.autoApproveBelow && context.amount < Number(firstStep.autoApproveBelow)) {
    return { requiresApproval: false, steps: [], autoApprove: true, reason: `Below €${firstStep.autoApproveBelow} threshold` }
  }

  return {
    requiresApproval: true,
    steps: policy.steps.map((s) => ({
      stepNumber: s.stepNumber,
      name: s.name,
      approverId: s.approverId ?? undefined,
      approverRole: s.approverRole ?? undefined,
    })),
    autoApprove: false,
  }
}

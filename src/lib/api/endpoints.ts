/**
 * LedgerFlow Domain API Modules
 *
 * One function per API operation, fully typed.
 * All params and return types mirror the backend Zod schemas exactly.
 */

import { api, buildQuery } from './client'
import type {
  User, Organization, SessionResponse,
  Expense, ExpenseSummary, ExpenseFilters, CreateExpenseInput, UpdateExpenseInput,
  Card, CardFilters, CreateCardInput,
  Transaction, TransactionFilters, BulkCategorizeInput,
  SupplierInvoice, APInvoiceFilters, CreateAPInvoiceInput, APInvoiceAction,
  CustomerInvoice, ARInvoiceFilters, CreateARInvoiceInput, ARInvoiceAction,
  Reimbursement, CreateReimbursementInput,
  Supplier, Customer, CreateSupplierInput, CreateCustomerInput,
  AccountingMapping, VATCode, ExportBatch, CreateExportInput,
  CashFlowData,
  TaxAdvisorPortfolio, ReviewQueue,
  Notification,
  BillingData, PlanKey,
  DashboardData,
  OrganizationMember, Invitation, Department,
  AdminStats, AdminCompany, AdminUser, AuditLog, FeatureFlag,
} from '@/types'

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string, organizationId?: string) =>
    api.post<SessionResponse>('/api/auth/login', { email, password, organizationId }),

  signup: (data: {
    email: string; password: string; firstName: string; lastName: string
    organizationName: string; legalForm: string; vatId?: string; country?: string; industry?: string
  }) => api.post<SessionResponse>('/api/auth/signup', data),

  logout: () => api.post<void>('/api/auth/logout', {}),

  sendInvite: (email: string, role: string, departmentId?: string) =>
    api.post<{ invitationId: string; email: string }>('/api/auth/invite', { email, role, departmentId }),

  acceptInvite: (token: string, firstName: string, lastName: string, password: string) =>
    api.post<SessionResponse>('/api/auth/invite', { token, firstName, lastName, password }),
}

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────

export const dashboardApi = {
  get: () => api.get<DashboardData>('/api/dashboard', { cacheTTL: 30_000 }),
}

// ─────────────────────────────────────────────
// EXPENSES
// ─────────────────────────────────────────────

export const expensesApi = {
  list: (filters: ExpenseFilters = {}) =>
    api.get<Expense[]>(`/api/expenses${buildQuery(filters)}`),

  get: (id: string) =>
    api.get<Expense>(`/api/expenses/${id}`, { cacheTTL: 60_000 }),

  create: (data: CreateExpenseInput) =>
    api.post<Expense>('/api/expenses', data),

  update: (id: string, data: UpdateExpenseInput) =>
    api.put<Expense>(`/api/expenses/${id}`, data),

  delete: (id: string) =>
    api.delete<{ success: boolean }>(`/api/expenses/${id}`),

  submit: (id: string) =>
    api.post<Expense>(`/api/expenses/${id}/submit`, {}),

  approve: (id: string, comment?: string) =>
    api.post<Expense>(`/api/expenses/${id}/approve`, { comment }),

  reject: (id: string, reason: string) =>
    api.post<Expense>(`/api/expenses/${id}/reject`, { reason }),

  uploadReceipt: (expenseId: string | undefined, file: File, transactionId?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (expenseId) form.append('expenseId', expenseId)
    if (transactionId) form.append('transactionId', transactionId)
    return api.upload<{ id: string; url: string; ocrResult?: unknown }>('/api/receipts', form)
  },
}

// ─────────────────────────────────────────────
// CARDS
// ─────────────────────────────────────────────

export const cardsApi = {
  list: (filters: CardFilters = {}) =>
    api.get<Card[]>(`/api/cards${buildQuery(filters)}`),

  get: (id: string) =>
    api.get<Card>(`/api/cards/${id}`, { cacheTTL: 30_000 }),

  create: (data: CreateCardInput) =>
    api.post<Card>('/api/cards', data),

  freeze: (id: string) =>
    api.patch<Card>(`/api/cards/${id}`, { action: 'freeze' }),

  unfreeze: (id: string) =>
    api.patch<Card>(`/api/cards/${id}`, { action: 'unfreeze' }),

  cancel: (id: string) =>
    api.patch<Card>(`/api/cards/${id}`, { action: 'cancel' }),

  updateLimits: (id: string, limitAmount: number, limitPeriod: string) =>
    api.patch<Card>(`/api/cards/${id}`, { limitAmount, limitPeriod }),
}

// ─────────────────────────────────────────────
// TRANSACTIONS
// ─────────────────────────────────────────────

export const transactionsApi = {
  list: (filters: TransactionFilters = {}) =>
    api.get<Transaction[]>(`/api/transactions${buildQuery(filters)}`),

  bulkCategorize: (data: BulkCategorizeInput) =>
    api.patch<{ updated: number }>('/api/transactions', data),

  import: (transactions: unknown[]) =>
    api.post<{ imported: number; skipped: number }>('/api/transactions', { transactions }),
}

// ─────────────────────────────────────────────
// REIMBURSEMENTS
// ─────────────────────────────────────────────

export const reimbursementsApi = {
  list: (filters: { status?: string; page?: number; perPage?: number } = {}) =>
    api.get<Reimbursement[]>(`/api/reimbursements${buildQuery(filters)}`),

  create: (data: CreateReimbursementInput) =>
    api.post<Reimbursement>('/api/reimbursements', data),

  approve: (id: string, comment?: string) =>
    api.patch<Reimbursement>(`/api/reimbursements/${id}`, { action: 'approve', comment }),

  reject: (id: string, reason: string) =>
    api.patch<Reimbursement>(`/api/reimbursements/${id}`, { action: 'reject', reason }),

  markPaid: (id: string, paymentRef?: string) =>
    api.patch<Reimbursement>(`/api/reimbursements/${id}`, { action: 'mark_paid', paymentRef }),
}

// ─────────────────────────────────────────────
// AP INVOICES
// ─────────────────────────────────────────────

export const apInvoicesApi = {
  list: (filters: APInvoiceFilters = {}) =>
    api.get<SupplierInvoice[]>(`/api/invoices/ap${buildQuery(filters)}`),

  get: (id: string) =>
    api.get<SupplierInvoice>(`/api/invoices/ap/${id}`, { cacheTTL: 30_000 }),

  create: (data: CreateAPInvoiceInput) =>
    api.post<SupplierInvoice>('/api/invoices/ap', data),

  update: (id: string, data: Partial<CreateAPInvoiceInput>) =>
    api.patch<SupplierInvoice>(`/api/invoices/ap/${id}`, data),

  delete: (id: string) =>
    api.delete<{ success: boolean }>(`/api/invoices/ap/${id}`),

  approve: (id: string, comment?: string) =>
    api.patch<SupplierInvoice>(`/api/invoices/ap/${id}`, { action: 'approve', comment }),

  reject: (id: string, reason: string) =>
    api.patch<SupplierInvoice>(`/api/invoices/ap/${id}`, { action: 'reject', reason }),

  markPaid: (id: string, paidAmount?: number, paymentRef?: string) =>
    api.patch<SupplierInvoice>(`/api/invoices/ap/${id}`, { action: 'mark_paid', paidAmount, paymentRef }),

  cancel: (id: string) =>
    api.patch<SupplierInvoice>(`/api/invoices/ap/${id}`, { action: 'cancel' }),
}

// ─────────────────────────────────────────────
// AR INVOICES
// ─────────────────────────────────────────────

export const arInvoicesApi = {
  list: (filters: ARInvoiceFilters = {}) =>
    api.get<CustomerInvoice[]>(`/api/invoices/ar${buildQuery(filters)}`),

  get: (id: string) =>
    api.get<CustomerInvoice>(`/api/invoices/ar/${id}`, { cacheTTL: 30_000 }),

  create: (data: CreateARInvoiceInput) =>
    api.post<CustomerInvoice>('/api/invoices/ar', data),

  send: (id: string) =>
    api.patch<CustomerInvoice>(`/api/invoices/ar/${id}`, { action: 'send' }),

  recordPayment: (id: string, amount: number, paymentDate?: string, reference?: string) =>
    api.patch<CustomerInvoice>(`/api/invoices/ar/${id}`, { action: 'record_payment', amount, paymentDate, reference }),

  cancel: (id: string, reason?: string) =>
    api.patch<CustomerInvoice>(`/api/invoices/ar/${id}`, { action: 'cancel', reason }),

  createCreditNote: (id: string, amount: number, reason: string) =>
    api.patch<CustomerInvoice>(`/api/invoices/ar/${id}`, { action: 'create_credit_note', amount, reason }),
}

// ─────────────────────────────────────────────
// SUPPLIERS
// ─────────────────────────────────────────────

export const suppliersApi = {
  list: (search?: string, page = 1, perPage = 50) =>
    api.get<Supplier[]>(`/api/invoices/suppliers${buildQuery({ search, page, perPage })}`),

  create: (data: CreateSupplierInput) =>
    api.post<Supplier>('/api/invoices/suppliers', data),

  update: (id: string, data: Partial<CreateSupplierInput>) =>
    api.patch<Supplier>(`/api/invoices/suppliers/${id}`, data),

  delete: (id: string) =>
    api.patch<Supplier>(`/api/invoices/suppliers/${id}`, { isActive: false }),
}

// ─────────────────────────────────────────────
// CUSTOMERS
// ─────────────────────────────────────────────

export const customersApi = {
  list: (search?: string, page = 1, perPage = 50) =>
    api.get<Customer[]>(`/api/invoices/customers${buildQuery({ search, page, perPage })}`),

  create: (data: CreateCustomerInput) =>
    api.post<Customer>('/api/invoices/customers', data),

  update: (id: string, data: Partial<CreateCustomerInput>) =>
    api.patch<Customer>(`/api/invoices/customers/${id}`, data),
}

// ─────────────────────────────────────────────
// ACCOUNTING
// ─────────────────────────────────────────────

export const accountingApi = {
  getMappings: () =>
    api.get<{ mappings: AccountingMapping[]; vatCodes: VATCode[]; skr03Reference: unknown[] }>(
      '/api/accounting/mappings',
      { cacheTTL: 5 * 60_000 }
    ),

  upsertMapping: (categoryName: string, accountingCode: string, description?: string, vatCodeId?: string) =>
    api.post<AccountingMapping>('/api/accounting/mappings', { categoryName, accountingCode, description, vatCodeId }),

  seedDefaults: () =>
    api.post<{ count: number; message: string }>('/api/accounting/mappings', { seedDefaults: true }),

  listExports: (page = 1, perPage = 20) =>
    api.get<ExportBatch[]>(`/api/accounting/export${buildQuery({ page, perPage })}`),

  createExport: (data: CreateExportInput) =>
    api.post<ExportBatch & { preview: string; downloadUrl: string }>('/api/accounting/export', data),
}

// ─────────────────────────────────────────────
// CASH FLOW
// ─────────────────────────────────────────────

export const cashFlowApi = {
  get: (horizon: 30 | 60 | 90 | 180 = 30, historyMonths = 6) =>
    api.get<CashFlowData>(`/api/cashflow${buildQuery({ horizon, historyMonths })}`),

  addManualEvent: (data: {
    description: string; amount: number; expectedDate: string
    category: 'inflow' | 'outflow' | 'payroll' | 'tax' | 'investment'
    isRecurring?: boolean
  }) => api.post('/api/cashflow', data),
}

// ─────────────────────────────────────────────
// TAX ADVISOR
// ─────────────────────────────────────────────

export const taxAdvisorApi = {
  getPortfolio: () =>
    api.get<TaxAdvisorPortfolio[]>('/api/tax-advisor/portfolio'),

  getReviewQueue: (orgId: string) =>
    api.get<ReviewQueue>(`/api/tax-advisor/review/${orgId}`),

  addComment: (params: {
    organizationId: string; entityType: string; entityId: string
    content: string; visibility?: 'INTERNAL' | 'EXTERNAL'; requestDocument?: boolean
  }) => api.post('/api/tax-advisor/comment', params),

  lockPeriod: (organizationId: string, periodStart: string, periodEnd: string, locked: boolean) =>
    api.post('/api/tax-advisor/lock-period', { organizationId, periodStart, periodEnd, locked }),
}

// ─────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────

export const notificationsApi = {
  list: (params: { unreadOnly?: boolean; page?: number; perPage?: number } = {}) =>
    api.get<Notification[]>(`/api/notifications${buildQuery(params)}`),

  markRead: (ids: string[]) =>
    api.patch<{ remainingUnread: number }>('/api/notifications', { ids }),

  markAllRead: () =>
    api.patch<{ remainingUnread: number }>('/api/notifications', { markAll: true }),

  delete: (id?: string) =>
    api.delete(`/api/notifications${id ? `?id=${id}` : ''}`),
}

// ─────────────────────────────────────────────
// BILLING
// ─────────────────────────────────────────────

export const billingApi = {
  get: () => api.get<BillingData>('/api/billing'),

  upgrade: (plan: PlanKey, billingCycle: 'monthly' | 'annual') =>
    api.post('/api/billing', { plan, billingCycle }),
}

// ─────────────────────────────────────────────
// SETTINGS / TEAM
// ─────────────────────────────────────────────

export const settingsApi = {
  getTeam: () =>
    api.get<{ members: OrganizationMember[]; invitations: Invitation[] }>('/api/settings/team'),

  updateMember: (memberId: string, data: { role?: string; status?: string; departmentId?: string | null }) =>
    api.patch<OrganizationMember>(`/api/settings/team/${memberId}`, data),

  getDepartments: () =>
    api.get<Department[]>('/api/settings/departments'),

  createDepartment: (data: { name: string; code?: string; budgetMonthly?: number }) =>
    api.post<Department>('/api/settings/departments', data),

  getIntegrations: () =>
    api.get<{ catalog: unknown[]; connections: unknown[] }>('/api/settings/integrations'),
}

// ─────────────────────────────────────────────
// ADMIN
// ─────────────────────────────────────────────

export const adminApi = {
  getStats: () => api.get<AdminStats>('/api/admin/stats'),

  getCompanies: (search?: string, page = 1, perPage = 25) =>
    api.get<AdminCompany[]>(`/api/admin/companies${buildQuery({ search, page, perPage })}`),

  updateCompany: (id: string, data: { isActive?: boolean; onboardingComplete?: boolean }) =>
    api.patch<Organization>(`/api/admin/companies/${id}`, data),

  getUsers: (search?: string, page = 1, perPage = 25) =>
    api.get<AdminUser[]>(`/api/admin/users${buildQuery({ search, page, perPage })}`),

  getAuditLogs: (filters: Record<string, string | undefined> = {}, page = 1, perPage = 50) =>
    api.get<AuditLog[]>(`/api/admin/audit-logs${buildQuery({ ...filters, page, perPage })}`),

  getFlags: () => api.get<FeatureFlag[]>('/api/admin/flags'),

  toggleFlag: (key: string, isEnabled: boolean, organizationId?: string) =>
    api.patch<{ success: boolean }>('/api/admin/flags', { key, isEnabled, organizationId }),

  impersonate: (userId: string, organizationId: string) =>
    api.post<{ redirectTo: string }>('/api/admin/impersonate', { userId, organizationId }),
}

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────

export const healthApi = {
  check: () => api.get<{ status: string; checks: Record<string, unknown> }>('/api/health', { unique: true }),
}

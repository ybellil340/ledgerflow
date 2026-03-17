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

  listRequests: () =>
    api.get<{ requests: any[]; total: number }>('/api/cards?type=requests'),

  approveRequest: (id: string) =>
    api.patch<any>(`/api/cards/${id}`, { action: 'approve_request' }),

  rejectRequest: (id: string, reason: string) =>
    api.patch<any>(`/api/cards/${id}`, { action: 'reject_request', reason }),
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

  generateExport: (data: any) =>
    api.post<any>('/api/accounting/export', data),

  getExportReadiness: () =>
    api.get<any>('/api/accounting/export?type=readiness'),

  seedDefaultMappings: () =>
    api.post<any>('/api/accounting/mappings', { seedDefaults: true }),
}

// ─────────────────────────────────────────────
// CASH FLOW
// ─────────────────────────────────────────────

export const cashFlowApi = {
  get: (horizon: 30 | 60 | 90 | 180 = 30, historyMonths = 6) =>
    api.get<CashFlowData>(`/api/cashflow${buildQuery({ horizon, historyMonths })}`),

  getForecast: (params: { range?: string } = {}) =>
    api.get<any>(`/api/cashflow${buildQuery(params)}`),

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
    api.get<any>('/api/tax-advisor'),

  getReviewQueue: (orgId: string) =>
    api.get<any[]>(`/api/tax-advisor?type=review&orgId=${orgId}`),

  getComments: (orgId: string) =>
    api.get<any[]>(`/api/tax-advisor?type=comments&orgId=${orgId}`),

  addComment: (orgId: string, data: { text: string }) =>
    api.post('/api/tax-advisor', { action: 'comment', organizationId: orgId, ...data }),

  lockPeriod: (orgId: string, data: { period: string }) =>
    api.post('/api/tax-advisor', { action: 'lock_period', organizationId: orgId, ...data }),
}

// ─────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────

export const notificationsApi = {
  list: (params: { unreadOnly?: boolean; page?: number; perPage?: number } = {}) =>
    api.get<Notification[]>(`/api/notifications${buildQuery(params)}`),

  markRead: (idOrIds: string | string[]) =>
    api.patch<{ remainingUnread: number }>('/api/notifications', { ids: Array.isArray(idOrIds) ? idOrIds : [idOrIds] }),

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

  getBillingInfo: () => api.get<any>('/api/billing'),

  listInvoices: () => api.get<any[]>('/api/billing?type=invoices'),

  upgrade: (data: { planId: string; billingCycle: string }) =>
    api.post('/api/billing', { action: 'upgrade', ...data }),
}

// ─────────────────────────────────────────────
// SETTINGS / TEAM
// ─────────────────────────────────────────────

export const settingsApi = {
  getTeam: () =>
    api.get<{ members: OrganizationMember[]; invitations: Invitation[] }>('/api/settings'),

  listMembers: () =>
    api.get<OrganizationMember[]>('/api/settings?type=members'),

  listInvitations: () =>
    api.get<Invitation[]>('/api/settings?type=invitations'),

  listDepartments: () =>
    api.get<Department[]>('/api/settings?type=departments'),

  inviteMember: (data: { email: string; role: string; departmentId?: string }) =>
    api.post<Invitation>('/api/settings/invite', data),

  updateMember: (memberId: string, data: { role?: string; departmentId?: string }) =>
    api.patch<OrganizationMember>(`/api/settings/member/${memberId}`, data),

  resendInvitation: (id: string) =>
    api.post<void>(`/api/settings/invite/${id}/resend`, {}),

  revokeInvitation: (id: string) =>
    api.delete<void>(`/api/settings/invite/${id}`),

  getDepartments: () =>
    api.get<Department[]>('/api/settings?type=departments'),

  createDepartment: (data: { name: string; code?: string; budgetMonthly?: number }) =>
    api.post<Department>('/api/settings/departments', data),

  listIntegrations: () =>
    api.get<any[]>('/api/integrations'),

  getIntegrationOAuthUrl: (key: string) =>
    api.post<{ authUrl: string }>('/api/integrations', { action: 'get_oauth_url', key }),

  connectIntegration: (key: string, data: { apiKey?: string }) =>
    api.post<void>('/api/integrations', { action: 'connect', key, ...data }),

  disconnectIntegration: (key: string) =>
    api.post<void>('/api/integrations', { action: 'disconnect', key }),

  syncIntegration: (key: string) =>
    api.post<void>('/api/integrations', { action: 'sync', key }),

  getIntegrations: () =>
    api.get<{ catalog: unknown[]; connections: unknown[] }>('/api/settings/integrations'),
}

// ─────────────────────────────────────────────
// ADMIN
// ─────────────────────────────────────────────

export const adminApi = {
  getStats: () => api.get<AdminStats>('/api/admin'),
  getPlatformStats: () => api.get<any>('/api/admin'),
  getCompanies: (search?: string, page = 1, perPage = 25) =>
    api.get<any>(`/api/admin?type=companies${search ? `&search=${search}` : ''}`),
  listOrganizations: (params: any = {}) =>
    api.get<any>(`/api/admin?type=companies`),
  updateCompany: (id: string, data: any) =>
    api.patch<any>(`/api/admin`, { type: 'company', id, ...data }),
  getUsers: (search?: string) =>
    api.get<any>(`/api/admin?type=users${search ? `&search=${search}` : ''}`),
  getAuditLogs: (params: any = {}) =>
    api.get<any>(`/api/admin?type=audit${params.search ? `&search=${params.search}` : ''}&limit=${params.limit ?? 50}`),
  listFeatureFlags: () => api.get<any[]>('/api/admin?type=flags'),
  getFlags: () => api.get<FeatureFlag[]>('/api/admin?type=flags'),
  setFeatureFlag: (key: string, enabled: boolean) =>
    api.post<any>('/api/admin', { action: 'set_flag', key, enabled }),
  toggleFlag: (key: string, isEnabled: boolean) =>
    api.post<any>('/api/admin', { action: 'set_flag', key, enabled: isEnabled }),
  impersonate: (orgId: string) =>
    api.post<any>('/api/admin', { action: 'impersonate', organizationId: orgId }),
}

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────

export const healthApi = {
  check: () => api.get<{ status: string; checks: Record<string, unknown> }>('/api/health', { unique: true }),
}

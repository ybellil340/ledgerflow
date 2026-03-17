import type {
  User, Organization, OrganizationMembership, Department, CostCenter,
  Card, Transaction, Expense, Reimbursement, SpendRequest, Supplier,
  SupplierInvoice, Customer, CustomerInvoice, VATCode, ExportBatch,
  ApprovalPolicy, ApprovalStep, Comment, Notification, AuditLog,
  Subscription, TaxAdvisorFirm, TaxAdvisorClientLink,
  UserRole, CardStatus, CardType, ExpenseStatus, InvoiceStatus,
  TransactionStatus, ReimbursementStatus, ApprovalStatus, PlanType,
} from '@prisma/client'

// Re-export Prisma types
export type {
  User, Organization, OrganizationMembership, Department, CostCenter,
  Card, Transaction, Expense, Reimbursement, SpendRequest, Supplier,
  SupplierInvoice, Customer, CustomerInvoice, VATCode, ExportBatch,
  ApprovalPolicy, ApprovalStep, Comment, Notification, AuditLog,
  Subscription, TaxAdvisorFirm, TaxAdvisorClientLink,
  UserRole, CardStatus, CardType, ExpenseStatus, InvoiceStatus,
  TransactionStatus, ReimbursementStatus, ApprovalStatus, PlanType,
}

// ─────────────────────────────────────────────
// SESSION & AUTH
// ─────────────────────────────────────────────

export interface SessionUser {
  id: string
  email: string
  firstName: string
  lastName: string
  avatarUrl?: string | null
  currentOrganizationId: string
  currentRole: UserRole
  isSuperAdmin: boolean
  isTaxAdvisor: boolean
  taxAdvisorFirmId?: string
  permissions: Permission[]
}

export type Permission =
  | 'manage:organization'
  | 'manage:users'
  | 'manage:cards'
  | 'manage:expenses'
  | 'manage:invoices'
  | 'manage:accounting'
  | 'manage:billing'
  | 'view:analytics'
  | 'approve:expenses'
  | 'approve:invoices'
  | 'approve:reimbursements'
  | 'export:accounting'
  | 'manage:tax_advisor'
  | 'super_admin'

// ─────────────────────────────────────────────
// API RESPONSE TYPES
// ─────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
  message?: string
  meta?: PaginationMeta
}

export interface PaginationMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: PaginationMeta
}

// ─────────────────────────────────────────────
// DASHBOARD TYPES
// ─────────────────────────────────────────────

export interface DashboardMetrics {
  totalSpendMonth: number
  cashPosition: number
  pendingApprovals: number
  missingReceipts: number
  missingReceiptsAmount: number
  overduePendingApprovals: number
  spendByCategory: CategorySpend[]
  spendByDepartment: DepartmentSpend[]
  monthlyFlow: MonthlyFlow[]
  topMerchants: MerchantSpend[]
  reimbursementQueue: number
  overdueInvoices: number
  overdueInvoicesAmount: number
}

export interface CategorySpend {
  category: string
  amount: number
  percentage: number
}

export interface DepartmentSpend {
  department: string
  amount: number
  budget?: number
}

export interface MonthlyFlow {
  month: string
  inflow: number
  outflow: number
  net: number
}

export interface MerchantSpend {
  merchant: string
  amount: number
  count: number
}

// ─────────────────────────────────────────────
// EXPENSE TYPES
// ─────────────────────────────────────────────

export interface ExpenseWithRelations extends Expense {
  user: Pick<User, 'id' | 'firstName' | 'lastName' | 'avatarUrl'>
  department?: Department | null
  costCenter?: CostCenter | null
  vatCode?: VATCode | null
  receipt?: {
    id: string
    fileUrl: string
    ocrProcessed: boolean
  } | null
  _count?: {
    comments: number
    attachments: number
  }
}

export interface CreateExpenseInput {
  merchant: string
  expenseDate: string
  currency: string
  grossAmount: number
  vatRate?: number
  vatAmount?: number
  netAmount?: number
  vatCodeId?: string
  categoryId?: string
  departmentId?: string
  costCenterId?: string
  projectCode?: string
  paymentMethod?: string
  cardId?: string
  notes?: string
}

export interface VATSummary {
  rate19: number
  rate7: number
  rate0: number
  totalReclaimable: number
  total: number
}

// ─────────────────────────────────────────────
// INVOICE TYPES
// ─────────────────────────────────────────────

export interface SupplierInvoiceWithRelations extends SupplierInvoice {
  supplier: Supplier
  vatCode?: VATCode | null
  lineItems: import('@prisma/client').InvoiceLineItem[]
  _count?: {
    comments: number
    attachments: number
  }
}

export interface CustomerInvoiceWithRelations extends CustomerInvoice {
  customer: Customer
  lineItems: import('@prisma/client').InvoiceLineItem[]
}

export interface CreateSupplierInvoiceInput {
  supplierId: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  currency: string
  grossAmount: number
  vatAmount?: number
  netAmount?: number
  vatCodeId?: string
  categoryId?: string
  notes?: string
  lineItems?: CreateInvoiceLineItemInput[]
}

export interface CreateInvoiceLineItemInput {
  description: string
  quantity: number
  unitPrice: number
  vatRate: number
  costCenterId?: string
  accountingCode?: string
}

// ─────────────────────────────────────────────
// CARD TYPES
// ─────────────────────────────────────────────

export interface CardWithRelations extends Card {
  user: Pick<User, 'id' | 'firstName' | 'lastName' | 'avatarUrl'>
  limitRules: import('@prisma/client').CardLimitRule[]
  _count?: {
    transactions: number
  }
  currentMonthSpend?: number
}

export interface CreateCardInput {
  userId: string
  type: CardType
  purpose: string
  limitAmount: number
  limitPeriod: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  allowedMerchantCategories?: string[]
  blockedMerchantCategories?: string[]
}

// ─────────────────────────────────────────────
// CASH FLOW TYPES
// ─────────────────────────────────────────────

export interface CashFlowForecast {
  currentBalance: number
  projectedBalance: number
  expectedInflow: number
  expectedOutflow: number
  runway?: number
  dataPoints: CashFlowDataPoint[]
  upcomingObligations: CashFlowObligation[]
  expectedInflows: CashFlowInflow[]
}

export interface CashFlowDataPoint {
  date: string
  inflow: number
  outflow: number
  balance: number
  isProjected: boolean
}

export interface CashFlowObligation {
  description: string
  amount: number
  dueDate: string
  category: 'payroll' | 'tax' | 'invoice' | 'recurring'
}

export interface CashFlowInflow {
  description: string
  amount: number
  expectedDate: string
  invoiceId?: string
  probability?: number
}

// ─────────────────────────────────────────────
// ACCOUNTING / DATEV TYPES
// ─────────────────────────────────────────────

export interface DATEVBuchung {
  umsatz: number           // Amount
  soll_haben: 'S' | 'H'   // Debit/Credit
  waehrung: string         // Currency
  wechselkurs?: number     // Exchange rate
  basis_umsatz?: number    // Base amount
  basis_waehrung?: string
  konto: string            // Account (SKR03/SKR04)
  gegenkonto: string       // Contra account
  bu_schluessel?: string   // Tax key
  belegdatum: string       // Document date (DDMM)
  belegfeld1: string       // Document number
  belegfeld2?: string
  skonto?: number          // Discount
  buchungstext: string     // Description (max 60 chars)
  postensperre?: boolean
  diverse_adressnummer?: string
  geschaeftspartner_bank?: string
  sachverhalt?: string
  zinssperre?: boolean
  beleglink?: string
  beleginfo_art1?: string
  beleginfo_inhalt1?: string
  kostenmenge?: number
  eu_land_u_umsatz?: string
  eu_steuersatz?: number
  abw_versteuerungsart?: string
  sachkontos_ohne_saldo?: boolean
  kost1?: string          // Cost center 1
  kost2?: string          // Cost center 2
  kost_menge?: number
  eu_mitgliedsstaat?: string
  eu_steuersatz_2?: number
  abw_kostenrechnung?: string
  leistungsdatum?: string  // Service date
  datum_zuord_steuerpflicht?: string
  falligkeitsdatum?: string // Due date
  generalumkehr?: boolean
  steuersatz?: number
  land?: string
}

export interface ExportReadiness {
  totalExpenses: number
  categorized: number
  receiptMatched: number
  vatAssigned: number
  readyToExport: number
  percentage: number
}

// ─────────────────────────────────────────────
// TAX ADVISOR TYPES
// ─────────────────────────────────────────────

export interface TaxAdvisorPortfolioItem {
  organization: Pick<Organization, 'id' | 'name' | 'vatId' | 'legalForm'>
  missingDocuments: number
  uncategorizedTransactions: number
  vatAnomalies: number
  unexportedPeriods: string[]
  lastExportDate?: string
  unreviewedComments: number
}

// ─────────────────────────────────────────────
// FILTER TYPES
// ─────────────────────────────────────────────

export interface ExpenseFilters {
  status?: ExpenseStatus[]
  userId?: string
  departmentId?: string
  costCenterId?: string
  categoryId?: string
  dateFrom?: string
  dateTo?: string
  amountMin?: number
  amountMax?: number
  hasReceipt?: boolean
  search?: string
  page?: number
  perPage?: number
}

export interface InvoiceFilters {
  status?: InvoiceStatus[]
  supplierId?: string
  dateFrom?: string
  dateTo?: string
  amountMin?: number
  amountMax?: number
  isOverdue?: boolean
  search?: string
  page?: number
  perPage?: number
}

export interface TransactionFilters {
  status?: TransactionStatus[]
  cardId?: string
  dateFrom?: string
  dateTo?: string
  amountMin?: number
  amountMax?: number
  merchant?: string
  page?: number
  perPage?: number
}

// ─────────────────────────────────────────────
// DASHBOARD DATA (alias for DashboardMetrics + extra fields)
// ─────────────────────────────────────────────

export interface DashboardData {
  totalSpendMonth: number
  cashPosition: number
  pendingApprovals: any[]
  overduePendingApprovals: number
  missingReceipts: number
  missingReceiptsAmount: number
  overdueInvoices: number
  overdueInvoicesAmount: number
  spendByCategory: CategorySpend[]
  monthlyFlow: MonthlyFlow[]
  recentTransactions: any[]
  topMerchants: any[]
  unreadNotifications: number
  reimbursementQueue: number
}

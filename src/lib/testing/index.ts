/**
 * LedgerFlow Test Infrastructure
 *
 * Provides:
 *   - Factory functions for every Prisma model (deterministic, overridable)
 *   - In-memory mock adapters (banking, OCR, email, card issuing)
 *   - DB helpers (isolated transactions, truncate, seed minimal dataset)
 *   - JWT helpers (sign test tokens for any role)
 *   - Request builder (typed fetch wrapper for API route integration tests)
 *   - Snapshot serializers for German currency / DATEV output
 */

import { PrismaClient } from '@prisma/client'
import { createId } from '@paralleldrive/cuid2'
import { SignJWT } from 'jose'
import type { NextRequest } from 'next/server'

// ─────────────────────────────────────────────
// PRISMA — ISOLATED TEST CLIENT
// ─────────────────────────────────────────────

/**
 * Each test file gets its own PrismaClient connected to the test DB.
 * Tests run inside a transaction that's rolled back after each test,
 * giving complete isolation without needing to truncate tables.
 */
export function createTestPrisma(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL } },
    log: process.env.TEST_LOG_SQL ? ['query'] : [],
  })
}

/** Wrap a test in a rolled-back transaction for full isolation */
export async function withTestTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>
): Promise<T> {
  let result: T
  try {
    await prisma.$transaction(async (tx) => {
      result = await fn(tx)
      throw new Error('__ROLLBACK__') // Force rollback after every test
    })
  } catch (e) {
    if ((e as Error).message !== '__ROLLBACK__') throw e
  }
  return result!
}

/** Truncate all tables (use in beforeAll if not using transaction isolation) */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename NOT IN ('_prisma_migrations')
  `
  for (const { tablename } of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE`)
  }
}

// ─────────────────────────────────────────────
// SEQUENCE — DETERMINISTIC IDs / NUMBERS
// ─────────────────────────────────────────────

let _seq = 0
export const seq = () => ++_seq
export const resetSeq = () => { _seq = 0 }

// ─────────────────────────────────────────────
// FACTORIES
// ─────────────────────────────────────────────

export type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P] }

// ── Organization ──────────────────────────────

export interface TestOrganization {
  id: string; name: string; legalForm: string; country: string; taxId?: string
  vatId?: string; subscriptionPlan: string; isActive: boolean; onboardingComplete: boolean
  createdAt: Date
}

export function makeOrganization(overrides: DeepPartial<TestOrganization> = {}): TestOrganization {
  const n = seq()
  return {
    id: createId(),
    name: `Test GmbH ${n}`,
    legalForm: 'GmbH',
    country: 'DE',
    taxId: `DE${String(n).padStart(9, '0')}`,
    vatId: `DE${String(n + 100000000).padStart(9, '0')}`,
    subscriptionPlan: 'GROWTH',
    isActive: true,
    onboardingComplete: true,
    createdAt: new Date('2024-01-15'),
    ...overrides,
  }
}

// ── User ──────────────────────────────────────

export type UserRole = 'COMPANY_ADMIN' | 'FINANCE_MANAGER' | 'APPROVER' | 'EMPLOYEE' | 'TAX_ADVISOR' | 'SUPER_ADMIN'

export interface TestUser {
  id: string; email: string; firstName: string; lastName: string
  passwordHash: string; isActive: boolean; isSuperAdmin: boolean; createdAt: Date
}

export function makeUser(overrides: DeepPartial<TestUser> = {}): TestUser {
  const n = seq()
  return {
    id: createId(),
    email: `user${n}@test-ledgerflow.de`,
    firstName: `Test${n}`,
    lastName: 'User',
    passwordHash: '$2b$10$testhashtesthashtesthasX', // bcrypt of "password123"
    isActive: true,
    isSuperAdmin: false,
    createdAt: new Date('2024-02-01'),
    ...overrides,
  }
}

export function makeAdminUser(overrides: DeepPartial<TestUser> = {}): TestUser {
  return makeUser({ isSuperAdmin: true, email: `admin${seq()}@ledgerflow-internal.de`, ...overrides })
}

// ── Expense ───────────────────────────────────

export interface TestExpense {
  id: string; organizationId: string; userId: string; merchant: string
  expenseDate: Date; currency: string; grossAmount: number; netAmount: number
  vatRate: number; vatAmount: number; categoryId: string; status: string; notes?: string
  createdAt: Date
}

export function makeExpense(overrides: DeepPartial<TestExpense> = {}): TestExpense {
  const n = seq()
  const gross = overrides.grossAmount ?? 119.00
  const vatRate = overrides.vatRate ?? 19
  const net = Math.round((gross / (1 + vatRate / 100)) * 100) / 100
  const vat = Math.round((gross - net) * 100) / 100
  return {
    id: createId(),
    organizationId: createId(),
    userId: createId(),
    merchant: `Merchant ${n}`,
    expenseDate: new Date('2025-03-14'),
    currency: 'EUR',
    grossAmount: gross,
    netAmount: net,
    vatRate,
    vatAmount: vat,
    categoryId: 'Travel',
    status: 'SUBMITTED',
    createdAt: new Date(),
    ...overrides,
  }
}

export function makeDraftExpense(overrides: DeepPartial<TestExpense> = {}): TestExpense {
  return makeExpense({ status: 'DRAFT', ...overrides })
}

export function makePendingExpense(overrides: DeepPartial<TestExpense> = {}): TestExpense {
  return makeExpense({ status: 'PENDING_APPROVAL', ...overrides })
}

export function makeApprovedExpense(overrides: DeepPartial<TestExpense> = {}): TestExpense {
  return makeExpense({ status: 'APPROVED', ...overrides })
}

// ── Card ──────────────────────────────────────

export interface TestCard {
  id: string; organizationId: string; userId: string; last4: string
  cardType: string; status: string; limitAmount: number; limitPeriod: string
  spentAmount: number; currency: string; createdAt: Date
}

export function makeCard(overrides: DeepPartial<TestCard> = {}): TestCard {
  const n = seq()
  return {
    id: createId(),
    organizationId: createId(),
    userId: createId(),
    last4: String(1000 + n).slice(1),
    cardType: 'VIRTUAL',
    status: 'ACTIVE',
    limitAmount: 5000,
    limitPeriod: 'MONTHLY',
    spentAmount: 0,
    currency: 'EUR',
    createdAt: new Date(),
    ...overrides,
  }
}

// ── Supplier Invoice (AP) ─────────────────────

export interface TestAPInvoice {
  id: string; organizationId: string; supplierId: string; invoiceNumber: string
  invoiceDate: Date; dueDate: Date; currency: string; grossAmount: number
  netAmount: number; vatRate: number; vatAmount: number; status: string
  isDuplicate: boolean; isExported: boolean; createdAt: Date
}

export function makeAPInvoice(overrides: DeepPartial<TestAPInvoice> = {}): TestAPInvoice {
  const n = seq()
  const gross = overrides.grossAmount ?? 1190.00
  const vatRate = overrides.vatRate ?? 19
  const net = Math.round((gross / (1 + vatRate / 100)) * 100) / 100
  const vat = Math.round((gross - net) * 100) / 100
  return {
    id: createId(),
    organizationId: createId(),
    supplierId: createId(),
    invoiceNumber: `INV-${String(n).padStart(4, '0')}`,
    invoiceDate: new Date('2025-03-01'),
    dueDate: new Date('2025-03-31'),
    currency: 'EUR',
    grossAmount: gross,
    netAmount: net,
    vatRate,
    vatAmount: vat,
    status: 'PENDING_APPROVAL',
    isDuplicate: false,
    isExported: false,
    createdAt: new Date(),
    ...overrides,
  }
}

// ── Customer Invoice (AR) ─────────────────────

export interface TestARInvoice {
  id: string; organizationId: string; customerId: string; invoiceNumber: string
  invoiceDate: Date; dueDate: Date; currency: string; grossAmount: number
  netAmount: number; vatRate: number; vatAmount: number; status: string
  paidAmount: number; createdAt: Date
}

export function makeARInvoice(overrides: DeepPartial<TestARInvoice> = {}): TestARInvoice {
  const n = seq()
  const gross = overrides.grossAmount ?? 2380.00
  const vatRate = overrides.vatRate ?? 19
  const net = Math.round((gross / (1 + vatRate / 100)) * 100) / 100
  const vat = Math.round((gross - net) * 100) / 100
  return {
    id: createId(),
    organizationId: createId(),
    customerId: createId(),
    invoiceNumber: `RE-2025-${String(n).padStart(4, '0')}`,
    invoiceDate: new Date('2025-03-01'),
    dueDate: new Date('2025-03-31'),
    currency: 'EUR',
    grossAmount: gross,
    netAmount: net,
    vatRate,
    vatAmount: vat,
    status: 'SENT',
    paidAmount: 0,
    createdAt: new Date(),
    ...overrides,
  }
}

// ── Supplier / Customer ────────────────────────

export function makeSupplier(organizationId: string, overrides: Record<string, unknown> = {}) {
  const n = seq()
  return {
    id: createId(),
    organizationId,
    name: `Lieferant GmbH ${n}`,
    vatId: `DE${String(200000000 + n)}`,
    iban: `DE${String(n).padStart(20, '0')}`,
    paymentTermsDays: 30,
    defaultVatRate: 19,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  }
}

export function makeCustomer(organizationId: string, overrides: Record<string, unknown> = {}) {
  const n = seq()
  return {
    id: createId(),
    organizationId,
    name: `Kunde AG ${n}`,
    vatId: `DE${String(300000000 + n)}`,
    paymentTermsDays: 30,
    defaultVatRate: 19,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  }
}

// ─────────────────────────────────────────────
// JWT HELPERS
// ─────────────────────────────────────────────

const TEST_JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'test-jwt-secret-min-32-chars-long!!'
)

export async function signTestToken(payload: {
  id: string
  email: string
  currentOrganizationId: string
  currentRole: UserRole
  isSuperAdmin?: boolean
  isTaxAdvisor?: boolean
  exp?: number
}): Promise<string> {
  return new SignJWT({
    sub: payload.id,
    email: payload.email,
    currentOrganizationId: payload.currentOrganizationId,
    currentRole: payload.currentRole,
    isSuperAdmin: payload.isSuperAdmin ?? false,
    isTaxAdvisor: payload.isTaxAdvisor ?? false,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(payload.exp ?? '1h')
    .sign(TEST_JWT_SECRET)
}

export async function makeTestSession(role: UserRole = 'COMPANY_ADMIN', overrides: Record<string, unknown> = {}) {
  const user = makeUser()
  const org = makeOrganization()
  const token = await signTestToken({
    id: user.id,
    email: user.email,
    currentOrganizationId: org.id,
    currentRole: role,
    ...overrides,
  })
  return { user, org, token, authHeader: `Bearer ${token}` }
}

// ─────────────────────────────────────────────
// REQUEST BUILDER
// ─────────────────────────────────────────────

/**
 * Builds a NextRequest for API route integration tests.
 * Usage:
 *   const req = buildRequest('POST', '/api/expenses', body, token)
 *   const res = await POST(req)
 *   expect(res.status).toBe(200)
 */
export function buildRequest(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  headers: Record<string, string> = {}
): NextRequest {
  const url = `http://localhost:3000${path}`
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
  return new Request(url, init) as unknown as NextRequest
}

// ─────────────────────────────────────────────
// MOCK ADAPTERS
// ─────────────────────────────────────────────

export interface MockEmailMessage {
  to: string; subject: string; html: string; sentAt: Date
}

export class MockEmailAdapter {
  public messages: MockEmailMessage[] = []

  async send(to: string, subject: string, html: string): Promise<void> {
    this.messages.push({ to, subject, html, sentAt: new Date() })
  }

  lastMessage(): MockEmailMessage | undefined {
    return this.messages[this.messages.length - 1]
  }

  messagesTo(email: string): MockEmailMessage[] {
    return this.messages.filter((m) => m.to === email)
  }

  reset(): void { this.messages = [] }
}

export interface MockOCRResult {
  merchant?: string; date?: string; total?: number; currency?: string
  vatAmount?: number; vatRate?: number; lineItems?: Array<{ description: string; amount: number }>
  confidence: number
}

export class MockOCRAdapter {
  private _result: MockOCRResult = { confidence: 0.95 }
  public callCount = 0

  setResult(result: MockOCRResult): void { this._result = result }

  async extractFromFile(_file: Buffer): Promise<MockOCRResult> {
    this.callCount++
    return { ..._result: this._result }
  }

  reset(): void { this.callCount = 0; this._result = { confidence: 0.95 } }
}

export interface MockCardEvent {
  type: 'issue' | 'freeze' | 'unfreeze' | 'cancel' | 'update_limit'
  cardId: string; payload: unknown
}

export class MockCardIssuingAdapter {
  public events: MockCardEvent[] = []
  private _nextCardId = 'mock-card-id'

  setNextCardId(id: string): void { this._nextCardId = id }

  async issueCard(_params: unknown): Promise<{ externalId: string; last4: string }> {
    const event: MockCardEvent = { type: 'issue', cardId: this._nextCardId, payload: _params }
    this.events.push(event)
    return { externalId: this._nextCardId, last4: '9999' }
  }

  async freezeCard(cardId: string): Promise<void> {
    this.events.push({ type: 'freeze', cardId, payload: null })
  }

  async unfreezeCard(cardId: string): Promise<void> {
    this.events.push({ type: 'unfreeze', cardId, payload: null })
  }

  reset(): void { this.events = [] }
}

// ─────────────────────────────────────────────
// ASSERTION HELPERS
// ─────────────────────────────────────────────

/** Parse and assert the JSON body of a NextResponse */
export async function parseBody<T>(res: Response): Promise<T> {
  const text = await res.text()
  try { return JSON.parse(text) as T }
  catch { throw new Error(`Response is not valid JSON: ${text.slice(0, 200)}`) }
}

/** Assert a response is an API error with specific status and code */
export async function assertError(
  res: Response,
  expectedStatus: number,
  expectedCode?: string
): Promise<void> {
  expect(res.status).toBe(expectedStatus)
  const body = await parseBody<{ error: string; code?: string }>(res)
  expect(body.error).toBeTruthy()
  if (expectedCode) expect(body.code).toBe(expectedCode)
}

// ─────────────────────────────────────────────
// DATEV FORMAT HELPERS
// ─────────────────────────────────────────────

/** Parse a DATEV Buchungsstapel CSV string into typed records */
export function parseDATEVOutput(csv: string): Array<Record<string, string>> {
  const lines = csv.split('\r\n').filter((l) => l.trim())
  // Skip EXTF header line and column header line
  const headerLine = lines.find((l) => l.startsWith('Umsatz'))
  if (!headerLine) return []
  const headers = headerLine.split(';')
  return lines
    .slice(lines.indexOf(headerLine) + 1)
    .filter((l) => l.trim())
    .map((line) => {
      const values = line.split(';')
      return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
    })
}

/** Assert a DATEV export record has correct German number formatting */
export function assertDATEVAmount(record: Record<string, string>, field: string, expected: number): void {
  const raw = record[field]
  // DATEV uses comma as decimal separator, no thousands separator
  const parsed = parseFloat(raw.replace(',', '.'))
  expect(parsed).toBeCloseTo(expected, 2)
}

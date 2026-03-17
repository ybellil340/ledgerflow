/**
 * Integration tests: Expenses API
 *
 * Tests the full HTTP request/response cycle for /api/expenses.
 * Uses a real test DB inside rolled-back transactions for isolation.
 *
 * Covers: CRUD, filtering, approval flow, permission enforcement,
 *         VAT auto-calculation, receipt association.
 */

import { describe, test, expect, beforeEach, afterAll, vi } from 'vitest'
import {
  createTestPrisma, withTestTransaction, makeTestSession,
  makeUser, makeOrganization, makeExpense, makeApprovedExpense,
  buildRequest, parseBody, assertError, resetSeq,
} from '@/lib/testing'
import { GET, POST } from '@/app/api/expenses/route'
import { GET as GET_ONE, PUT, DELETE } from '@/app/api/expenses/[id]/route'
import { POST as APPROVE, POST as REJECT } from '@/app/api/expenses/[id]/actions'

const prisma = createTestPrisma()

afterAll(async () => { await prisma.$disconnect() })

describe('GET /api/expenses', () => {
  test('returns 401 without auth token', async () => {
    const req = buildRequest('GET', '/api/expenses')
    const res = await GET(req)
    await assertError(res, 401)
  })

  test('returns paginated list for the authenticated organization only', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession('EMPLOYEE')
      const otherOrg = makeOrganization()

      // Create expenses in both orgs
      const myExpense = makeExpense({ organizationId: org.id, userId: user.id })
      const otherExpense = makeExpense({ organizationId: otherOrg.id })

      await tx.expense.createMany({ data: [myExpense as never, otherExpense as never] })

      const req = buildRequest('GET', '/api/expenses', undefined, token)
      const res = await GET(req)
      const body = await parseBody<{ data: unknown[] }>(res)

      expect(res.status).toBe(200)
      expect(body.data).toHaveLength(1)
      expect((body.data[0] as { id: string }).id).toBe(myExpense.id)
    })
  })

  test('filters by status correctly', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession('FINANCE_MANAGER')
      const approved = makeApprovedExpense({ organizationId: org.id, userId: user.id })
      const pending  = makeExpense({ organizationId: org.id, userId: user.id, status: 'PENDING_APPROVAL' })
      await tx.expense.createMany({ data: [approved as never, pending as never] })

      const req = buildRequest('GET', '/api/expenses?status=APPROVED', undefined, token)
      const res = await GET(req)
      const body = await parseBody<{ data: Array<{ status: string }> }>(res)

      expect(res.status).toBe(200)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].status).toBe('APPROVED')
    })
  })

  test('filters missing receipts when hasReceipt=false', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession('FINANCE_MANAGER')
      const withReceipt    = makeExpense({ organizationId: org.id, userId: user.id })
      const withoutReceipt = makeExpense({ organizationId: org.id, userId: user.id })

      await tx.expense.createMany({ data: [withReceipt as never, withoutReceipt as never] })
      await tx.receipt.create({ data: { id: 'rcpt-001', expenseId: withReceipt.id, organizationId: org.id, filename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1000 } })

      const req = buildRequest('GET', '/api/expenses?hasReceipt=false', undefined, token)
      const res = await GET(req)
      const body = await parseBody<{ data: Array<{ id: string }> }>(res)

      expect(body.data.every((e) => e.id === withoutReceipt.id)).toBe(true)
    })
  })

  test('supports search by merchant name', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession()
      await tx.expense.createMany({
        data: [
          makeExpense({ organizationId: org.id, userId: user.id, merchant: 'Lufthansa' }) as never,
          makeExpense({ organizationId: org.id, userId: user.id, merchant: 'AWS Frankfurt' }) as never,
          makeExpense({ organizationId: org.id, userId: user.id, merchant: 'Lufthansa AG' }) as never,
        ],
      })

      const req = buildRequest('GET', '/api/expenses?search=Lufthansa', undefined, token)
      const res = await GET(req)
      const body = await parseBody<{ data: unknown[] }>(res)

      expect(body.data).toHaveLength(2)
    })
  })

  test('respects pagination (page, perPage)', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession()
      const expenses = Array.from({ length: 15 }, () =>
        makeExpense({ organizationId: org.id, userId: user.id })
      )
      await tx.expense.createMany({ data: expenses as never[] })

      const req = buildRequest('GET', '/api/expenses?page=2&perPage=5', undefined, token)
      const res = await GET(req)
      const body = await parseBody<{ data: unknown[]; meta: { page: number; total: number } }>(res)

      expect(body.data).toHaveLength(5)
      expect(body.meta.page).toBe(2)
      expect(body.meta.total).toBe(15)
    })
  })
})

describe('POST /api/expenses', () => {
  test('creates expense and auto-calculates VAT at 19%', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession('EMPLOYEE')
      await tx.organization.create({ data: makeOrganization({ id: org.id }) as never })
      await tx.user.create({ data: makeUser({ id: user.id, email: user.email }) as never })

      const payload = {
        merchant: 'Lufthansa AG',
        expenseDate: '2025-03-14',
        currency: 'EUR',
        grossAmount: 119.00,
        vatRate: 19,
        categoryId: 'Travel',
        notes: 'Frankfurt business trip',
      }

      const req = buildRequest('POST', '/api/expenses', payload, token)
      const res = await POST(req)
      const body = await parseBody<{ data: { netAmount: number; vatAmount: number; status: string } }>(res)

      expect(res.status).toBe(201)
      expect(body.data.netAmount).toBeCloseTo(100.00, 2)
      expect(body.data.vatAmount).toBeCloseTo(19.00, 2)
      expect(body.data.status).toBe('DRAFT')
    })
  })

  test('creates expense with 7% VAT (reduced rate for meals)', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession('EMPLOYEE')
      await tx.organization.create({ data: makeOrganization({ id: org.id }) as never })
      await tx.user.create({ data: makeUser({ id: user.id, email: user.email }) as never })

      const req = buildRequest('POST', '/api/expenses', {
        merchant: 'Restaurant Zur Post',
        expenseDate: '2025-03-12',
        currency: 'EUR',
        grossAmount: 107.00,
        vatRate: 7,
        categoryId: 'Meals',
      }, token)

      const res = await POST(req)
      const body = await parseBody<{ data: { netAmount: number; vatAmount: number } }>(res)
      expect(res.status).toBe(201)
      expect(body.data.netAmount).toBeCloseTo(100.00, 2)
      expect(body.data.vatAmount).toBeCloseTo(7.00, 2)
    })
  })

  test('returns 400 when grossAmount is negative', async () => {
    const { token } = await makeTestSession('EMPLOYEE')
    const req = buildRequest('POST', '/api/expenses', { merchant: 'Test', grossAmount: -10, expenseDate: '2025-03-01', currency: 'EUR', vatRate: 19, categoryId: 'Travel' }, token)
    await assertError(await POST(req), 400, 'VALIDATION_ERROR')
  })

  test('returns 400 when required fields are missing', async () => {
    const { token } = await makeTestSession()
    const req = buildRequest('POST', '/api/expenses', { merchant: 'Test' }, token)
    await assertError(await POST(req), 400, 'VALIDATION_ERROR')
  })

  test('returns 400 when expenseDate is in the future (>7 days)', async () => {
    const { token } = await makeTestSession()
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 10)
    const req = buildRequest('POST', '/api/expenses', {
      merchant: 'Test', grossAmount: 100, vatRate: 19, categoryId: 'Travel',
      expenseDate: futureDate.toISOString().split('T')[0], currency: 'EUR',
    }, token)
    await assertError(await POST(req), 400, 'VALIDATION_ERROR')
  })

  test('enforces max grossAmount of €50,000 per expense', async () => {
    const { token } = await makeTestSession()
    const req = buildRequest('POST', '/api/expenses', {
      merchant: 'Big Purchase', grossAmount: 60000, vatRate: 19, categoryId: 'Equipment',
      expenseDate: '2025-03-01', currency: 'EUR',
    }, token)
    await assertError(await POST(req), 400, 'VALIDATION_ERROR')
  })
})

describe('POST /api/expenses/:id/approve', () => {
  test('approves a submitted expense (APPROVER role)', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession('APPROVER')
      const expense = makeExpense({ organizationId: org.id, userId: user.id, status: 'SUBMITTED' })
      await tx.expense.create({ data: expense as never })

      const req = buildRequest('POST', `/api/expenses/${expense.id}/approve`, { comment: 'Looks good' }, token)
      const res = await APPROVE(req, { params: { id: expense.id } })
      const body = await parseBody<{ data: { status: string } }>(res)

      expect(res.status).toBe(200)
      expect(['PENDING_APPROVAL', 'APPROVED']).toContain(body.data.status)
    })
  })

  test('returns 403 when EMPLOYEE tries to approve another employee expense', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, token } = await makeTestSession('EMPLOYEE')
      const expense = makeExpense({ organizationId: org.id, status: 'SUBMITTED' })
      await tx.expense.create({ data: expense as never })

      const req = buildRequest('POST', `/api/expenses/${expense.id}/approve`, {}, token)
      await assertError(await APPROVE(req, { params: { id: expense.id } }), 403)
    })
  })

  test('returns 404 when expense does not exist', async () => {
    const { token } = await makeTestSession('APPROVER')
    const req = buildRequest('POST', '/api/expenses/nonexistent-id/approve', {}, token)
    await assertError(await APPROVE(req, { params: { id: 'nonexistent-id' } }), 404)
  })

  test('returns 409 when expense is already approved', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession('FINANCE_MANAGER')
      const expense = makeApprovedExpense({ organizationId: org.id, userId: user.id })
      await tx.expense.create({ data: expense as never })

      const req = buildRequest('POST', `/api/expenses/${expense.id}/approve`, {}, token)
      await assertError(await APPROVE(req, { params: { id: expense.id } }), 409)
    })
  })
})

describe('POST /api/expenses/:id/reject', () => {
  test('rejects a submitted expense with reason', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession('APPROVER')
      const expense = makeExpense({ organizationId: org.id, userId: user.id, status: 'SUBMITTED' })
      await tx.expense.create({ data: expense as never })

      const req = buildRequest('POST', `/api/expenses/${expense.id}/reject`, { reason: 'Not a business expense' }, token)
      const res = await REJECT(req, { params: { id: expense.id } })
      const body = await parseBody<{ data: { status: string } }>(res)

      expect(res.status).toBe(200)
      expect(body.data.status).toBe('REJECTED')
    })
  })

  test('returns 400 when rejection reason is missing', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession('APPROVER')
      const expense = makeExpense({ organizationId: org.id, userId: user.id, status: 'SUBMITTED' })
      await tx.expense.create({ data: expense as never })

      const req = buildRequest('POST', `/api/expenses/${expense.id}/reject`, {}, token)
      await assertError(await REJECT(req, { params: { id: expense.id } }), 400)
    })
  })
})

describe('DELETE /api/expenses/:id', () => {
  test('deletes a draft expense (owner only)', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession('EMPLOYEE')
      const expense = makeExpense({ organizationId: org.id, userId: user.id, status: 'DRAFT' })
      await tx.expense.create({ data: expense as never })

      const req = buildRequest('DELETE', `/api/expenses/${expense.id}`, undefined, token)
      const res = await DELETE(req, { params: { id: expense.id } })
      expect(res.status).toBe(200)

      const deleted = await tx.expense.findUnique({ where: { id: expense.id } })
      expect(deleted).toBeNull()
    })
  })

  test('returns 403 when trying to delete another user expense', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, token } = await makeTestSession('EMPLOYEE')
      const expense = makeExpense({ organizationId: org.id, userId: 'some-other-user', status: 'DRAFT' })
      await tx.expense.create({ data: expense as never })

      const req = buildRequest('DELETE', `/api/expenses/${expense.id}`, undefined, token)
      await assertError(await DELETE(req, { params: { id: expense.id } }), 403)
    })
  })

  test('returns 400 when trying to delete a submitted/approved expense', async () => {
    await withTestTransaction(prisma, async (tx) => {
      const { org, user, token } = await makeTestSession('EMPLOYEE')
      const expense = makeApprovedExpense({ organizationId: org.id, userId: user.id })
      await tx.expense.create({ data: expense as never })

      const req = buildRequest('DELETE', `/api/expenses/${expense.id}`, undefined, token)
      await assertError(await DELETE(req, { params: { id: expense.id } }), 400)
    })
  })
})

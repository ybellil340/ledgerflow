/**
 * Unit tests: Approval Engine
 *
 * Tests approval policy evaluation without DB access.
 * Covers: auto-approve thresholds, multi-step chains, role gating, escalation.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { ApprovalEngine, type ApprovalPolicy, type ApprovalContext } from '@/lib/services/approval-engine'
import { makeExpense, makeUser, makeOrganization, resetSeq } from '@/lib/testing'

const FINANCE_MANAGER_ID = 'user-fm-001'
const COMPANY_ADMIN_ID   = 'user-ca-001'
const CFO_ID             = 'user-cfo-001'

function makePolicy(overrides: Partial<ApprovalPolicy> = {}): ApprovalPolicy {
  return {
    id: 'policy-001',
    organizationId: 'org-001',
    name: 'Standard Policy',
    isDefault: true,
    autoApproveBelow: 50,
    steps: [
      { order: 1, role: 'APPROVER',         requiredCount: 1, escalateAfterHours: 48 },
      { order: 2, role: 'FINANCE_MANAGER',  requiredCount: 1, escalateAfterHours: 72 },
      { order: 3, role: 'COMPANY_ADMIN',    requiredCount: 1, escalateAfterHours: null },
    ],
    thresholds: [
      { minAmount: 0,    maxAmount: 500,   requiredSteps: 1 },
      { minAmount: 500,  maxAmount: 5000,  requiredSteps: 2 },
      { minAmount: 5000, maxAmount: null,  requiredSteps: 3 },
    ],
    ...overrides,
  }
}

describe('ApprovalEngine', () => {
  let engine: ApprovalEngine

  beforeEach(() => {
    resetSeq()
    engine = new ApprovalEngine()
  })

  // ─── Auto-approve ─────────────────────────────

  describe('auto-approve', () => {
    test('auto-approves expenses below threshold', () => {
      const expense = makeExpense({ grossAmount: 49.99 })
      const result = engine.evaluate(expense, makePolicy())
      expect(result.autoApproved).toBe(true)
      expect(result.requiredApprovers).toHaveLength(0)
    })

    test('does NOT auto-approve expenses at or above threshold', () => {
      const expense = makeExpense({ grossAmount: 50.00 })
      const result = engine.evaluate(expense, makePolicy())
      expect(result.autoApproved).toBe(false)
    })

    test('does not auto-approve when auto-approve is disabled (threshold = 0)', () => {
      const expense = makeExpense({ grossAmount: 1.00 })
      const result = engine.evaluate(expense, makePolicy({ autoApproveBelow: 0 }))
      expect(result.autoApproved).toBe(false)
    })
  })

  // ─── Step selection by amount ─────────────────

  describe('threshold-based step selection', () => {
    test('requires 1 step for amounts €0–€499', () => {
      const expense = makeExpense({ grossAmount: 250 })
      const result = engine.evaluate(expense, makePolicy())
      expect(result.requiredSteps).toBe(1)
      expect(result.requiredApprovers[0].role).toBe('APPROVER')
    })

    test('requires 2 steps for amounts €500–€4999', () => {
      const expense = makeExpense({ grossAmount: 1500 })
      const result = engine.evaluate(expense, makePolicy())
      expect(result.requiredSteps).toBe(2)
      expect(result.requiredApprovers.map((a) => a.role)).toEqual(['APPROVER', 'FINANCE_MANAGER'])
    })

    test('requires 3 steps for amounts ≥€5000', () => {
      const expense = makeExpense({ grossAmount: 10000 })
      const result = engine.evaluate(expense, makePolicy())
      expect(result.requiredSteps).toBe(3)
      expect(result.requiredApprovers.map((a) => a.role)).toEqual(
        ['APPROVER', 'FINANCE_MANAGER', 'COMPANY_ADMIN']
      )
    })

    test('uses gross amount, not net, for threshold calculation', () => {
      // Net = €420.17, Gross = €500 (with 19% VAT) — should trigger 2-step
      const expense = makeExpense({ grossAmount: 500.00, netAmount: 420.17, vatRate: 19 })
      const result = engine.evaluate(expense, makePolicy())
      expect(result.requiredSteps).toBe(2)
    })
  })

  // ─── Approval decision ────────────────────────

  describe('approve()', () => {
    test('transitions SUBMITTED → PENDING_APPROVAL on first approve', () => {
      const expense = makeExpense({ grossAmount: 300, status: 'SUBMITTED' })
      const ctx: ApprovalContext = {
        approverId: FINANCE_MANAGER_ID,
        approverRole: 'APPROVER',
        comment: 'Looks good',
        timestamp: new Date(),
      }
      const result = engine.approve(expense, makePolicy(), ctx)
      expect(result.newStatus).toBe('PENDING_APPROVAL')
      expect(result.completedSteps).toBe(1)
      expect(result.isFullyApproved).toBe(false)
    })

    test('transitions to APPROVED when all required steps complete', () => {
      const expense = makeExpense({ grossAmount: 300, status: 'PENDING_APPROVAL' })
      const policy = makePolicy()

      // Step 1 already done
      const ctx: ApprovalContext = {
        approverId: FINANCE_MANAGER_ID,
        approverRole: 'APPROVER',
        comment: '',
        timestamp: new Date(),
        previousApprovals: [{ step: 1, approverId: 'other-approver', role: 'APPROVER', at: new Date() }],
      }
      const result = engine.approve(expense, policy, ctx)
      expect(result.isFullyApproved).toBe(true)
      expect(result.newStatus).toBe('APPROVED')
    })

    test('prevents same person from approving multiple steps', () => {
      const expense = makeExpense({ grossAmount: 1500, status: 'PENDING_APPROVAL' })
      const ctx: ApprovalContext = {
        approverId: FINANCE_MANAGER_ID,
        approverRole: 'FINANCE_MANAGER',
        comment: '',
        timestamp: new Date(),
        // FM already approved step 1
        previousApprovals: [{ step: 1, approverId: FINANCE_MANAGER_ID, role: 'APPROVER', at: new Date() }],
      }
      expect(() => engine.approve(expense, makePolicy(), ctx)).toThrow('conflict of interest')
    })

    test('rejects approval from insufficient role', () => {
      const expense = makeExpense({ grossAmount: 5000, status: 'PENDING_APPROVAL' })
      const ctx: ApprovalContext = {
        approverId: 'some-employee',
        approverRole: 'EMPLOYEE',
        comment: '',
        timestamp: new Date(),
      }
      expect(() => engine.approve(expense, makePolicy(), ctx)).toThrow('insufficient role')
    })
  })

  // ─── Rejection ────────────────────────────────

  describe('reject()', () => {
    test('always transitions to REJECTED regardless of step', () => {
      const expense = makeExpense({ grossAmount: 10000, status: 'PENDING_APPROVAL' })
      const result = engine.reject(expense, makePolicy(), {
        approverId: COMPANY_ADMIN_ID,
        approverRole: 'COMPANY_ADMIN',
        reason: 'Not a valid business expense',
        timestamp: new Date(),
      })
      expect(result.newStatus).toBe('REJECTED')
      expect(result.reason).toBe('Not a valid business expense')
    })

    test('requires a non-empty rejection reason', () => {
      const expense = makeExpense({ grossAmount: 100, status: 'SUBMITTED' })
      expect(() => engine.reject(expense, makePolicy(), {
        approverId: FINANCE_MANAGER_ID,
        approverRole: 'APPROVER',
        reason: '   ',
        timestamp: new Date(),
      })).toThrow('reason required')
    })
  })

  // ─── Escalation ───────────────────────────────

  describe('getEscalations()', () => {
    test('identifies expenses pending approval beyond SLA window', () => {
      const OLD_DATE = new Date(Date.now() - 50 * 60 * 60 * 1000) // 50 hours ago
      const recent   = makeExpense({ grossAmount: 300, status: 'PENDING_APPROVAL', createdAt: new Date() })
      const overdue  = makeExpense({ grossAmount: 300, status: 'PENDING_APPROVAL', createdAt: OLD_DATE })

      const escalations = engine.getEscalations([recent, overdue], makePolicy())
      expect(escalations).toHaveLength(1)
      expect(escalations[0].expenseId).toBe(overdue.id)
      expect(escalations[0].slaBreachedHours).toBeGreaterThan(0)
    })

    test('does not escalate fully approved or rejected expenses', () => {
      const approved = makeExpense({ grossAmount: 300, status: 'APPROVED', createdAt: new Date(0) })
      const rejected = makeExpense({ grossAmount: 300, status: 'REJECTED', createdAt: new Date(0) })
      const escalations = engine.getEscalations([approved, rejected], makePolicy())
      expect(escalations).toHaveLength(0)
    })
  })

  // ─── Edge cases ───────────────────────────────

  describe('edge cases', () => {
    test('handles zero-amount expenses (bank fees, etc.)', () => {
      const expense = makeExpense({ grossAmount: 0, netAmount: 0, vatAmount: 0 })
      const result = engine.evaluate(expense, makePolicy())
      expect(result.autoApproved).toBe(true)
    })

    test('handles policy with no steps — auto-approves everything', () => {
      const expense = makeExpense({ grossAmount: 99999 })
      const policy = makePolicy({ steps: [], thresholds: [], autoApproveBelow: 0 })
      const result = engine.evaluate(expense, policy)
      expect(result.autoApproved).toBe(true)
    })

    test('handles policy with no thresholds — uses first step only', () => {
      const expense = makeExpense({ grossAmount: 50000 })
      const policy = makePolicy({ thresholds: [] })
      const result = engine.evaluate(expense, policy)
      expect(result.requiredSteps).toBe(1)
    })
  })
})

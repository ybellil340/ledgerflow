/**
 * Unit tests: Cash Flow Forecasting Service
 *
 * Tests the forecast computation logic:
 * - Inflow aggregation from open AR invoices
 * - Outflow from AP due dates + payroll estimates + VAT obligations
 * - Runway calculation
 * - Burn rate averaging
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { CashFlowService, type CashFlowInput } from '@/lib/services/cash-flow'
import { makeARInvoice, makeAPInvoice, resetSeq } from '@/lib/testing'

const TODAY = new Date('2025-03-17')

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

describe('CashFlowService', () => {
  let service: CashFlowService

  beforeEach(() => {
    resetSeq()
    service = new CashFlowService({ now: () => TODAY })
  })

  // ─── Inflow from AR invoices ──────────────────

  describe('AR inflow aggregation', () => {
    test('includes sent invoices within forecast horizon as inflows', () => {
      const invoice = makeARInvoice({
        grossAmount: 10000,
        status: 'SENT',
        dueDate: addDays(TODAY, 14),
        paidAmount: 0,
      })

      const input: CashFlowInput = {
        currentBalance: 50000,
        arInvoices: [invoice],
        apInvoices: [],
        payrollMonthly: 0,
        horizon: 30,
      }
      const result = service.forecast(input)

      const totalInflow = result.days.reduce((s, d) => s + d.inflow, 0)
      expect(totalInflow).toBeCloseTo(10000, 0)
    })

    test('only counts unpaid portion for partially paid invoices', () => {
      const invoice = makeARInvoice({
        grossAmount: 10000,
        status: 'SENT',
        dueDate: addDays(TODAY, 10),
        paidAmount: 4000, // Already paid €4,000
      })

      const input: CashFlowInput = {
        currentBalance: 50000,
        arInvoices: [invoice],
        apInvoices: [],
        payrollMonthly: 0,
        horizon: 30,
      }
      const result = service.forecast(input)
      const totalInflow = result.days.reduce((s, d) => s + d.inflow, 0)
      expect(totalInflow).toBeCloseTo(6000, 0)
    })

    test('excludes already-paid invoices from inflows', () => {
      const invoice = makeARInvoice({
        grossAmount: 5000, status: 'PAID', paidAmount: 5000,
        dueDate: addDays(TODAY, 5),
      })
      const input: CashFlowInput = {
        currentBalance: 50000, arInvoices: [invoice], apInvoices: [], payrollMonthly: 0, horizon: 30,
      }
      const result = service.forecast(input)
      const totalInflow = result.days.reduce((s, d) => s + d.inflow, 0)
      expect(totalInflow).toBe(0)
    })

    test('excludes overdue invoices beyond the horizon', () => {
      const invoice = makeARInvoice({
        grossAmount: 5000, status: 'OVERDUE',
        dueDate: addDays(TODAY, 45), // Beyond 30-day horizon
        paidAmount: 0,
      })
      const input: CashFlowInput = {
        currentBalance: 50000, arInvoices: [invoice], apInvoices: [], payrollMonthly: 0, horizon: 30,
      }
      const result = service.forecast(input)
      const totalInflow = result.days.reduce((s, d) => s + d.inflow, 0)
      expect(totalInflow).toBe(0)
    })
  })

  // ─── Outflow from AP invoices ─────────────────

  describe('AP outflow aggregation', () => {
    test('schedules approved AP invoices as outflows on due date', () => {
      const dueDate = addDays(TODAY, 10)
      const invoice = makeAPInvoice({ grossAmount: 3500, status: 'APPROVED', dueDate })

      const input: CashFlowInput = {
        currentBalance: 50000, arInvoices: [], apInvoices: [invoice as never], payrollMonthly: 0, horizon: 30,
      }
      const result = service.forecast(input)

      const dayOfDue = result.days.find((d) => d.date.toDateString() === dueDate.toDateString())
      expect(dayOfDue?.outflow).toBeGreaterThanOrEqual(3500)
    })

    test('excludes pending-approval AP invoices from forecast', () => {
      const invoice = makeAPInvoice({ grossAmount: 5000, status: 'PENDING_APPROVAL', dueDate: addDays(TODAY, 5) })
      const input: CashFlowInput = {
        currentBalance: 50000, arInvoices: [], apInvoices: [invoice as never], payrollMonthly: 0, horizon: 30,
      }
      const result = service.forecast(input)
      const totalOutflow = result.days.reduce((s, d) => s + d.outflow, 0)
      expect(totalOutflow).toBe(0)
    })

    test('marks overdue AP invoices as immediate outflows', () => {
      const invoice = makeAPInvoice({
        grossAmount: 2000, status: 'APPROVED',
        dueDate: addDays(TODAY, -5), // 5 days past due
      })
      const input: CashFlowInput = {
        currentBalance: 50000, arInvoices: [], apInvoices: [invoice as never], payrollMonthly: 0, horizon: 30,
      }
      const result = service.forecast(input)
      // Overdue invoices should appear on day 0 (today)
      const today = result.days.find((d) => d.date.toDateString() === TODAY.toDateString())
      expect(today?.outflow).toBeGreaterThanOrEqual(2000)
    })
  })

  // ─── Payroll ──────────────────────────────────

  describe('payroll scheduling', () => {
    test('schedules payroll on the 25th of each month within horizon', () => {
      const input: CashFlowInput = {
        currentBalance: 100000, arInvoices: [], apInvoices: [], payrollMonthly: 40000, horizon: 60,
      }
      const result = service.forecast(input)

      const payrollDays = result.days.filter((d) =>
        d.categories.some((c) => c.type === 'payroll')
      )
      expect(payrollDays.length).toBeGreaterThanOrEqual(1)
      payrollDays.forEach((d) => expect(d.date.getDate()).toBe(25))
    })

    test('does not schedule payroll when payrollMonthly = 0', () => {
      const input: CashFlowInput = {
        currentBalance: 50000, arInvoices: [], apInvoices: [], payrollMonthly: 0, horizon: 30,
      }
      const result = service.forecast(input)
      const payrollDays = result.days.filter((d) =>
        d.categories.some((c) => c.type === 'payroll')
      )
      expect(payrollDays).toHaveLength(0)
    })
  })

  // ─── VAT obligations ──────────────────────────

  describe('USt-Voranmeldung scheduling', () => {
    test('schedules Q1 VAT return on April 10 if within horizon', () => {
      const service2 = new CashFlowService({ now: () => new Date('2025-03-17') })
      const input: CashFlowInput = {
        currentBalance: 50000, arInvoices: [], apInvoices: [], payrollMonthly: 0,
        horizon: 30, vatObligations: [{ name: 'USt-Voranmeldung Q1', dueDate: new Date('2025-04-10'), estimatedAmount: 8000 }],
      }
      const result = service2.forecast(input)

      const vatDay = result.days.find((d) =>
        d.categories.some((c) => c.type === 'tax')
      )
      expect(vatDay).toBeTruthy()
      expect(vatDay!.date.toDateString()).toBe(new Date('2025-04-10').toDateString())
    })
  })

  // ─── Runway calculation ───────────────────────

  describe('runway', () => {
    test('calculates runway in months at current burn rate', () => {
      const input: CashFlowInput = {
        currentBalance: 120000, arInvoices: [], apInvoices: [], payrollMonthly: 40000,
        horizon: 30, monthlyBurnHistory: [40000, 42000, 38000], // avg ~40k
      }
      const result = service.forecast(input)
      expect(result.summary.runwayMonths).toBeCloseTo(3, 0)
    })

    test('returns Infinity runway when burn rate is zero', () => {
      const input: CashFlowInput = {
        currentBalance: 50000, arInvoices: [], apInvoices: [], payrollMonthly: 0,
        horizon: 30, monthlyBurnHistory: [0, 0, 0],
      }
      const result = service.forecast(input)
      expect(result.summary.runwayMonths).toBe(Infinity)
    })

    test('accounts for future inflows when calculating adjusted runway', () => {
      const invoice = makeARInvoice({ grossAmount: 60000, status: 'SENT', dueDate: addDays(TODAY, 5), paidAmount: 0 })
      const input: CashFlowInput = {
        currentBalance: 10000, arInvoices: [invoice], apInvoices: [],
        payrollMonthly: 20000, horizon: 30, monthlyBurnHistory: [20000, 20000, 20000],
      }
      const result = service.forecast(input)
      // €10k balance + €60k coming in vs €20k/month burn = much longer runway
      expect(result.summary.adjustedRunwayMonths).toBeGreaterThan(result.summary.runwayMonths)
    })
  })

  // ─── Summary stats ────────────────────────────

  describe('summary statistics', () => {
    test('computes net flow for the forecast period', () => {
      const inflow = makeARInvoice({ grossAmount: 20000, status: 'SENT', dueDate: addDays(TODAY, 5), paidAmount: 0 })
      const outflow = makeAPInvoice({ grossAmount: 8000, status: 'APPROVED', dueDate: addDays(TODAY, 10) })

      const input: CashFlowInput = {
        currentBalance: 50000, arInvoices: [inflow], apInvoices: [outflow as never],
        payrollMonthly: 0, horizon: 30,
      }
      const result = service.forecast(input)
      expect(result.summary.netFlow).toBeCloseTo(12000, 0)
    })

    test('returns correct projected end balance', () => {
      const inflow = makeARInvoice({ grossAmount: 10000, status: 'SENT', dueDate: addDays(TODAY, 5), paidAmount: 0 })
      const input: CashFlowInput = {
        currentBalance: 50000, arInvoices: [inflow], apInvoices: [], payrollMonthly: 0, horizon: 30,
      }
      const result = service.forecast(input)
      expect(result.summary.projectedEndBalance).toBeCloseTo(60000, 0)
    })
  })
})

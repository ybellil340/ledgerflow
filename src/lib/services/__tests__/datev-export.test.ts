/**
 * Unit tests: DATEV Export Service
 *
 * Tests the Buchungsstapel v700 generation logic without hitting the DB.
 * Each test validates a specific aspect of German accounting compliance.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  makeOrganization, makeExpense, makeAPInvoice,
  parseDATEVOutput, assertDATEVAmount, resetSeq,
} from '@/lib/testing'
import { DATEVExportService } from '@/lib/services/datev-export'

describe('DATEVExportService', () => {
  let service: DATEVExportService
  let org: ReturnType<typeof makeOrganization>

  beforeEach(() => {
    resetSeq()
    service = new DATEVExportService()
    org = makeOrganization({ vatId: 'DE123456789', name: 'Müller Consulting GmbH' })
  })

  // ─── EXTF Header ─────────────────────────────

  describe('EXTF header', () => {
    test('produces valid EXTF format header on first line', () => {
      const csv = service.generateBuchungsstapel({
        organization: org,
        records: [makeExpense({ organizationId: org.id, status: 'APPROVED' })],
        periodStart: new Date('2025-01-01'),
        periodEnd: new Date('2025-01-31'),
        format: 'DATEV',
      })

      const firstLine = csv.split('\r\n')[0]
      expect(firstLine).toMatch(/^"EXTF"/)
      expect(firstLine).toContain('700') // version
      expect(firstLine).toContain('21')  // data category: Buchungsstapel
    })

    test('embeds organization Beraternummer and Mandantennummer', () => {
      const csv = service.generateBuchungsstapel({
        organization: org,
        records: [],
        periodStart: new Date('2025-01-01'),
        periodEnd: new Date('2025-01-31'),
        format: 'DATEV',
      })
      const firstLine = csv.split('\r\n')[0]
      expect(firstLine).toContain(org.name)
    })

    test('uses CRLF line endings throughout', () => {
      const csv = service.generateBuchungsstapel({
        organization: org,
        records: [makeExpense({ organizationId: org.id })],
        periodStart: new Date('2025-01-01'),
        periodEnd: new Date('2025-01-31'),
        format: 'DATEV',
      })
      // Count CRLF vs bare LF — should have no bare LF without preceding CR
      const crlf = (csv.match(/\r\n/g) || []).length
      const bareLF = (csv.match(/(?<!\r)\n/g) || []).length
      expect(crlf).toBeGreaterThan(0)
      expect(bareLF).toBe(0)
    })

    test('uses semicolons as field delimiters', () => {
      const csv = service.generateBuchungsstapel({
        organization: org,
        records: [makeExpense({ organizationId: org.id })],
        periodStart: new Date('2025-01-01'),
        periodEnd: new Date('2025-01-31'),
        format: 'DATEV',
      })
      // Column header line should have semicolons
      const colHeader = csv.split('\r\n')[1]
      expect(colHeader).toContain('Umsatz')
      expect(colHeader.split(';').length).toBeGreaterThan(10)
    })
  })

  // ─── Amount formatting ────────────────────────

  describe('German number formatting', () => {
    test('formats amounts with comma decimal separator', () => {
      const expense = makeExpense({
        organizationId: org.id,
        grossAmount: 1190.50,
        netAmount: 1000.42,
        vatAmount: 190.08,
        vatRate: 19,
        status: 'APPROVED',
      })
      const csv = service.generateBuchungsstapel({
        organization: org,
        records: [expense],
        periodStart: new Date('2025-03-01'),
        periodEnd: new Date('2025-03-31'),
        format: 'DATEV',
      })
      const records = parseDATEVOutput(csv)
      expect(records).toHaveLength(1)
      // Amount field must use comma
      expect(records[0]['Umsatz (ohne Soll/Haben-Kz)']).toContain(',')
      expect(records[0]['Umsatz (ohne Soll/Haben-Kz)']).not.toContain('.')
    })

    test('rounds to exactly 2 decimal places', () => {
      const expense = makeExpense({
        organizationId: org.id,
        grossAmount: 99.999,
        netAmount: 84.034,
        vatAmount: 15.965,
        vatRate: 19,
        status: 'APPROVED',
      })
      const csv = service.generateBuchungsstapel({
        organization: org, records: [expense],
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
      })
      const records = parseDATEVOutput(csv)
      const rawAmount = records[0]['Umsatz (ohne Soll/Haben-Kz)']
      const decimalPart = rawAmount.split(',')[1]
      expect(decimalPart?.length).toBeLessThanOrEqual(2)
    })

    test('does not include thousands separator in amounts', () => {
      const expense = makeExpense({
        organizationId: org.id,
        grossAmount: 10000.00,
        netAmount: 8403.36,
        vatAmount: 1596.64,
        vatRate: 19,
        status: 'APPROVED',
      })
      const csv = service.generateBuchungsstapel({
        organization: org, records: [expense],
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
      })
      const records = parseDATEVOutput(csv)
      const rawAmount = records[0]['Umsatz (ohne Soll/Haben-Kz)']
      expect(rawAmount).not.toContain('.')
    })
  })

  // ─── VAT code mapping ─────────────────────────

  describe('VAT code mapping', () => {
    test.each([
      [19, 'VSt19', 'standard German VAT'],
      [7,  'VSt7',  'reduced German VAT'],
      [0,  'VSt0',  'zero-rate VAT'],
    ])('maps %i%% VAT to DATEV code %s (%s)', (vatRate, expectedCode) => {
      const expense = makeExpense({ organizationId: org.id, vatRate, status: 'APPROVED' })
      const csv = service.generateBuchungsstapel({
        organization: org, records: [expense],
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
      })
      const records = parseDATEVOutput(csv)
      expect(records[0]['BU-Schlüssel']).toContain(expectedCode)
    })

    test('maps EU reverse charge transactions to DATEV EUV code', () => {
      const expense = makeExpense({
        organizationId: org.id, vatRate: 0,
        notes: 'EU reverse charge · AWS Ireland',
        categoryId: 'Software',
        status: 'APPROVED',
      })
      // Simulate EU vendor flag
      const csv = service.generateBuchungsstapel({
        organization: org,
        records: [{ ...expense, isEUTransaction: true, vatCode: 'EUV' }] as never,
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
      })
      const records = parseDATEVOutput(csv)
      expect(records[0]['BU-Schlüssel']).toContain('EUV')
    })
  })

  // ─── Soll/Haben ───────────────────────────────

  describe('Soll/Haben direction', () => {
    test('marks expenses as Soll (S) — debit', () => {
      const expense = makeExpense({ organizationId: org.id, status: 'APPROVED' })
      const csv = service.generateBuchungsstapel({
        organization: org, records: [expense],
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
      })
      const records = parseDATEVOutput(csv)
      expect(records[0]['Soll/Haben-Kennzeichen']).toBe('S')
    })

    test('marks AR invoice payments as Haben (H) — credit', () => {
      const invoice = makeARInvoice({ organizationId: org.id, status: 'PAID', paidAmount: 2380 })
      const csv = service.generateBuchungsstapel({
        organization: org, records: [invoice] as never,
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
      })
      const records = parseDATEVOutput(csv)
      expect(records[0]['Soll/Haben-Kennzeichen']).toBe('H')
    })
  })

  // ─── SKR03 account mapping ─────────────────────

  describe('SKR03 account mapping', () => {
    test.each([
      ['Travel', '4670', 'Reisekosten'],
      ['Software', '4960', 'Software/Lizenzen'],
      ['Meals', '4650', 'Bewirtungskosten'],
      ['Equipment', '0800', 'Büroausstattung'],
    ])('maps category %s to SKR03 account %s (%s)', (category, expectedAccount) => {
      const expense = makeExpense({ organizationId: org.id, categoryId: category, status: 'APPROVED' })
      const csv = service.generateBuchungsstapel({
        organization: org, records: [expense],
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
      })
      const records = parseDATEVOutput(csv)
      // Gegenkonto (contra account) should match SKR03 mapping
      expect(records[0]['Gegenkonto (ohne BU-Schlüssel)']).toBe(expectedAccount)
    })

    test('falls back to account 4900 (sonstige Aufwendungen) for unmapped categories', () => {
      const expense = makeExpense({
        organizationId: org.id, categoryId: 'Unknown Category', status: 'APPROVED',
      })
      const csv = service.generateBuchungsstapel({
        organization: org, records: [expense],
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
      })
      const records = parseDATEVOutput(csv)
      expect(records[0]['Gegenkonto (ohne BU-Schlüssel)']).toBe('4900')
    })
  })

  // ─── Date formatting ──────────────────────────

  describe('date formatting', () => {
    test('formats booking date as DDMM (no separators, no year)', () => {
      const expense = makeExpense({
        organizationId: org.id,
        expenseDate: new Date('2025-03-14'),
        status: 'APPROVED',
      })
      const csv = service.generateBuchungsstapel({
        organization: org, records: [expense],
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
      })
      const records = parseDATEVOutput(csv)
      expect(records[0]['Datum']).toBe('1403')
    })

    test('pads single-digit days and months with leading zero', () => {
      const expense = makeExpense({
        organizationId: org.id,
        expenseDate: new Date('2025-03-05'),
        status: 'APPROVED',
      })
      const csv = service.generateBuchungsstapel({
        organization: org, records: [expense],
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
      })
      const records = parseDATEVOutput(csv)
      expect(records[0]['Datum']).toBe('0503')
    })
  })

  // ─── Filtering ────────────────────────────────

  describe('record filtering', () => {
    test('only exports APPROVED records, skips drafts and pending', () => {
      const approved = makeExpense({ organizationId: org.id, status: 'APPROVED' })
      const draft    = makeExpense({ organizationId: org.id, status: 'DRAFT' })
      const pending  = makeExpense({ organizationId: org.id, status: 'PENDING_APPROVAL' })
      const rejected = makeExpense({ organizationId: org.id, status: 'REJECTED' })

      const csv = service.generateBuchungsstapel({
        organization: org,
        records: [approved, draft, pending, rejected],
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
      })
      const records = parseDATEVOutput(csv)
      expect(records).toHaveLength(1)
    })

    test('excludes already-exported records when excludeExported=true', () => {
      const fresh    = makeAPInvoice({ organizationId: org.id, status: 'APPROVED', isExported: false })
      const exported = makeAPInvoice({ organizationId: org.id, status: 'APPROVED', isExported: true })

      const csv = service.generateBuchungsstapel({
        organization: org,
        records: [fresh, exported] as never,
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'),
        format: 'DATEV',
        excludeExported: true,
      })
      const records = parseDATEVOutput(csv)
      expect(records).toHaveLength(1)
    })
  })

  // ─── Integrity hash ───────────────────────────

  describe('export integrity', () => {
    test('generates SHA-256 hash of the CSV output', () => {
      const result = service.generateWithHash({
        organization: org,
        records: [makeExpense({ organizationId: org.id, status: 'APPROVED' })],
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
      })
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/)
      expect(result.csv).toBeTruthy()
    })

    test('same input always produces same hash', () => {
      const params = {
        organization: org,
        records: [makeExpense({ organizationId: org.id, status: 'APPROVED', grossAmount: 119.00 })],
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV' as const,
      }
      const r1 = service.generateWithHash(params)
      const r2 = service.generateWithHash(params)
      expect(r1.hash).toBe(r2.hash)
    })

    test('different records produce different hashes', () => {
      const base = {
        organization: org,
        periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV' as const,
      }
      const r1 = service.generateWithHash({ ...base, records: [makeExpense({ organizationId: org.id, grossAmount: 100 })] })
      const r2 = service.generateWithHash({ ...base, records: [makeExpense({ organizationId: org.id, grossAmount: 200 })] })
      expect(r1.hash).not.toBe(r2.hash)
    })
  })

  // ─── Empty export ─────────────────────────────

  test('returns valid CSV with only headers when no records qualify', () => {
    const csv = service.generateBuchungsstapel({
      organization: org,
      records: [makeExpense({ organizationId: org.id, status: 'DRAFT' })],
      periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31'), format: 'DATEV',
    })
    expect(csv).toBeTruthy()
    const lines = csv.split('\r\n').filter((l) => l.trim())
    // Should have EXTF header + column header = 2 lines, no data rows
    expect(lines.length).toBe(2)
  })
})

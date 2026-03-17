/**
 * LedgerFlow DATEV Export Service
 *
 * Generates DATEV-compatible export files (Buchungsstapel format).
 * This is NOT an official DATEV integration — it produces DATEV-ready
 * CSV/data structures that can be imported into DATEV Unternehmen Online
 * or compatible accounting systems.
 *
 * Based on DATEV Format-Beschreibung Buchungsdatensatz v700
 */

import type { DATEVBuchung } from '@/types'
import type {
  Expense, Reimbursement, SupplierInvoice, CustomerInvoice,
  VATCode, Supplier, Customer
} from '@prisma/client'

// ─────────────────────────────────────────────
// DATEV HEADER
// ─────────────────────────────────────────────

export interface DATEVHeader {
  kennzeichen: 'EXTF'           // Always EXTF for external transfer
  versionsnummer: 700           // Format version
  datenkategorie: 21            // 21 = Buchungsstapel
  formatname: 'Buchungsstapel'
  formatversion: 9
  erzeugt_am: string            // YYYYMMDDHHMMSS
  importiert: string            // empty
  herkunft: 'LF'                // LedgerFlow
  exportiert_von: string        // user name
  importiert_von: string        // empty
  berater: number               // DATEV advisor number (0 if unknown)
  mandant: number               // Client number
  wj_beginn: string             // Fiscal year start YYYYMMDD
  sachkontenlaenge: 4 | 5 | 6 | 7  // Chart of accounts length
  datum_von: string             // YYYYMMDD
  datum_bis: string             // YYYYMMDD
  bezeichnung: string           // Free description
  diktatkuerzel: string         // Dictation abbreviation
  buchungstyp: 1 | 2            // 1 = primary, 2 = corrective
  rechnungslegungszweck: 0      // 0 = default
  festschreibung: false
  wkz: 'EUR'
  wkz_kurs: ''
  derivatskennzeichen: ''
  sachkontenrahmen: 'SKR03' | 'SKR04'
  id_der_sachkontenbeschriftung: 0
  branchenloesungs_id: 0
  reserviert: ''
  reserviert2: ''
}

export function buildDATEVHeader(params: {
  organizationName: string
  exportedBy: string
  dateFrom: Date
  dateTo: Date
  fiscalYearStart: Date
  chartOfAccounts: 'SKR03' | 'SKR04'
  beraterNummer?: number
  mandantNummer?: number
}): DATEVHeader {
  const now = new Date()
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')

  return {
    kennzeichen: 'EXTF',
    versionsnummer: 700,
    datenkategorie: 21,
    formatname: 'Buchungsstapel',
    formatversion: 9,
    erzeugt_am: now.toISOString().slice(0, 19).replace(/[-:T]/g, ''),
    importiert: '',
    herkunft: 'LF',
    exportiert_von: params.exportedBy,
    importiert_von: '',
    berater: params.beraterNummer ?? 0,
    mandant: params.mandantNummer ?? 1,
    wj_beginn: fmt(params.fiscalYearStart),
    sachkontenlaenge: 4,
    datum_von: fmt(params.dateFrom),
    datum_bis: fmt(params.dateTo),
    bezeichnung: `LedgerFlow Export ${params.organizationName}`,
    diktatkuerzel: 'LF',
    buchungstyp: 1,
    rechnungslegungszweck: 0,
    festschreibung: false,
    wkz: 'EUR',
    wkz_kurs: '',
    derivatskennzeichen: '',
    sachkontenrahmen: params.chartOfAccounts,
    id_der_sachkontenbeschriftung: 0,
    branchenloesungs_id: 0,
    reserviert: '',
    reserviert2: '',
  }
}

// ─────────────────────────────────────────────
// HEADER → CSV ROW 1
// ─────────────────────────────────────────────

export function headerToCSVRow(h: DATEVHeader): string {
  const fields = [
    h.kennzeichen, h.versionsnummer, h.datenkategorie, h.formatname, h.formatversion,
    h.erzeugt_am, h.importiert, h.herkunft, h.exportiert_von, h.importiert_von,
    h.berater, h.mandant, h.wj_beginn, h.sachkontenlaenge,
    h.datum_von, h.datum_bis, h.bezeichnung, h.diktatkuerzel,
    h.buchungstyp, h.rechnungslegungszweck, h.festschreibung ? 1 : 0,
    h.wkz, h.wkz_kurs, h.derivatskennzeichen, h.sachkontenrahmen,
    h.id_der_sachkontenbeschriftung, h.branchenloesungs_id, h.reserviert, h.reserviert2,
  ]
  return fields.map(escapeCSV).join(';')
}

// Column header row (row 2)
export const DATEV_COLUMN_HEADER =
  'Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext;Postensperre;Diverse Adressnummer;Geschäftspartnerbank;Sachverhalt;Zinssperre;Beleglink;Beleginfo - Art 1;Beleginfo - Inhalt 1;Kostenmenge;EU-Land u. UmsatzsteuerID;EU-Steuersatz;Abw. Versteuerungsart;Sachkontos ohne Saldo-Nullschutz;Kost 1 - Kostenstelle;Kost 2 - Kostenstelle;Kost-Menge;EU-Mitgliedstaat Steuersatz;Abw. Kostenrechnung;Leistungsdatum;Datum Zuord. Steuerperiode;Fälligkeitsdatum;Generalumkehr (GU);Steuersatz;Land'

// ─────────────────────────────────────────────
// EXPENSE → DATEV BUCHUNG
// ─────────────────────────────────────────────

export function expenseToDATEV(
  expense: Expense & { vatCode?: VATCode | null },
  accountingCode: string,
  bankAccount: string = '1200' // SKR03 default: Kasse
): DATEVBuchung {
  const date = new Date(expense.expenseDate)
  const belegdatum = `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}`

  return {
    umsatz: Math.abs(Number(expense.grossAmount)),
    soll_haben: 'S', // Debit (expense = cost)
    waehrung: expense.currency,
    konto: accountingCode,    // e.g. 4670 (Reisekosten SKR03)
    gegenkonto: bankAccount,  // e.g. 1200 (Bank) or 1600 (Kreditkarte)
    bu_schluessel: expense.vatCode?.datevCode ?? undefined,
    belegdatum,
    belegfeld1: expense.id.slice(0, 12),
    buchungstext: truncate(`${expense.merchant} ${expense.notes ?? ''}`.trim(), 60),
    kost1: undefined, // cost center
  }
}

// ─────────────────────────────────────────────
// SUPPLIER INVOICE → DATEV BUCHUNG
// ─────────────────────────────────────────────

export function supplierInvoiceToDATEV(
  invoice: SupplierInvoice & { supplier: Supplier; vatCode?: VATCode | null },
  accountingCode: string,
  creditorAccount: string // supplier's DATEV creditor account (7x000)
): DATEVBuchung {
  const date = new Date(invoice.invoiceDate)
  const belegdatum = `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}`
  const dueDate = new Date(invoice.dueDate)
  const falligkeitsdatum = dueDate.toISOString().slice(0, 10).replace(/-/g, '')

  return {
    umsatz: Math.abs(Number(invoice.grossAmount)),
    soll_haben: 'S',
    waehrung: invoice.currency,
    konto: accountingCode,
    gegenkonto: creditorAccount,
    bu_schluessel: invoice.vatCode?.datevCode ?? undefined,
    belegdatum,
    belegfeld1: invoice.invoiceNumber.slice(0, 12),
    buchungstext: truncate(`Eingangsrechnung ${invoice.supplier.name}`, 60),
    diverse_adressnummer: creditorAccount,
    falligkeitsdatum,
  }
}

// ─────────────────────────────────────────────
// CUSTOMER INVOICE → DATEV BUCHUNG
// ─────────────────────────────────────────────

export function customerInvoiceToDATEV(
  invoice: CustomerInvoice & { customer: Customer },
  revenueAccount: string = '8400', // SKR03: Erlöse 19% USt
  debtorAccount: string            // customer DATEV debtor account (1x000)
): DATEVBuchung {
  const date = new Date(invoice.issueDate)
  const belegdatum = `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}`

  return {
    umsatz: Number(invoice.total),
    soll_haben: 'H', // Credit (revenue)
    waehrung: invoice.currency,
    konto: revenueAccount,
    gegenkonto: debtorAccount,
    belegdatum,
    belegfeld1: invoice.invoiceNumber.slice(0, 12),
    buchungstext: truncate(`Ausgangsrechnung ${invoice.customer.name}`, 60),
    diverse_adressnummer: debtorAccount,
    leistungsdatum: belegdatum,
  }
}

// ─────────────────────────────────────────────
// BUCHUNG → CSV ROW
// ─────────────────────────────────────────────

export function buchungToCSVRow(b: DATEVBuchung): string {
  const fields: (string | number | boolean | undefined)[] = [
    formatAmount(b.umsatz),
    b.soll_haben,
    b.waehrung,
    b.wechselkurs ?? '',
    b.basis_umsatz ?? '',
    b.basis_waehrung ?? '',
    b.konto,
    b.gegenkonto,
    b.bu_schluessel ?? '',
    b.belegdatum,
    b.belegfeld1,
    b.belegfeld2 ?? '',
    b.skonto ?? '',
    b.buchungstext,
    b.postensperre ? 1 : '',
    b.diverse_adressnummer ?? '',
    b.geschaeftspartner_bank ?? '',
    b.sachverhalt ?? '',
    b.zinssperre ? 1 : '',
    b.beleglink ?? '',
    b.beleginfo_art1 ?? '',
    b.beleginfo_inhalt1 ?? '',
    b.kostenmenge ?? '',
    b.eu_land_u_umsatz ?? '',
    b.eu_steuersatz ?? '',
    b.abw_versteuerungsart ?? '',
    b.sachkontos_ohne_saldo ? 1 : '',
    b.kost1 ?? '',
    b.kost2 ?? '',
    b.kost_menge ?? '',
    b.eu_mitgliedsstaat ?? '',
    b.abw_kostenrechnung ?? '',
    b.leistungsdatum ?? '',
    b.datum_zuord_steuerpflicht ?? '',
    b.falligkeitsdatum ?? '',
    b.generalumkehr ? 1 : '',
    b.steuersatz ?? '',
    b.land ?? '',
  ]
  return fields.map(escapeCSV).join(';')
}

// ─────────────────────────────────────────────
// FULL EXPORT BUILDER
// ─────────────────────────────────────────────

export interface ExportPackage {
  filename: string
  content: string
  encoding: 'UTF-8'
  format: 'DATEV_CSV'
  recordCount: number
  totalAmount: number
}

export function buildDATEVExport(
  header: DATEVHeader,
  buchungen: DATEVBuchung[]
): ExportPackage {
  const lines = [
    headerToCSVRow(header),
    DATEV_COLUMN_HEADER,
    ...buchungen.map(buchungToCSVRow),
  ]

  const totalAmount = buchungen.reduce((sum, b) => sum + b.umsatz, 0)
  const filename = `EXTF_${header.datum_von}_${header.datum_bis}_Buchungsstapel.csv`

  return {
    filename,
    content: lines.join('\r\n'), // DATEV requires CRLF
    encoding: 'UTF-8',
    format: 'DATEV_CSV',
    recordCount: buchungen.length,
    totalAmount,
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function formatAmount(amount: number): string {
  // DATEV uses comma as decimal separator
  return amount.toFixed(2).replace('.', ',')
}

function escapeCSV(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return ''
  const str = String(value)
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) : str
}

// ─────────────────────────────────────────────
// VAT CODE DEFAULTS (German SME)
// ─────────────────────────────────────────────

export const DEFAULT_VAT_CODES = [
  { code: 'VSt19', description: 'Vorsteuer 19%', rate: 19, datevCode: '9', isDeductible: true },
  { code: 'VSt7', description: 'Vorsteuer 7%', rate: 7, datevCode: '8', isDeductible: true },
  { code: 'VSt0', description: 'Steuerfrei', rate: 0, datevCode: '', isDeductible: false },
  { code: 'USt19', description: 'Umsatzsteuer 19%', rate: 19, datevCode: '3', isDeductible: false },
  { code: 'USt7', description: 'Umsatzsteuer 7%', rate: 7, datevCode: '2', isDeductible: false },
  { code: 'EUV', description: 'EU-Erwerb (innergemeinschaftlich)', rate: 19, datevCode: '10', isDeductible: true },
  { code: 'EUIG', description: 'Innergemeinschaftliche Lieferung', rate: 0, datevCode: '21', isDeductible: false },
  { code: 'DRITTLAND', description: 'Drittland / Reverse Charge', rate: 0, datevCode: '40', isDeductible: false },
]

// SKR03 common expense accounts
export const SKR03_EXPENSE_ACCOUNTS: Record<string, { code: string; description: string }> = {
  travel: { code: '4670', description: 'Reisekosten Arbeitnehmer' },
  meals: { code: '4674', description: 'Bewirtungskosten' },
  accommodation: { code: '4671', description: 'Übernachtungskosten' },
  software: { code: '4980', description: 'EDV-Kosten' },
  equipment: { code: '4830', description: 'Werkzeuge und Kleingeräte' },
  office: { code: '4910', description: 'Bürobedarf' },
  phone: { code: '4920', description: 'Telefon' },
  marketing: { code: '4600', description: 'Werbekosten' },
  consulting: { code: '4970', description: 'Beratungskosten' },
  insurance: { code: '4360', description: 'Versicherungsbeiträge' },
  bank_fees: { code: '4970', description: 'Bankgebühren' },
  rent: { code: '4210', description: 'Miete' },
  payroll: { code: '4100', description: 'Löhne und Gehälter' },
}

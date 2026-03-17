/**
 * LedgerFlow CSV/XLSX Import Service
 *
 * Handles bulk import of historical data into LedgerFlow from CSV/Excel exports
 * of legacy accounting systems, bank statements, or expense tools.
 *
 * Supported import types:
 *   expenses        — merchant, amount, date, category, employee, notes
 *   transactions    — date, description, amount, currency, reference
 *   suppliers       — name, VAT ID, email, IBAN, city, payment terms
 *   customers       — name, VAT ID, email, city, payment terms
 *   ap_invoices     — supplier, invoice number, date, due date, amount, VAT
 *
 * Pipeline:
 *   1. Parse CSV/XLSX → raw rows
 *   2. Detect or apply column mapping
 *   3. Validate each row (type coercion, required fields, format checks)
 *   4. Dry-run: return preview with error/warning summary
 *   5. Confirmed import: upsert records in batches of 50
 *   6. Return result: imported, skipped, errors
 */

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export type ImportType = 'expenses' | 'transactions' | 'suppliers' | 'customers' | 'ap_invoices'

export interface ColumnMapping {
  [targetField: string]: string  // targetField → CSV column header
}

export interface ImportRow {
  rowNumber: number
  raw: Record<string, string>
  mapped: Record<string, unknown>
  errors: string[]
  warnings: string[]
  isDuplicate?: boolean
}

export interface ImportPreview {
  importType: ImportType
  totalRows: number
  validRows: number
  errorRows: number
  warningRows: number
  duplicateRows: number
  sampleRows: ImportRow[]   // first 10
  errorSummary: string[]    // top error messages
  columnMapping: ColumnMapping
  detectedColumns: string[]
}

export interface ImportResult {
  importType: ImportType
  totalProcessed: number
  imported: number
  skipped: number
  errors: number
  errorDetails: Array<{ row: number; error: string }>
  importedIds: string[]
}

// ─────────────────────────────────────────────
// COLUMN DEFINITIONS
// ─────────────────────────────────────────────

// Each import type lists its fields with: required, type, aliases (for auto-detection)
const FIELD_DEFS: Record<ImportType, Array<{
  field: string; required: boolean; type: 'string' | 'number' | 'date' | 'email' | 'iban'
  aliases: string[]
}>> = {
  expenses: [
    { field: 'merchant',      required: true,  type: 'string', aliases: ['merchant','händler','lieferant','vendor','supplier','shop'] },
    { field: 'grossAmount',   required: true,  type: 'number', aliases: ['brutto','gross','amount','betrag','total','gesamt'] },
    { field: 'expenseDate',   required: true,  type: 'date',   aliases: ['datum','date','buchungsdatum','belegdatum'] },
    { field: 'currency',      required: false, type: 'string', aliases: ['währung','currency','curr'] },
    { field: 'categoryId',    required: false, type: 'string', aliases: ['kategorie','category','cat','konto'] },
    { field: 'userEmail',     required: false, type: 'email',  aliases: ['mitarbeiter','employee','user','email','nutzer'] },
    { field: 'vatRate',       required: false, type: 'number', aliases: ['mwst','ust','vat','steuersatz','tax_rate'] },
    { field: 'notes',         required: false, type: 'string', aliases: ['notiz','notes','bemerkung','comment','beschreibung'] },
    { field: 'receiptNumber', required: false, type: 'string', aliases: ['belegnr','receipt','beleg','belegnummer'] },
  ],
  transactions: [
    { field: 'transactionDate', required: true,  type: 'date',   aliases: ['datum','date','buchungstag','wertstellung','value_date'] },
    { field: 'description',     required: true,  type: 'string', aliases: ['buchungstext','verwendungszweck','description','text','purpose'] },
    { field: 'amount',          required: true,  type: 'number', aliases: ['betrag','amount','umsatz','value'] },
    { field: 'currency',        required: false, type: 'string', aliases: ['währung','currency'] },
    { field: 'reference',       required: false, type: 'string', aliases: ['referenz','reference','referenznummer','iban_sender'] },
    { field: 'counterpartyName',required: false, type: 'string', aliases: ['auftraggeber','empfänger','counterparty','name'] },
    { field: 'counterpartyIban',required: false, type: 'iban',   aliases: ['iban'] },
  ],
  suppliers: [
    { field: 'name',         required: true,  type: 'string', aliases: ['name','firma','lieferant','company','supplier'] },
    { field: 'vatId',        required: false, type: 'string', aliases: ['ust_id','vat_id','umsatzsteuer_id','vatid','tax_id'] },
    { field: 'email',        required: false, type: 'email',  aliases: ['email','e-mail','rechnungsemail'] },
    { field: 'iban',         required: false, type: 'iban',   aliases: ['iban','bankverbindung'] },
    { field: 'city',         required: false, type: 'string', aliases: ['ort','city','stadt'] },
    { field: 'country',      required: false, type: 'string', aliases: ['land','country'] },
    { field: 'paymentTerms', required: false, type: 'number', aliases: ['zahlungsziel','payment_terms','tage','days'] },
  ],
  customers: [
    { field: 'name',         required: true,  type: 'string', aliases: ['name','firma','kunde','customer','company'] },
    { field: 'vatId',        required: false, type: 'string', aliases: ['ust_id','vat_id','umsatzsteuer_id'] },
    { field: 'email',        required: false, type: 'email',  aliases: ['email','e-mail','rechnungsemail'] },
    { field: 'city',         required: false, type: 'string', aliases: ['ort','city','stadt'] },
    { field: 'country',      required: false, type: 'string', aliases: ['land','country'] },
    { field: 'paymentTerms', required: false, type: 'number', aliases: ['zahlungsziel','payment_terms','tage','days'] },
  ],
  ap_invoices: [
    { field: 'supplierName',  required: true,  type: 'string', aliases: ['lieferant','supplier','vendor','firma'] },
    { field: 'invoiceNumber', required: true,  type: 'string', aliases: ['rechnungsnummer','invoice_number','belegnr','re_nr'] },
    { field: 'invoiceDate',   required: true,  type: 'date',   aliases: ['rechnungsdatum','invoice_date','datum','date'] },
    { field: 'dueDate',       required: false, type: 'date',   aliases: ['fälligkeitsdatum','due_date','fälligkeit','zahlbar_bis'] },
    { field: 'grossAmount',   required: true,  type: 'number', aliases: ['brutto','gross','total','gesamt','betrag'] },
    { field: 'netAmount',     required: false, type: 'number', aliases: ['netto','net','nettobetrag'] },
    { field: 'vatAmount',     required: false, type: 'number', aliases: ['mwst','vat','steuer','steuerbetrag'] },
    { field: 'currency',      required: false, type: 'string', aliases: ['währung','currency'] },
    { field: 'notes',         required: false, type: 'string', aliases: ['notiz','notes','bemerkung'] },
  ],
}

// ─────────────────────────────────────────────
// CSV PARSER
// ─────────────────────────────────────────────

export function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  // Detect separator (;, ,, \t)
  const firstLine = content.split('\n')[0]
  const sep = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ','

  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter(l => l.trim().length > 0)

  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row')

  const headers = parseCSVLine(lines[0], sep).map(h => h.trim().toLowerCase())

  const rows = lines.slice(1).map(line => parseCSVLine(line, sep))

  return { headers, rows }
}

function parseCSVLine(line: string, sep: string): string[] {
  const result: string[] = []
  let i = 0
  let inQuotes = false
  let current = ''

  while (i < line.length) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i += 2 }
      else { inQuotes = !inQuotes; i++ }
    } else if (ch === sep && !inQuotes) {
      result.push(current.trim())
      current = ''
      i++
    } else {
      current += ch
      i++
    }
  }
  result.push(current.trim())
  return result
}

// ─────────────────────────────────────────────
// AUTO COLUMN MAPPER
// ─────────────────────────────────────────────

export function detectColumnMapping(
  headers: string[],
  importType: ImportType
): ColumnMapping {
  const defs = FIELD_DEFS[importType]
  const mapping: ColumnMapping = {}
  const normalised = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, '_'))

  for (const def of defs) {
    const match = normalised.findIndex(h =>
      def.aliases.some(alias => h === alias || h.includes(alias))
    )
    if (match !== -1) {
      mapping[def.field] = headers[match]
    }
  }

  return mapping
}

// ─────────────────────────────────────────────
// ROW VALIDATOR
// ─────────────────────────────────────────────

function parseGermanDate(val: string): string | null {
  // Formats: DD.MM.YYYY, YYYY-MM-DD, DD/MM/YYYY
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(val)) {
    const [d, m, y] = val.split('.')
    return `${y}-${m}-${d}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
    const [d, m, y] = val.split('/')
    return `${y}-${m}-${d}`
  }
  return null
}

function parseGermanNumber(val: string): number | null {
  // German: 1.234,56 → 1234.56
  const cleaned = val.replace(/[^\d,.-]/g, '').replace('.', '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

function validateIBAN(val: string): boolean {
  const iban = val.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false
  if (iban.length < 15 || iban.length > 34) return false
  return true
}

export function validateRow(
  raw: Record<string, string>,
  mapping: ColumnMapping,
  importType: ImportType,
  rowNumber: number
): ImportRow {
  const defs = FIELD_DEFS[importType]
  const mapped: Record<string, unknown> = {}
  const errors: string[] = []
  const warnings: string[] = []

  for (const def of defs) {
    const colName = mapping[def.field]
    const rawVal = colName ? (raw[colName] ?? '').trim() : ''

    if (!rawVal) {
      if (def.required) errors.push(`Missing required field: ${def.field}`)
      continue
    }

    switch (def.type) {
      case 'string':
        mapped[def.field] = rawVal
        break

      case 'number': {
        const n = parseGermanNumber(rawVal)
        if (n === null) errors.push(`Invalid number for ${def.field}: "${rawVal}"`)
        else mapped[def.field] = n
        break
      }

      case 'date': {
        const d = parseGermanDate(rawVal)
        if (!d) errors.push(`Invalid date for ${def.field}: "${rawVal}" (expected DD.MM.YYYY or YYYY-MM-DD)`)
        else {
          const parsed = new Date(d)
          if (isNaN(parsed.getTime())) errors.push(`Invalid date for ${def.field}: "${rawVal}"`)
          else {
            mapped[def.field] = parsed
            if (parsed > new Date()) warnings.push(`${def.field} is in the future`)
            if (parsed < new Date('2000-01-01')) warnings.push(`${def.field} is before year 2000`)
          }
        }
        break
      }

      case 'email':
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawVal)) mapped[def.field] = rawVal.toLowerCase()
        else warnings.push(`${def.field} "${rawVal}" doesn't look like an email address`)
        break

      case 'iban':
        if (validateIBAN(rawVal)) mapped[def.field] = rawVal.replace(/\s/g, '').toUpperCase()
        else warnings.push(`${def.field} "${rawVal}" doesn't look like a valid IBAN`)
        break
    }
  }

  return { rowNumber, raw, mapped, errors, warnings }
}

// ─────────────────────────────────────────────
// DRY-RUN PREVIEW
// ─────────────────────────────────────────────

export function buildImportPreview(
  csvContent: string,
  importType: ImportType,
  customMapping?: ColumnMapping
): ImportPreview {
  const { headers, rows } = parseCSV(csvContent)
  const mapping = customMapping ?? detectColumnMapping(headers, importType)

  const rawObjects = rows.map(row => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = row[i] ?? '' })
    return obj
  })

  const validatedRows = rawObjects.map((raw, i) => validateRow(raw, mapping, importType, i + 2))

  const validRows = validatedRows.filter(r => r.errors.length === 0).length
  const errorRows = validatedRows.filter(r => r.errors.length > 0).length
  const warningRows = validatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length

  // Collect top errors
  const allErrors = validatedRows.flatMap(r => r.errors)
  const errorCounts = new Map<string, number>()
  allErrors.forEach(e => errorCounts.set(e, (errorCounts.get(e) ?? 0) + 1))
  const errorSummary = [...errorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([msg, count]) => `${msg} (${count} rows)`)

  return {
    importType,
    totalRows: rows.length,
    validRows,
    errorRows,
    warningRows,
    duplicateRows: 0, // Filled in during actual import
    sampleRows: validatedRows.slice(0, 10),
    errorSummary,
    columnMapping: mapping,
    detectedColumns: headers,
  }
}

// ─────────────────────────────────────────────
// BATCH IMPORTER
// ─────────────────────────────────────────────

import { prisma } from '@/lib/db/prisma'

const BATCH_SIZE = 50

export async function executeImport(
  csvContent: string,
  importType: ImportType,
  organizationId: string,
  mapping: ColumnMapping,
  options: { skipErrors?: boolean; defaultUserId?: string } = {}
): Promise<ImportResult> {
  const { headers, rows } = parseCSV(csvContent)

  const rawObjects = rows.map(row => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = row[i] ?? '' })
    return obj
  })

  const validatedRows = rawObjects.map((raw, i) => validateRow(raw, mapping, importType, i + 2))
  const toImport = validatedRows.filter(r => r.errors.length === 0 || options.skipErrors)

  const result: ImportResult = {
    importType,
    totalProcessed: rows.length,
    imported: 0,
    skipped: rows.length - toImport.length,
    errors: rows.length - toImport.length,
    errorDetails: validatedRows
      .filter(r => r.errors.length > 0)
      .map(r => ({ row: r.rowNumber, error: r.errors.join('; ') })),
    importedIds: [],
  }

  // Process in batches
  for (let i = 0; i < toImport.length; i += BATCH_SIZE) {
    const batch = toImport.slice(i, i + BATCH_SIZE)
    const ids = await importBatch(batch, importType, organizationId, options)
    result.importedIds.push(...ids)
    result.imported += ids.length
  }

  // Record import in audit log
  await prisma.auditLog.create({
    data: {
      organizationId,
      action: 'BULK_IMPORT',
      entityType: importType,
      entityId: organizationId,
      metadata: {
        importType,
        totalProcessed: result.totalProcessed,
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors,
      },
    },
  })

  return result
}

async function importBatch(
  rows: ImportRow[],
  importType: ImportType,
  orgId: string,
  options: { defaultUserId?: string }
): Promise<string[]> {
  const ids: string[] = []

  for (const row of rows) {
    try {
      const d = row.mapped
      let id: string | null = null

      switch (importType) {
        case 'expenses': {
          // Find or resolve user
          let userId = options.defaultUserId ?? ''
          if (d.userEmail) {
            const user = await prisma.user.findFirst({
              where: { email: d.userEmail as string, organizationMembers: { some: { organizationId: orgId } } },
            })
            if (user) userId = user.id
          }

          const expense = await prisma.expense.create({
            data: {
              organizationId: orgId,
              userId,
              merchant: d.merchant as string,
              grossAmount: d.grossAmount as number,
              netAmount: d.netAmount as number ?? ((d.grossAmount as number) / (1 + (d.vatRate as number ?? 0.19))),
              vatAmount: d.vatAmount as number ?? ((d.grossAmount as number) - ((d.grossAmount as number) / (1 + (d.vatRate as number ?? 0.19)))),
              vatRate: d.vatRate as number ?? null,
              currency: (d.currency as string | undefined) ?? 'EUR',
              expenseDate: d.expenseDate as Date,
              categoryId: d.categoryId as string | undefined,
              notes: d.notes as string | undefined,
              receiptNumber: d.receiptNumber as string | undefined,
              status: 'SUBMITTED',
              source: 'IMPORT',
            },
          })
          id = expense.id
          break
        }

        case 'transactions': {
          const tx = await prisma.transaction.create({
            data: {
              organizationId: orgId,
              transactionDate: d.transactionDate as Date,
              description: d.description as string,
              amount: d.amount as number,
              currency: (d.currency as string | undefined) ?? 'EUR',
              reference: d.reference as string | undefined,
              counterpartyName: d.counterpartyName as string | undefined,
              counterpartyIban: d.counterpartyIban as string | undefined,
              source: 'IMPORT',
            },
          })
          id = tx.id
          break
        }

        case 'suppliers': {
          const supplier = await prisma.supplier.upsert({
            where: { organizationId_name: { organizationId: orgId, name: d.name as string } },
            create: {
              organizationId: orgId,
              name: d.name as string,
              vatId: d.vatId as string | undefined,
              email: d.email as string | undefined,
              iban: d.iban as string | undefined,
              city: d.city as string | undefined,
              country: (d.country as string | undefined) ?? 'DE',
              paymentTerms: d.paymentTerms as number | undefined,
            },
            update: {
              vatId: (d.vatId as string | undefined) ?? undefined,
              email: (d.email as string | undefined) ?? undefined,
              iban: (d.iban as string | undefined) ?? undefined,
              city: (d.city as string | undefined) ?? undefined,
            },
          })
          id = supplier.id
          break
        }

        case 'customers': {
          const customer = await prisma.customer.upsert({
            where: { organizationId_name: { organizationId: orgId, name: d.name as string } },
            create: {
              organizationId: orgId,
              name: d.name as string,
              vatId: d.vatId as string | undefined,
              email: d.email as string | undefined,
              city: d.city as string | undefined,
              country: (d.country as string | undefined) ?? 'DE',
              paymentTerms: d.paymentTerms as number | undefined,
            },
            update: {
              vatId: (d.vatId as string | undefined) ?? undefined,
              email: (d.email as string | undefined) ?? undefined,
            },
          })
          id = customer.id
          break
        }

        case 'ap_invoices': {
          // Find or create supplier
          const supplierName = d.supplierName as string
          let supplier = await prisma.supplier.findFirst({ where: { organizationId: orgId, name: supplierName } })
          if (!supplier) {
            supplier = await prisma.supplier.create({
              data: { organizationId: orgId, name: supplierName, country: 'DE' },
            })
          }

          const gross = d.grossAmount as number
          const net = (d.netAmount as number | undefined) ?? gross / 1.19
          const vat = (d.vatAmount as number | undefined) ?? (gross - net)

          const inv = await prisma.supplierInvoice.create({
            data: {
              organizationId: orgId,
              supplierId: supplier.id,
              invoiceNumber: d.invoiceNumber as string,
              invoiceDate: d.invoiceDate as Date,
              dueDate: (d.dueDate as Date | undefined) ?? new Date(Date.now() + 30 * 86400_000),
              totalAmount: gross,
              netAmount: net,
              vatAmount: vat,
              currency: (d.currency as string | undefined) ?? 'EUR',
              notes: d.notes as string | undefined,
              status: 'DRAFT',
              source: 'IMPORT',
            },
          })
          id = inv.id
          break
        }
      }

      if (id) ids.push(id)
    } catch (err) {
      console.error(`[Import] Row ${row.rowNumber} failed:`, err)
    }
  }

  return ids
}

// ─────────────────────────────────────────────
// TEMPLATE GENERATOR — downloadable CSV templates
// ─────────────────────────────────────────────

export function generateCSVTemplate(importType: ImportType): string {
  const defs = FIELD_DEFS[importType]

  const headers = defs.map(d => d.aliases[0]) // Use first alias as header

  const examples: Record<ImportType, string[]> = {
    expenses: [
      'Lufthansa,842.00,14.03.2025,EUR,Travel,max.mustermann@firma.de,19,Flug München-Berlin Hin/Rückflug',
      'AWS GmbH,1240.00,13.03.2025,EUR,Software,,0,AWS Frankfurt Monatsrechnung',
    ],
    transactions: [
      '14.03.2025,Lufthansa Berlin-München,-842.00,EUR,TXN-001,Lufthansa AG,DE12500105170648489890',
      '11.03.2025,Kunde GmbH – Zahlung RE-2025-042,+24000.00,EUR,REF-001,Kunde GmbH,',
    ],
    suppliers: [
      'Siemens AG,,rechnungen@siemens.com,DE12345678901234567890,München,DE,30',
      'KPMG Germany,DE987654321,invoice@kpmg.de,,Frankfurt,DE,14',
    ],
    customers: [
      'Techcorp Berlin GmbH,DE111222333,ap@techcorp.de,Berlin,DE,30',
      'Innovate AG,DE444555666,buchhaltung@innovate.de,Hamburg,DE,14',
    ],
    ap_invoices: [
      'Siemens AG,INV-2025-001,01.03.2025,31.03.2025,9907.00,8324.37,1582.63,EUR,Wartungsvertrag Q1',
      'KPMG Germany,INV-2025-002,15.03.2025,29.03.2025,14280.00,12000.00,2280.00,EUR,Steuerberatung März',
    ],
  }

  const rows = examples[importType]
  const sep = ';'

  const lines = [
    `# LedgerFlow Import Template — ${importType}`,
    `# ${defs.filter(d => d.required).map(d => d.field).join(', ')} are required`,
    `# Date format: DD.MM.YYYY or YYYY-MM-DD`,
    `# Number format: 1234.56 or 1234,56`,
    headers.join(sep),
    ...rows,
  ]

  return lines.join('\r\n')
}

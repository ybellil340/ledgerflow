/**
 * LedgerFlow PDF Invoice Service
 *
 * Generates legally-compliant German Rechnungen (invoices) as HTML and PDF.
 *
 * German invoice mandatory fields (§14 Abs. 4 UStG — Pflichtangaben):
 *   ✓ Full name and address of the issuer (Leistungserbringer)
 *   ✓ Full name and address of the recipient (Leistungsempfänger)
 *   ✓ Tax number or VAT ID of the issuer
 *   ✓ Invoice date (Ausstellungsdatum)
 *   ✓ Sequential invoice number (fortlaufende Nummer)
 *   ✓ Quantity and type of goods/services (Menge und Art der Leistung)
 *   ✓ Service date or period (Leistungsdatum/-zeitraum)
 *   ✓ Net amount per tax rate (Entgelt)
 *   ✓ Tax rate applied (Steuersatz)
 *   ✓ Tax amount (Steuerbetrag)
 *   ✓ Gross total (Gesamtbetrag)
 *   ✓ Reverse charge notice (§13b UStG) when applicable
 *   ✓ Small business notice (§19 UStG) when applicable
 *
 * Output strategy:
 *   - Generates clean HTML (can be printed / saved as PDF from browser)
 *   - Server-side: uses puppeteer if available, falls back to HTML response
 *   - The HTML is self-contained with inline styles (no external deps)
 *
 * Usage:
 *   const html = generateInvoiceHTML(invoice)
 *   // or
 *   const pdfBuffer = await generateInvoicePDF(invoice)  // requires puppeteer
 */

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface InvoiceLineItem {
  position: number
  description: string
  quantity: number
  unit: string        // 'Std.', 'Stk.', 'Pauschal', 'Tag', 'km', etc.
  unitNetPrice: number
  netAmount: number
  vatRate: number     // 0, 7, 19
  vatAmount: number
  grossAmount: number
  serviceDate?: string // YYYY-MM-DD — for the Leistungsdatum field
}

export interface InvoiceParty {
  name: string
  legalForm?: string       // GmbH, AG, etc.
  street?: string
  city?: string
  postalCode?: string
  country?: string         // ISO 3166-1 alpha-2
  vatId?: string           // DE123456789
  taxNumber?: string       // Steuernummer
  email?: string
  phone?: string
  website?: string
  bankName?: string
  iban?: string
  bic?: string
}

export interface InvoiceData {
  invoiceNumber: string    // RE-2025-042
  invoiceDate: string      // YYYY-MM-DD
  dueDate: string          // YYYY-MM-DD
  serviceDate?: string     // YYYY-MM-DD or period like "März 2025"
  currency: string         // EUR
  issuer: InvoiceParty
  recipient: InvoiceParty
  lineItems: InvoiceLineItem[]
  // Totals
  netTotal: number
  vatBreakdown: Array<{ rate: number; netAmount: number; vatAmount: number }>
  grossTotal: number
  alreadyPaid?: number
  amountDue: number
  // Flags
  isReverseCharge?: boolean    // §13b UStG — cross-border B2B EU
  isSmallBusiness?: boolean    // §19 UStG — Kleinunternehmer
  // Optional
  notes?: string
  paymentTerms?: string        // e.g. "Zahlbar innerhalb von 30 Tagen"
  subject?: string             // Optional subject line above line items
  footerNote?: string
  logoBase64?: string          // data:image/png;base64,...
}

// ─────────────────────────────────────────────
// NUMBER / DATE FORMATTERS
// ─────────────────────────────────────────────

const fmtNum = (n: number, decimals = 2) =>
  new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)

const fmtCurrency = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(n)

const fmtDate = (dateStr: string) => {
  const d = new Date(dateStr)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
}

// ─────────────────────────────────────────────
// HTML GENERATOR
// ─────────────────────────────────────────────

export function generateInvoiceHTML(invoice: InvoiceData): string {
  const {
    invoiceNumber, invoiceDate, dueDate, serviceDate, currency,
    issuer, recipient, lineItems, netTotal, vatBreakdown, grossTotal,
    alreadyPaid, amountDue, isReverseCharge, isSmallBusiness,
    notes, paymentTerms, subject, footerNote, logoBase64,
  } = invoice

  const accentColor = '#1a1a2e'

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Rechnung ${invoiceNumber}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; font-size: 9pt; color: #1a1a1a; line-height: 1.5; background: #fff; }
  .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 18mm 18mm 20mm; }
  
  /* Header */
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12mm; }
  .logo { max-height: 14mm; max-width: 50mm; }
  .company-name { font-size: 14pt; font-weight: 700; color: ${accentColor}; letter-spacing: -.3px; }
  .company-sub { font-size: 8pt; color: #888; margin-top: 1pt; }
  .inv-number-block { text-align: right; }
  .inv-label { font-size: 8pt; color: #888; text-transform: uppercase; letter-spacing: .5px; }
  .inv-number { font-size: 14pt; font-weight: 600; color: ${accentColor}; }

  /* Address block */
  .addr-row { display: flex; justify-content: space-between; margin-bottom: 8mm; }
  .addr-box { width: 48%; }
  .addr-title { font-size: 7.5pt; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: .6px; margin-bottom: 3pt; padding-bottom: 2pt; border-bottom: .5px solid #e0e0e0; }
  .addr-name { font-size: 10pt; font-weight: 600; margin-bottom: 1pt; }
  .addr-line { font-size: 8.5pt; color: #333; }
  .addr-vat { font-size: 8pt; color: #666; margin-top: 3pt; font-family: monospace; }

  /* Meta row */
  .meta-row { display: flex; gap: 8mm; margin-bottom: 7mm; padding: 4mm 5mm; background: #f8f8f6; border-radius: 4pt; }
  .meta-item { }
  .meta-label { font-size: 7.5pt; color: #888; text-transform: uppercase; letter-spacing: .4px; }
  .meta-value { font-size: 9pt; font-weight: 500; margin-top: 1pt; }

  /* Subject */
  .subject { font-size: 10pt; font-weight: 600; margin-bottom: 5mm; }

  /* Line items table */
  table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  thead tr { background: ${accentColor}; color: #fff; }
  thead th { padding: 4pt 6pt; font-size: 8pt; font-weight: 500; text-align: left; }
  thead th:not(:first-child) { text-align: right; }
  tbody tr:nth-child(even) { background: #fafafa; }
  tbody td { padding: 5pt 6pt; font-size: 8.5pt; border-bottom: .5px solid #f0f0f0; vertical-align: top; }
  tbody td:not(:first-child) { text-align: right; white-space: nowrap; }
  .pos-col { color: #888; width: 22pt; }
  .desc-col { width: auto; }
  .desc-main { font-weight: 500; }
  .desc-date { font-size: 7.5pt; color: #888; margin-top: 1pt; }
  .qty-col { width: 48pt; }
  .unit-col { width: 32pt; color: #666; }
  .price-col { width: 58pt; }
  .vat-col { width: 32pt; color: #666; }
  .net-col { width: 62pt; }
  .gross-col { width: 66pt; font-weight: 500; }

  /* Totals */
  .totals { display: flex; justify-content: flex-end; margin-bottom: 6mm; }
  .totals-box { width: 74mm; }
  .totals-row { display: flex; justify-content: space-between; padding: 2.5pt 0; font-size: 8.5pt; border-bottom: .5px solid #f0f0f0; }
  .totals-row.vat-row { color: #555; }
  .totals-row.total-row { font-size: 10pt; font-weight: 700; border-bottom: none; border-top: 1px solid ${accentColor}; padding-top: 4pt; margin-top: 2pt; color: ${accentColor}; }
  .totals-row.paid-row { color: #3B6D11; }
  .totals-row.due-row { font-size: 11pt; font-weight: 700; color: ${accentColor}; border-top: 1.5px solid ${accentColor}; padding-top: 5pt; margin-top: 3pt; border-bottom: none; }

  /* VAT notice */
  .vat-notice { font-size: 7.5pt; color: #666; padding: 4pt 6pt; background: #f8f8f6; border-radius: 3pt; border-left: 2pt solid #aaa; margin-bottom: 6mm; }

  /* Payment info */
  .payment-box { margin-bottom: 8mm; padding: 4mm 5mm; border: .5px solid #e0e0e0; border-radius: 4pt; }
  .payment-title { font-size: 8pt; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; color: #888; margin-bottom: 3pt; }
  .payment-row { display: flex; justify-content: space-between; font-size: 8.5pt; padding: 1.5pt 0; }
  .payment-label { color: #666; }
  .payment-value { font-family: monospace; font-weight: 500; }
  .iban { letter-spacing: 1.5px; }

  /* Notes */
  .notes { font-size: 8.5pt; color: #444; line-height: 1.6; margin-bottom: 8mm; }

  /* Footer */
  .footer { position: fixed; bottom: 12mm; left: 18mm; right: 18mm; padding-top: 3mm; border-top: .5px solid #e0e0e0; display: flex; justify-content: space-between; font-size: 7pt; color: #999; }

  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .page { padding: 15mm; }
    .footer { position: fixed; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="hdr">
    <div>
      ${logoBase64 ? `<img src="${logoBase64}" alt="${issuer.name}" class="logo"/>` : `
      <div class="company-name">${esc(issuer.name)}${issuer.legalForm ? ` <span style="font-weight:400;font-size:11pt">${esc(issuer.legalForm)}</span>` : ''}</div>
      <div class="company-sub">${[issuer.street, issuer.postalCode ? `${issuer.postalCode} ${issuer.city}` : issuer.city].filter(Boolean).join(' · ')}</div>
      `}
    </div>
    <div class="inv-number-block">
      <div class="inv-label">Rechnung</div>
      <div class="inv-number">${esc(invoiceNumber)}</div>
    </div>
  </div>

  <!-- ADDRESSES -->
  <div class="addr-row">
    <div class="addr-box">
      <div class="addr-title">Rechnungssteller</div>
      <div class="addr-name">${esc(issuer.name)}</div>
      ${issuer.street ? `<div class="addr-line">${esc(issuer.street)}</div>` : ''}
      ${issuer.postalCode || issuer.city ? `<div class="addr-line">${esc([issuer.postalCode, issuer.city].filter(Boolean).join(' '))}</div>` : ''}
      ${issuer.country && issuer.country !== 'DE' ? `<div class="addr-line">${esc(issuer.country)}</div>` : ''}
      ${issuer.email ? `<div class="addr-line" style="color:#185FA5">${esc(issuer.email)}</div>` : ''}
      ${issuer.website ? `<div class="addr-line" style="color:#185FA5">${esc(issuer.website)}</div>` : ''}
      ${issuer.vatId ? `<div class="addr-vat">USt-IdNr.: ${esc(issuer.vatId)}</div>` : ''}
      ${issuer.taxNumber ? `<div class="addr-vat">Steuernr.: ${esc(issuer.taxNumber)}</div>` : ''}
    </div>
    <div class="addr-box">
      <div class="addr-title">Rechnungsempfänger</div>
      <div class="addr-name">${esc(recipient.name)}</div>
      ${recipient.street ? `<div class="addr-line">${esc(recipient.street)}</div>` : ''}
      ${recipient.postalCode || recipient.city ? `<div class="addr-line">${esc([recipient.postalCode, recipient.city].filter(Boolean).join(' '))}</div>` : ''}
      ${recipient.country && recipient.country !== 'DE' ? `<div class="addr-line">${esc(recipient.country)}</div>` : ''}
      ${recipient.vatId ? `<div class="addr-vat">USt-IdNr.: ${esc(recipient.vatId)}</div>` : ''}
    </div>
  </div>

  <!-- META STRIP -->
  <div class="meta-row">
    ${[
      ['Rechnungsdatum', fmtDate(invoiceDate)],
      ['Fälligkeitsdatum', fmtDate(dueDate)],
      serviceDate ? ['Leistungsdatum', serviceDate.length === 10 ? fmtDate(serviceDate) : esc(serviceDate)] : null,
      ['Währung', currency],
    ].filter(Boolean).map(([label, value]) => `
    <div class="meta-item">
      <div class="meta-label">${label}</div>
      <div class="meta-value">${value}</div>
    </div>`).join('')}
  </div>

  ${subject ? `<div class="subject">Betreff: ${esc(subject)}</div>` : ''}

  <!-- LINE ITEMS -->
  <table>
    <thead>
      <tr>
        <th class="pos-col">Pos.</th>
        <th class="desc-col">Beschreibung</th>
        <th class="qty-col">Menge</th>
        <th class="unit-col">Einh.</th>
        <th class="price-col">EP (netto)</th>
        <th class="vat-col">MwSt.</th>
        <th class="net-col">Netto</th>
        <th class="gross-col">Brutto</th>
      </tr>
    </thead>
    <tbody>
      ${lineItems.map(item => `
      <tr>
        <td class="pos-col" style="color:#888">${item.position}</td>
        <td class="desc-col">
          <div class="desc-main">${esc(item.description)}</div>
          ${item.serviceDate ? `<div class="desc-date">Leistung: ${fmtDate(item.serviceDate)}</div>` : ''}
        </td>
        <td class="qty-col">${fmtNum(item.quantity)}</td>
        <td class="unit-col">${esc(item.unit)}</td>
        <td class="price-col">${fmtCurrency(item.unitNetPrice, currency)}</td>
        <td class="vat-col">${item.vatRate}%</td>
        <td class="net-col">${fmtCurrency(item.netAmount, currency)}</td>
        <td class="gross-col">${fmtCurrency(item.grossAmount, currency)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <!-- TOTALS -->
  <div class="totals">
    <div class="totals-box">
      <div class="totals-row">
        <span>Nettobetrag</span>
        <span>${fmtCurrency(netTotal, currency)}</span>
      </div>
      ${vatBreakdown.map(vb => `
      <div class="totals-row vat-row">
        <span>MwSt. ${vb.rate}% auf ${fmtCurrency(vb.netAmount, currency)}</span>
        <span>${fmtCurrency(vb.vatAmount, currency)}</span>
      </div>`).join('')}
      <div class="totals-row total-row">
        <span>Gesamtbetrag</span>
        <span>${fmtCurrency(grossTotal, currency)}</span>
      </div>
      ${alreadyPaid !== undefined && alreadyPaid > 0 ? `
      <div class="totals-row paid-row">
        <span>Bereits bezahlt</span>
        <span>− ${fmtCurrency(alreadyPaid, currency)}</span>
      </div>
      <div class="totals-row due-row">
        <span>Offener Betrag</span>
        <span>${fmtCurrency(amountDue, currency)}</span>
      </div>` : ''}
    </div>
  </div>

  <!-- LEGAL NOTICES -->
  ${isReverseCharge ? `
  <div class="vat-notice">
    <strong>Steuerschuldnerschaft des Leistungsempfängers (§13b UStG):</strong> Die Umsatzsteuer wird vom Leistungsempfänger geschuldet. Diese Rechnung enthält daher keine Umsatzsteuer.
  </div>` : ''}
  ${isSmallBusiness ? `
  <div class="vat-notice">
    <strong>Hinweis gemäß §19 UStG:</strong> Es wird kein Umsatzsteuerausweis vorgenommen, da der Rechnungssteller der Kleinunternehmerregelung unterliegt.
  </div>` : ''}

  <!-- PAYMENT INFO -->
  ${issuer.iban ? `
  <div class="payment-box">
    <div class="payment-title">Zahlungsinformationen</div>
    ${paymentTerms ? `<div style="font-size:8.5pt;color:#333;margin-bottom:3pt">${esc(paymentTerms)}</div>` : ''}
    ${issuer.bankName ? `<div class="payment-row"><span class="payment-label">Bank</span><span class="payment-value">${esc(issuer.bankName)}</span></div>` : ''}
    <div class="payment-row"><span class="payment-label">IBAN</span><span class="payment-value iban">${esc(issuer.iban)}</span></div>
    ${issuer.bic ? `<div class="payment-row"><span class="payment-label">BIC</span><span class="payment-value">${esc(issuer.bic)}</span></div>` : ''}
    <div class="payment-row"><span class="payment-label">Verwendungszweck</span><span class="payment-value">${esc(invoiceNumber)}</span></div>
    ${dueDate ? `<div class="payment-row"><span class="payment-label">Bitte überweisen bis</span><span class="payment-value">${fmtDate(dueDate)}</span></div>` : ''}
  </div>` : ''}

  <!-- NOTES -->
  ${notes ? `<div class="notes">${esc(notes).replace(/\n/g, '<br/>')}</div>` : ''}
  ${footerNote ? `<div style="font-size:8pt;color:#888;margin-top:4mm;border-top:.5px solid #e8e8e8;padding-top:3mm">${esc(footerNote)}</div>` : ''}

  <!-- FOOTER (fixed at page bottom) -->
  <div class="footer">
    <span>${esc(issuer.name)} ${issuer.legalForm ? `· ${issuer.legalForm}` : ''}</span>
    <span>${esc(invoiceNumber)} · ${fmtDate(invoiceDate)}</span>
    <span>${issuer.vatId ? `USt-IdNr.: ${esc(issuer.vatId)}` : issuer.taxNumber ? `Steuernr.: ${esc(issuer.taxNumber)}` : ''}</span>
  </div>

</div>
</body>
</html>`
}

// ─────────────────────────────────────────────
// PDF GENERATION (puppeteer)
// ─────────────────────────────────────────────

/**
 * Generate a PDF buffer from the invoice HTML.
 * Requires puppeteer: `npm install puppeteer`
 *
 * Falls back gracefully if puppeteer is not installed (returns null).
 */
export async function generateInvoicePDF(invoice: InvoiceData): Promise<Buffer | null> {
  let puppeteer: typeof import('puppeteer') | null = null

  try {
    puppeteer = await import('puppeteer')
  } catch {
    console.warn('[PDF] puppeteer not installed — returning null. Install with: npm install puppeteer')
    return null
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    const html = generateInvoiceHTML(invoice)

    await page.setContent(html, { waitUntil: 'networkidle0' })
    await page.emulateMediaType('print')

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      displayHeaderFooter: false,
    })

    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

// ─────────────────────────────────────────────
// BUILDER — convert Prisma CustomerInvoice → InvoiceData
// ─────────────────────────────────────────────

export interface PrismaInvoiceInput {
  invoiceNumber: string
  invoiceDate: Date
  dueDate: Date
  serviceDate?: Date | null
  currency: string
  notes?: string | null
  totalAmount: number
  netAmount: number
  vatAmount: number
  paidAmount?: number | null
  lineItems: Array<{
    position: number
    description: string
    quantity: number
    unit: string
    unitPrice: number
    netAmount: number
    vatRate: number
    vatAmount: number
    grossAmount: number
    serviceDate?: Date | null
  }>
  organization: {
    name: string
    legalForm?: string | null
    street?: string | null
    city?: string | null
    postalCode?: string | null
    country?: string | null
    vatId?: string | null
    taxNumber?: string | null
    email?: string | null
    phone?: string | null
    website?: string | null
    bankName?: string | null
    iban?: string | null
    bic?: string | null
    isSmallBusiness?: boolean
  }
  customer: {
    name: string
    street?: string | null
    city?: string | null
    postalCode?: string | null
    country?: string | null
    vatId?: string | null
  }
}

export function buildInvoiceData(input: PrismaInvoiceInput): InvoiceData {
  const { organization: org, customer } = input

  // Compute VAT breakdown
  const vatMap = new Map<number, { net: number; vat: number }>()
  for (const li of input.lineItems) {
    const existing = vatMap.get(li.vatRate) ?? { net: 0, vat: 0 }
    vatMap.set(li.vatRate, { net: existing.net + li.netAmount, vat: existing.vat + li.vatAmount })
  }
  const vatBreakdown = [...vatMap.entries()].map(([rate, { net, vat }]) => ({
    rate, netAmount: net, vatAmount: vat,
  }))

  const paidAmount = Number(input.paidAmount ?? 0)
  const grossTotal = Number(input.totalAmount)
  const amountDue = grossTotal - paidAmount

  // Detect reverse charge (EU recipient with VAT ID, different country, 0% VAT on items)
  const isReverseCharge = !!(
    customer.vatId &&
    customer.country &&
    customer.country !== 'DE' &&
    customer.country !== org.country &&
    vatBreakdown.every(vb => vb.rate === 0)
  )

  return {
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate.toISOString().split('T')[0],
    dueDate: input.dueDate.toISOString().split('T')[0],
    serviceDate: input.serviceDate?.toISOString().split('T')[0],
    currency: input.currency,
    issuer: {
      name: org.name,
      legalForm: org.legalForm ?? undefined,
      street: org.street ?? undefined,
      city: org.city ?? undefined,
      postalCode: org.postalCode ?? undefined,
      country: org.country ?? 'DE',
      vatId: org.vatId ?? undefined,
      taxNumber: org.taxNumber ?? undefined,
      email: org.email ?? undefined,
      website: org.website ?? undefined,
      bankName: org.bankName ?? undefined,
      iban: org.iban ?? undefined,
      bic: org.bic ?? undefined,
    },
    recipient: {
      name: customer.name,
      street: customer.street ?? undefined,
      city: customer.city ?? undefined,
      postalCode: customer.postalCode ?? undefined,
      country: customer.country ?? undefined,
      vatId: customer.vatId ?? undefined,
    },
    lineItems: input.lineItems.map(li => ({
      position: li.position,
      description: li.description,
      quantity: Number(li.quantity),
      unit: li.unit,
      unitNetPrice: Number(li.unitPrice),
      netAmount: Number(li.netAmount),
      vatRate: Number(li.vatRate),
      vatAmount: Number(li.vatAmount),
      grossAmount: Number(li.grossAmount),
      serviceDate: li.serviceDate?.toISOString().split('T')[0],
    })),
    netTotal: Number(input.netAmount),
    vatBreakdown,
    grossTotal,
    alreadyPaid: paidAmount > 0 ? paidAmount : undefined,
    amountDue,
    isReverseCharge,
    isSmallBusiness: org.isSmallBusiness,
    notes: input.notes ?? undefined,
    paymentTerms: 'Zahlbar innerhalb von 30 Tagen ohne Abzug.',
    footerNote: `${org.name} · ${org.street ?? ''}, ${org.postalCode ?? ''} ${org.city ?? ''} · ${org.vatId ? `USt-IdNr.: ${org.vatId}` : ''}`,
  }
}

// ─────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────

function esc(str?: string | null): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

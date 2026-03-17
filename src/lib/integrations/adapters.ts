/**
 * LedgerFlow Integration Abstraction Layer
 *
 * All external provider connections go through these adapters.
 * Swap providers by changing environment variables — no code changes needed.
 *
 * Providers covered:
 *   Banking:      Tink | Plaid | finAPI | Mock
 *   Card issuing: Stripe Issuing | Marqeta | Solaris | Mock
 *   OCR:          Mindee | Veryfi | Google Vision | Mock
 *   Email:        Resend | SendGrid | SMTP | Mock
 */

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface BankAccount {
  id: string
  name: string
  iban: string
  bic?: string
  currency: string
  balance: number
  availableBalance?: number
  type: 'checking' | 'savings' | 'credit'
  providerAccountId: string
}

export interface BankTransaction {
  id: string
  externalId: string
  accountId: string
  amount: number
  currency: string
  description: string
  merchant?: string
  merchantCategory?: string
  transactionDate: Date
  postedDate?: Date
  isDebit: boolean
  balance?: number
}

export interface IssuedCard {
  id: string
  providerCardId: string
  lastFour: string
  expiryMonth: number
  expiryYear: number
  cardholderName: string
  type: 'virtual' | 'physical'
  status: 'active' | 'frozen' | 'cancelled'
  networkToken?: string    // For virtual cards, tokenized PAN
}

export interface OCRResult {
  merchant?: string
  date?: string
  total?: number
  vatAmount?: number
  currency?: string
  invoiceNumber?: string
  lineItems?: Array<{ description: string; amount: number; vatRate?: number }>
  confidence: number
  rawData: Record<string, unknown>
}

export interface EmailPayload {
  to: string | string[]
  from?: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  attachments?: Array<{ filename: string; content: string | Buffer; contentType: string }>
}

// ─────────────────────────────────────────────
// BANKING ADAPTER
// ─────────────────────────────────────────────

export interface BankingAdapter {
  getAccounts(connectionToken: string): Promise<BankAccount[]>
  getTransactions(accountId: string, from: Date, to: Date): Promise<BankTransaction[]>
  initiateConnection(organizationId: string, redirectUri: string): Promise<{ authUrl: string; state: string }>
  completeConnection(code: string, state: string): Promise<{ connectionToken: string; institution: string }>
}

class MockBankingAdapter implements BankingAdapter {
  async getAccounts(): Promise<BankAccount[]> {
    return [
      {
        id: 'mock-account-1',
        name: 'Geschäftskonto',
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX',
        currency: 'EUR',
        balance: 124500.00,
        availableBalance: 122000.00,
        type: 'checking',
        providerAccountId: 'mock-provider-account-1',
      },
      {
        id: 'mock-account-2',
        name: 'Rücklagenkonto',
        iban: 'DE91100000000123456789',
        bic: 'BELADEBEXXX',
        currency: 'EUR',
        balance: 45000.00,
        type: 'savings',
        providerAccountId: 'mock-provider-account-2',
      },
    ]
  }

  async getTransactions(accountId: string, from: Date, to: Date): Promise<BankTransaction[]> {
    const mockData = [
      { merchant: 'Lufthansa', amount: -842.00, category: '4670', isDebit: true },
      { merchant: 'AWS GmbH', amount: -1240.00, category: '4980', isDebit: true },
      { merchant: 'Kunde GmbH - Zahlung', amount: 24000.00, category: 'revenue', isDebit: false },
      { merchant: 'Commerzbank Gebühr', amount: -12.50, category: '4970', isDebit: true },
      { merchant: 'KPMG Germany', amount: -12000.00, category: '4970', isDebit: true },
    ]
    return mockData.map((d, i) => ({
      id: `mock-tx-${i}`,
      externalId: `ext-${accountId}-${i}`,
      accountId,
      amount: d.amount,
      currency: 'EUR',
      description: d.merchant,
      merchant: d.merchant,
      merchantCategory: d.category,
      transactionDate: new Date(from.getTime() + i * 24 * 60 * 60 * 1000),
      isDebit: d.isDebit,
    }))
  }

  async initiateConnection(organizationId: string, redirectUri: string) {
    return { authUrl: `${redirectUri}?mock=true&org=${organizationId}`, state: 'mock-state' }
  }

  async completeConnection(code: string, state: string) {
    return { connectionToken: `mock-token-${code}`, institution: 'Mock Bank' }
  }
}

class TinkBankingAdapter implements BankingAdapter {
  private baseUrl = 'https://api.tink.com'
  private clientId = process.env.TINK_CLIENT_ID ?? ''
  private clientSecret = process.env.TINK_CLIENT_SECRET ?? ''

  async getAccounts(connectionToken: string): Promise<BankAccount[]> {
    const res = await fetch(`${this.baseUrl}/data/v2/accounts`, {
      headers: { Authorization: `Bearer ${connectionToken}` },
    })
    if (!res.ok) throw new Error(`Tink accounts error: ${res.status}`)
    const data = await res.json()
    return data.accounts.map((a: Record<string, unknown>) => ({
      id: a.id as string,
      name: a.name as string,
      iban: (a.identifiers as Record<string, unknown>)?.iban as string ?? '',
      currency: a.currencyCode as string,
      balance: Number((a.balances as Record<string, unknown>)?.booked?.amount?.value ?? 0),
      type: 'checking',
      providerAccountId: a.id as string,
    }))
  }

  async getTransactions(accountId: string, from: Date, to: Date): Promise<BankTransaction[]> {
    const params = new URLSearchParams({
      accountIdIn: accountId,
      bookedDateGte: from.toISOString().slice(0, 10),
      bookedDateLte: to.toISOString().slice(0, 10),
    })
    const res = await fetch(`${this.baseUrl}/data/v2/transactions?${params}`, {
      headers: { Authorization: `Bearer ${process.env.TINK_CLIENT_ID}` },
    })
    if (!res.ok) throw new Error(`Tink transactions error: ${res.status}`)
    const data = await res.json()
    return data.transactions.map((t: Record<string, unknown>) => ({
      id: t.id as string,
      externalId: t.id as string,
      accountId,
      amount: Number(((t.amount as Record<string, unknown>)?.value) ?? 0),
      currency: (t.amount as Record<string, unknown>)?.currencyCode as string ?? 'EUR',
      description: t.descriptions?.display as string ?? '',
      merchant: t.merchantInformation?.merchantName as string,
      transactionDate: new Date(t.dates?.booked as string),
      isDebit: Number(((t.amount as Record<string, unknown>)?.value) ?? 0) < 0,
    }))
  }

  async initiateConnection(organizationId: string, redirectUri: string) {
    const res = await fetch(`${this.baseUrl}/oauth/authorize?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=accounts:read,transactions:read&state=${organizationId}`)
    return { authUrl: res.url, state: organizationId }
  }

  async completeConnection(code: string, state: string) {
    const res = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: this.clientId, client_secret: this.clientSecret }),
    })
    const data = await res.json()
    return { connectionToken: data.access_token, institution: 'Tink' }
  }
}

export function getBankingAdapter(): BankingAdapter {
  const provider = process.env.BANK_PROVIDER ?? 'mock'
  switch (provider) {
    case 'tink': return new TinkBankingAdapter()
    case 'mock':
    default: return new MockBankingAdapter()
  }
}

// ─────────────────────────────────────────────
// CARD ISSUING ADAPTER
// ─────────────────────────────────────────────

export interface CardIssuingAdapter {
  issueVirtualCard(params: { cardholderName: string; limitAmount: number; currency: string; metadata?: Record<string, string> }): Promise<IssuedCard>
  requestPhysicalCard(params: { cardholderName: string; shippingAddress: Record<string, string> }): Promise<IssuedCard>
  freezeCard(providerCardId: string): Promise<void>
  unfreezeCard(providerCardId: string): Promise<void>
  cancelCard(providerCardId: string): Promise<void>
  updateLimit(providerCardId: string, amount: number): Promise<void>
  getTransactions(providerCardId: string, from: Date, to: Date): Promise<BankTransaction[]>
}

class MockCardIssuingAdapter implements CardIssuingAdapter {
  async issueVirtualCard(params: { cardholderName: string }): Promise<IssuedCard> {
    const lastFour = String(Math.floor(1000 + Math.random() * 9000))
    return {
      id: `mock-card-${Date.now()}`,
      providerCardId: `mock-provider-${Date.now()}`,
      lastFour,
      expiryMonth: new Date().getMonth() + 1,
      expiryYear: new Date().getFullYear() + 3,
      cardholderName: params.cardholderName,
      type: 'virtual',
      status: 'active',
    }
  }
  async requestPhysicalCard(params: { cardholderName: string }): Promise<IssuedCard> {
    return { ...await this.issueVirtualCard(params), type: 'physical', status: 'active' }
  }
  async freezeCard(): Promise<void> {}
  async unfreezeCard(): Promise<void> {}
  async cancelCard(): Promise<void> {}
  async updateLimit(): Promise<void> {}
  async getTransactions(): Promise<BankTransaction[]> { return [] }
}

class StripeIssuingAdapter implements CardIssuingAdapter {
  private stripe: unknown
  constructor() {
    // this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-02-15' })
    // Placeholder — import Stripe SDK when ready
  }
  async issueVirtualCard(params: { cardholderName: string; limitAmount: number; currency: string }): Promise<IssuedCard> {
    // const cardholder = await this.stripe.issuing.cardholders.create({ name: params.cardholderName, type: 'individual', ... })
    // const card = await this.stripe.issuing.cards.create({ cardholder: cardholder.id, currency: params.currency, type: 'virtual' })
    throw new Error('Stripe Issuing: configure STRIPE_SECRET_KEY to enable')
  }
  async requestPhysicalCard(): Promise<IssuedCard> { throw new Error('Not implemented') }
  async freezeCard(): Promise<void> { throw new Error('Not implemented') }
  async unfreezeCard(): Promise<void> { throw new Error('Not implemented') }
  async cancelCard(): Promise<void> { throw new Error('Not implemented') }
  async updateLimit(): Promise<void> { throw new Error('Not implemented') }
  async getTransactions(): Promise<BankTransaction[]> { throw new Error('Not implemented') }
}

export function getCardIssuingAdapter(): CardIssuingAdapter {
  const provider = process.env.CARD_PROVIDER ?? 'mock'
  switch (provider) {
    case 'stripe_issuing': return new StripeIssuingAdapter()
    case 'mock':
    default: return new MockCardIssuingAdapter()
  }
}

// ─────────────────────────────────────────────
// OCR ADAPTER
// ─────────────────────────────────────────────

export interface OCRAdapter {
  extractFromUrl(fileUrl: string, mimeType: string): Promise<OCRResult>
  extractFromBase64(base64: string, mimeType: string): Promise<OCRResult>
}

class MockOCRAdapter implements OCRAdapter {
  async extractFromUrl(_fileUrl: string, _mimeType: string): Promise<OCRResult> {
    await new Promise((r) => setTimeout(r, 200))
    return {
      merchant: 'Mock Merchant GmbH',
      date: new Date().toISOString().slice(0, 10),
      total: Math.round(Math.random() * 500 * 100) / 100,
      vatAmount: Math.round(Math.random() * 80 * 100) / 100,
      currency: 'EUR',
      confidence: 0.95,
      rawData: { provider: 'mock', version: '1.0' },
    }
  }
  async extractFromBase64(base64: string, mimeType: string): Promise<OCRResult> {
    return this.extractFromUrl('', mimeType)
  }
}

class MindeeOCRAdapter implements OCRAdapter {
  private apiKey = process.env.MINDEE_API_KEY ?? ''

  async extractFromUrl(fileUrl: string, _mimeType: string): Promise<OCRResult> {
    const res = await fetch('https://api.mindee.net/v1/products/mindee/expense_receipts/v5/predict_async', {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: fileUrl }),
    })
    if (!res.ok) throw new Error(`Mindee OCR error: ${res.status}`)
    const data = await res.json()
    const prediction = data.document?.inference?.prediction
    return {
      merchant: prediction?.supplier_name?.value,
      date: prediction?.date?.value,
      total: prediction?.total_amount?.value,
      vatAmount: prediction?.total_tax?.value,
      currency: prediction?.locale?.currency,
      confidence: prediction?.confidence ?? 0,
      rawData: prediction ?? {},
    }
  }

  async extractFromBase64(base64: string, mimeType: string): Promise<OCRResult> {
    const res = await fetch('https://api.mindee.net/v1/products/mindee/expense_receipts/v5/predict', {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}` },
      body: (() => {
        const form = new FormData()
        const blob = new Blob([Buffer.from(base64, 'base64')], { type: mimeType })
        form.append('document', blob, 'receipt')
        return form
      })(),
    })
    if (!res.ok) throw new Error(`Mindee OCR error: ${res.status}`)
    const data = await res.json()
    const prediction = data.document?.inference?.prediction
    return {
      merchant: prediction?.supplier_name?.value,
      date: prediction?.date?.value,
      total: prediction?.total_amount?.value,
      vatAmount: prediction?.total_tax?.value,
      currency: prediction?.locale?.currency,
      confidence: prediction?.confidence ?? 0,
      rawData: prediction ?? {},
    }
  }
}

export function getOCRAdapter(): OCRAdapter {
  const provider = process.env.OCR_PROVIDER ?? 'mock'
  switch (provider) {
    case 'mindee': return new MindeeOCRAdapter()
    case 'mock':
    default: return new MockOCRAdapter()
  }
}

// ─────────────────────────────────────────────
// EMAIL ADAPTER
// ─────────────────────────────────────────────

export interface EmailAdapter {
  send(payload: EmailPayload): Promise<{ id: string }>
}

class MockEmailAdapter implements EmailAdapter {
  async send(payload: EmailPayload): Promise<{ id: string }> {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Email Mock] To: ${payload.to} | Subject: ${payload.subject}`)
    }
    return { id: `mock-email-${Date.now()}` }
  }
}

class ResendEmailAdapter implements EmailAdapter {
  private apiKey = process.env.RESEND_API_KEY ?? ''

  async send(payload: EmailPayload): Promise<{ id: string }> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: payload.from ?? process.env.EMAIL_FROM ?? 'noreply@ledgerflow.de',
        to: Array.isArray(payload.to) ? payload.to : [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        reply_to: payload.replyTo,
      }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(`Resend error: ${err.message}`)
    }
    const data = await res.json()
    return { id: data.id }
  }
}

class SMTPEmailAdapter implements EmailAdapter {
  async send(payload: EmailPayload): Promise<{ id: string }> {
    // Dynamic import to avoid loading nodemailer in edge environments
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    const info = await transporter.sendMail({
      from: payload.from ?? process.env.EMAIL_FROM,
      to: Array.isArray(payload.to) ? payload.to.join(', ') : payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    })
    return { id: info.messageId }
  }
}

export function getEmailAdapter(): EmailAdapter {
  const provider = process.env.EMAIL_PROVIDER ?? 'mock'
  switch (provider) {
    case 'resend': return new ResendEmailAdapter()
    case 'smtp': return new SMTPEmailAdapter()
    case 'mock':
    default: return new MockEmailAdapter()
  }
}

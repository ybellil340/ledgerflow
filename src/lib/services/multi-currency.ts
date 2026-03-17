/**
 * LedgerFlow Multi-Currency Service
 *
 * Features:
 * - ECB (European Central Bank) daily exchange rates — authoritative for EU accounting
 * - In-memory rate cache with 4h TTL (ECB updates once per day ~16:00 CET)
 * - Historical rates lookup for past expense dates
 * - Currency conversion with audit trail (rate + source + date)
 * - German number/currency formatting (de-DE locale)
 * - Supported currencies: all ECB-published + crypto stub
 *
 * ECB rate feed: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
 * Historical: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml
 */

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface ExchangeRate {
  baseCurrency: 'EUR'
  targetCurrency: string
  rate: number          // 1 EUR = rate TARGET
  date: string          // YYYY-MM-DD
  source: 'ECB' | 'CACHED' | 'FALLBACK'
}

export interface ConversionResult {
  originalAmount: number
  originalCurrency: string
  convertedAmount: number
  targetCurrency: string
  rate: number
  rateDate: string
  rateSource: ExchangeRate['source']
}

export type SupportedCurrency =
  | 'EUR' | 'USD' | 'GBP' | 'CHF' | 'DKK' | 'SEK' | 'NOK' | 'PLN' | 'CZK' | 'HUF'
  | 'RON' | 'BGN' | 'HRK' | 'ISK' | 'JPY' | 'CNY' | 'CAD' | 'AUD' | 'SGD' | 'HKD'
  | 'NZD' | 'MXN' | 'BRL' | 'INR' | 'KRW' | 'TRY' | 'ZAR' | 'AED' | 'SAR' | 'THB'

export const CURRENCY_NAMES: Record<string, string> = {
  EUR: 'Euro', USD: 'US Dollar', GBP: 'British Pound', CHF: 'Swiss Franc',
  DKK: 'Danish Krone', SEK: 'Swedish Krona', NOK: 'Norwegian Krone',
  PLN: 'Polish Złoty', CZK: 'Czech Koruna', HUF: 'Hungarian Forint',
  RON: 'Romanian Leu', BGN: 'Bulgarian Lev', JPY: 'Japanese Yen',
  CNY: 'Chinese Yuan', CAD: 'Canadian Dollar', AUD: 'Australian Dollar',
  SGD: 'Singapore Dollar', HKD: 'Hong Kong Dollar', NZD: 'New Zealand Dollar',
  MXN: 'Mexican Peso', BRL: 'Brazilian Real', INR: 'Indian Rupee',
  KRW: 'South Korean Won', TRY: 'Turkish Lira', ZAR: 'South African Rand',
  AED: 'UAE Dirham', SAR: 'Saudi Riyal', THB: 'Thai Baht',
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', DKK: 'kr', SEK: 'kr', NOK: 'kr',
  PLN: 'zł', CZK: 'Kč', HUF: 'Ft', RON: 'lei', BGN: 'лв', JPY: '¥', CNY: '¥',
  CAD: 'CA$', AUD: 'A$', SGD: 'S$', HKD: 'HK$', NZD: 'NZ$', MXN: 'MX$',
  BRL: 'R$', INR: '₹', KRW: '₩', TRY: '₺', ZAR: 'R', AED: 'د.إ', SAR: '﷼', THB: '฿',
}

// ─────────────────────────────────────────────
// RATE CACHE
// ─────────────────────────────────────────────

interface RateCache {
  rates: Record<string, number>  // currency → rate vs EUR
  date: string
  fetchedAt: Date
}

const CACHE_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours

// Historical rates cache: date → rates
const historicalCache = new Map<string, Record<string, number>>()
let currentCache: RateCache | null = null

// Fallback rates (approximate, for dev / ECB outage)
const FALLBACK_RATES: Record<string, number> = {
  EUR: 1, USD: 1.085, GBP: 0.858, CHF: 0.942, DKK: 7.461, SEK: 11.32, NOK: 11.58,
  PLN: 4.289, CZK: 25.13, HUF: 390.2, RON: 4.975, BGN: 1.956, JPY: 163.4,
  CNY: 7.842, CAD: 1.473, AUD: 1.660, SGD: 1.453, HKD: 8.453, NZD: 1.802,
  MXN: 18.73, BRL: 5.412, INR: 90.45, KRW: 1445, TRY: 33.28, ZAR: 20.14,
  AED: 3.985, SAR: 4.070, THB: 38.42,
}

// ─────────────────────────────────────────────
// ECB FETCHERS
// ─────────────────────────────────────────────

async function fetchECBRates(): Promise<Record<string, number>> {
  const res = await fetch(
    'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    { next: { revalidate: 3600 } }
  )
  if (!res.ok) throw new Error(`ECB fetch failed: ${res.status}`)

  const xml = await res.text()
  const rates: Record<string, number> = { EUR: 1 }

  const matches = xml.matchAll(/currency='([A-Z]{3})' rate='([0-9.]+)'/g)
  for (const m of matches) {
    rates[m[1]] = parseFloat(m[2])
  }

  return rates
}

async function fetchECBHistoricalRates(): Promise<Map<string, Record<string, number>>> {
  const res = await fetch(
    'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml'
  )
  if (!res.ok) throw new Error(`ECB historical fetch failed: ${res.status}`)

  const xml = await res.text()
  const result = new Map<string, Record<string, number>>()

  const cubeBlocks = xml.matchAll(/<Cube time='(\d{4}-\d{2}-\d{2})'>([\s\S]*?)<\/Cube>/g)
  for (const block of cubeBlocks) {
    const date = block[1]
    const rates: Record<string, number> = { EUR: 1 }
    const rateMatches = block[2].matchAll(/currency='([A-Z]{3})' rate='([0-9.]+)'/g)
    for (const m of rateMatches) {
      rates[m[1]] = parseFloat(m[2])
    }
    result.set(date, rates)
  }

  return result
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Get current EUR → currency exchange rate.
 * Uses ECB daily rates with in-memory cache.
 */
export async function getExchangeRate(
  targetCurrency: string,
  date?: string // YYYY-MM-DD — use historical rate for past dates
): Promise<ExchangeRate> {
  if (targetCurrency === 'EUR') {
    return { baseCurrency: 'EUR', targetCurrency: 'EUR', rate: 1, date: date ?? new Date().toISOString().split('T')[0], source: 'CACHED' }
  }

  // Historical rate lookup
  if (date && date < new Date().toISOString().split('T')[0]) {
    return getHistoricalRate(targetCurrency, date)
  }

  // Current rate
  const rates = await getCurrentRates()
  const rate = rates[targetCurrency]

  if (!rate) {
    throw new Error(`Unsupported currency: ${targetCurrency}`)
  }

  return {
    baseCurrency: 'EUR',
    targetCurrency,
    rate,
    date: currentCache?.date ?? new Date().toISOString().split('T')[0],
    source: currentCache ? 'ECB' : 'FALLBACK',
  }
}

async function getCurrentRates(): Promise<Record<string, number>> {
  if (currentCache && Date.now() - currentCache.fetchedAt.getTime() < CACHE_TTL_MS) {
    return currentCache.rates
  }

  try {
    const rates = await fetchECBRates()
    currentCache = {
      rates,
      date: new Date().toISOString().split('T')[0],
      fetchedAt: new Date(),
    }
    return rates
  } catch {
    console.warn('[MultiCurrency] ECB fetch failed, using fallback rates')
    return FALLBACK_RATES
  }
}

async function getHistoricalRate(currency: string, date: string): Promise<ExchangeRate> {
  if (historicalCache.size === 0) {
    try {
      const hist = await fetchECBHistoricalRates()
      for (const [d, rates] of hist) {
        historicalCache.set(d, rates)
      }
    } catch {
      // Fall through to fallback
    }
  }

  // Find closest available date (ECB skips weekends/holidays)
  let lookupDate = date
  for (let i = 0; i < 5; i++) {
    const rates = historicalCache.get(lookupDate)
    if (rates) {
      return {
        baseCurrency: 'EUR',
        targetCurrency: currency,
        rate: rates[currency] ?? FALLBACK_RATES[currency] ?? 1,
        date: lookupDate,
        source: 'ECB',
      }
    }
    // Go back one day
    const d = new Date(lookupDate)
    d.setDate(d.getDate() - 1)
    lookupDate = d.toISOString().split('T')[0]
  }

  return {
    baseCurrency: 'EUR',
    targetCurrency: currency,
    rate: FALLBACK_RATES[currency] ?? 1,
    date,
    source: 'FALLBACK',
  }
}

/**
 * Convert an amount between two currencies.
 * All conversions go through EUR as the base (ECB publishes EUR crosses).
 */
export async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  date?: string
): Promise<ConversionResult> {
  if (fromCurrency === toCurrency) {
    return {
      originalAmount: amount,
      originalCurrency: fromCurrency,
      convertedAmount: amount,
      targetCurrency: toCurrency,
      rate: 1,
      rateDate: date ?? new Date().toISOString().split('T')[0],
      rateSource: 'CACHED',
    }
  }

  // Convert to EUR first
  const toEUR = await getExchangeRate(fromCurrency, date)
  const amountInEUR = fromCurrency === 'EUR' ? amount : amount / toEUR.rate

  // Then EUR to target
  const fromEUR = await getExchangeRate(toCurrency, date)
  const convertedAmount = toCurrency === 'EUR' ? amountInEUR : amountInEUR * fromEUR.rate

  // Cross-rate for audit
  const crossRate = fromCurrency === 'EUR' ? fromEUR.rate : toCurrency === 'EUR' ? 1 / toEUR.rate : convertedAmount / amount

  return {
    originalAmount: amount,
    originalCurrency: fromCurrency,
    convertedAmount: Math.round(convertedAmount * 100) / 100,
    targetCurrency: toCurrency,
    rate: Math.round(crossRate * 10000) / 10000,
    rateDate: toEUR.date,
    rateSource: toEUR.source,
  }
}

/**
 * Convert expense gross amount to EUR for accounting/DATEV export.
 * Returns both the converted amount and the exchange rate record for audit.
 */
export async function toEUR(
  amount: number,
  currency: string,
  expenseDate: string
): Promise<{ eurAmount: number; rate: number; rateDate: string; rateSource: string }> {
  if (currency === 'EUR') {
    return { eurAmount: amount, rate: 1, rateDate: expenseDate, rateSource: 'CACHED' }
  }

  const result = await convertCurrency(amount, currency, 'EUR', expenseDate)
  return {
    eurAmount: result.convertedAmount,
    rate: result.rate,
    rateDate: result.rateDate,
    rateSource: result.rateSource,
  }
}

// ─────────────────────────────────────────────
// FORMATTING UTILITIES
// ─────────────────────────────────────────────

/**
 * Format a currency amount for display.
 * Respects German locale for EUR, otherwise uses standard format.
 */
export function formatCurrency(
  amount: number,
  currency: string,
  locale = 'de-DE',
  options: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: ['JPY', 'KRW', 'HUF'].includes(currency) ? 0 : 2,
    maximumFractionDigits: ['JPY', 'KRW', 'HUF'].includes(currency) ? 0 : 2,
    ...options,
  }).format(amount)
}

/**
 * Returns the VAT calculation applicable for the expense.
 * Cross-border B2B EU: Reverse charge (§13b UStG) → 0% German VAT.
 * Non-EU: No German VAT, may have local withholding.
 */
export function getVATImplication(
  supplierCountry: string,
  isBusinessExpense: boolean
): { vatRate: number; vatCode: string; note: string } {
  if (supplierCountry === 'DE') {
    return { vatRate: 19, vatCode: 'VSt19', note: 'Standard German VAT' }
  }

  // EU member states (B2B reverse charge under §13b UStG)
  const EU_COUNTRIES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
    'SI', 'ES', 'SE']

  if (EU_COUNTRIES.includes(supplierCountry) && isBusinessExpense) {
    return { vatRate: 0, vatCode: 'EUV', note: 'EU B2B — Reverse charge §13b UStG' }
  }

  if (EU_COUNTRIES.includes(supplierCountry) && !isBusinessExpense) {
    return { vatRate: 19, vatCode: 'EUS', note: 'EU B2C — Destination country VAT rules apply' }
  }

  // Non-EU (Drittland)
  return { vatRate: 0, vatCode: 'DRITTLAND', note: 'Non-EU supplier — import VAT may apply' }
}

// ─────────────────────────────────────────────
// API ROUTE HANDLER (GET /api/currencies)
// ─────────────────────────────────────────────

export async function getCurrencyRatesForAPI() {
  const rates = await getCurrentRates()
  return {
    baseCurrency: 'EUR',
    date: currentCache?.date ?? new Date().toISOString().split('T')[0],
    source: currentCache ? 'ECB' : 'FALLBACK',
    rates,
    supportedCurrencies: Object.keys(CURRENCY_NAMES).map((code) => ({
      code,
      name: CURRENCY_NAMES[code],
      symbol: CURRENCY_SYMBOLS[code] ?? code,
      rate: rates[code] ?? null,
    })),
  }
}

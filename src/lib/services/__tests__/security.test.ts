/**
 * Unit tests: Security Utilities
 *
 * Tests IBAN MOD-97 validation, German VAT ID format,
 * AES-256-GCM encryption round-trips, XSS sanitization,
 * and in-memory rate limiter logic.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import {
  validateIBAN,
  validateGermanVatId,
  encryptSensitive,
  decryptSensitive,
  sanitizeHtml,
  RateLimiter,
  hashForExportIntegrity,
} from '@/lib/security'

describe('IBAN validation (MOD-97)', () => {
  const VALID_IBANS = [
    'DE89370400440532013000',   // Standard German IBAN
    'DE44200400600543210900',   // Hamburg bank
    'AT611904300234573201',     // Austrian (valid for European suppliers)
    'FR7630006000011234567890189', // French supplier
    'GB29NWBK60161331926819',  // UK supplier
  ]

  const INVALID_IBANS = [
    'DE89370400440532013001',   // Wrong check digits
    'DE893704004405320',        // Too short
    'XX89370400440532013000',   // Invalid country code
    'DE0037040044053201300',    // Leading zero in check digits (BBAN issue)
    '',                         // Empty
    '   ',                      // Whitespace only
    'not-an-iban',              // Garbage
  ]

  test.each(VALID_IBANS)('accepts valid IBAN: %s', (iban) => {
    expect(validateIBAN(iban)).toBe(true)
  })

  test.each(INVALID_IBANS)('rejects invalid IBAN: %s', (iban) => {
    expect(validateIBAN(iban)).toBe(false)
  })

  test('strips spaces before validation (SEPA formatted IBANs)', () => {
    expect(validateIBAN('DE89 3704 0044 0532 0130 00')).toBe(true)
  })

  test('is case-insensitive', () => {
    expect(validateIBAN('de89370400440532013000')).toBe(true)
  })
})

describe('German VAT ID validation', () => {
  const VALID_VAT_IDS = [
    'DE123456789',
    'DE999888777',
    'DE100000000',
  ]

  const INVALID_VAT_IDS = [
    'DE12345678',    // 8 digits (needs 9)
    'DE1234567890',  // 10 digits (needs 9)
    'AT123456789',   // Wrong country prefix
    '123456789',     // No prefix
    'DE12345678A',   // Non-numeric
    '',
  ]

  test.each(VALID_VAT_IDS)('accepts valid VAT ID: %s', (vatId) => {
    expect(validateGermanVatId(vatId)).toBe(true)
  })

  test.each(INVALID_VAT_IDS)('rejects invalid VAT ID: %s', (vatId) => {
    expect(validateGermanVatId(vatId)).toBe(false)
  })

  test('is case-insensitive for prefix', () => {
    expect(validateGermanVatId('de123456789')).toBe(true)
  })
})

describe('AES-256-GCM encryption', () => {
  const TEST_KEY = '0123456789abcdef0123456789abcdef' // 32 bytes hex

  test('encrypts and decrypts IBAN correctly', () => {
    const plaintext = 'DE89370400440532013000'
    const encrypted = encryptSensitive(plaintext, TEST_KEY)
    const decrypted = decryptSensitive(encrypted, TEST_KEY)
    expect(decrypted).toBe(plaintext)
  })

  test('produces different ciphertext each time (random IV)', () => {
    const plaintext = 'DE89370400440532013000'
    const enc1 = encryptSensitive(plaintext, TEST_KEY)
    const enc2 = encryptSensitive(plaintext, TEST_KEY)
    expect(enc1).not.toBe(enc2)
  })

  test('decrypts back to original after multiple round-trips', () => {
    const original = 'sensitive-api-key-value-12345'
    let val = original
    for (let i = 0; i < 5; i++) {
      val = decryptSensitive(encryptSensitive(val, TEST_KEY), TEST_KEY)
    }
    expect(val).toBe(original)
  })

  test('throws on tampered ciphertext', () => {
    const encrypted = encryptSensitive('secret', TEST_KEY)
    const tampered = encrypted.slice(0, -4) + 'XXXX'
    expect(() => decryptSensitive(tampered, TEST_KEY)).toThrow()
  })

  test('throws on wrong key', () => {
    const encrypted = encryptSensitive('secret', TEST_KEY)
    const wrongKey = 'fedcba9876543210fedcba9876543210'
    expect(() => decryptSensitive(encrypted, wrongKey)).toThrow()
  })

  test('handles unicode correctly', () => {
    const unicode = 'München · Straße · €1.234,56'
    const encrypted = encryptSensitive(unicode, TEST_KEY)
    expect(decryptSensitive(encrypted, TEST_KEY)).toBe(unicode)
  })
})

describe('XSS sanitization', () => {
  test('strips script tags', () => {
    expect(sanitizeHtml('<script>alert("xss")</script>Hello')).toBe('Hello')
  })

  test('strips event handlers from HTML attributes', () => {
    expect(sanitizeHtml('<div onclick="steal()">text</div>')).not.toContain('onclick')
  })

  test('preserves plain text content', () => {
    expect(sanitizeHtml('Müller & Söhne GmbH')).toBe('Müller & Söhne GmbH')
  })

  test('strips javascript: protocol URLs', () => {
    const result = sanitizeHtml('<a href="javascript:void(0)">click</a>')
    expect(result).not.toContain('javascript:')
  })

  test('handles nested malicious content', () => {
    const malicious = '<img src=x onerror="<script>evil()</script>">'
    expect(sanitizeHtml(malicious)).not.toContain('onerror')
    expect(sanitizeHtml(malicious)).not.toContain('evil()')
  })

  test('trims whitespace', () => {
    expect(sanitizeHtml('  hello world  ')).toBe('hello world')
  })
})

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('allows requests within limit', () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60_000 })
    const key = 'user-123'

    for (let i = 0; i < 5; i++) {
      const result = limiter.check(key)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4 - i)
    }
  })

  test('blocks requests over limit', () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 })
    const key = 'user-456'

    limiter.check(key)
    limiter.check(key)
    limiter.check(key)
    const result = limiter.check(key) // 4th request
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  test('resets counter after window expires', () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 30_000 })
    const key = 'user-789'

    limiter.check(key)
    limiter.check(key)
    expect(limiter.check(key).allowed).toBe(false)

    // Advance past the window
    vi.advanceTimersByTime(31_000)

    expect(limiter.check(key).allowed).toBe(true)
  })

  test('tracks different keys independently', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 })

    limiter.check('key-A')
    expect(limiter.check('key-A').allowed).toBe(false)
    expect(limiter.check('key-B').allowed).toBe(true)
  })

  test('provides retryAfterMs in response when blocked', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 })
    const key = 'blocked-user'

    limiter.check(key)
    const result = limiter.check(key)
    expect(result.retryAfterMs).toBeGreaterThan(0)
    expect(result.retryAfterMs).toBeLessThanOrEqual(60_000)
  })
})

describe('Export integrity hash', () => {
  test('produces a 64-character hex SHA-256 hash', () => {
    const hash = hashForExportIntegrity('some csv content')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('same content produces same hash (deterministic)', () => {
    const content = 'EXTF;700;21;...\r\n...'
    expect(hashForExportIntegrity(content)).toBe(hashForExportIntegrity(content))
  })

  test('different content produces different hash', () => {
    expect(hashForExportIntegrity('content A')).not.toBe(hashForExportIntegrity('content B'))
  })

  test('handles empty string', () => {
    const hash = hashForExportIntegrity('')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('handles unicode content', () => {
    const hash = hashForExportIntegrity('München · Straße · €')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})

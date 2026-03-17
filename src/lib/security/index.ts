/**
 * LedgerFlow Security Utilities
 *
 * Covers:
 * - Rate limiting (in-memory + Upstash Redis adapter)
 * - Input sanitization and XSS prevention
 * - Sensitive field encryption (IBAN, bank credentials)
 * - CSRF protection helpers
 * - Security audit helpers
 * - Request fingerprinting
 */

import { NextRequest, NextResponse } from 'next/server'
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

// ─────────────────────────────────────────────
// ENCRYPTION — AES-256-GCM for sensitive fields
// ─────────────────────────────────────────────

const ENCRYPTION_KEY_HEX = process.env.ENCRYPTION_KEY ?? ''

function getEncryptionKey(): Buffer {
  if (!ENCRYPTION_KEY_HEX || ENCRYPTION_KEY_HEX.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters — set it in your environment')
  }
  return Buffer.from(ENCRYPTION_KEY_HEX.slice(0, 32), 'utf-8')
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(12) // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey()
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted value format')

  const [ivHex, tagHex, dataHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const data = Buffer.from(dataHex, 'hex')

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  return decipher.update(data) + decipher.final('utf8')
}

export function encryptIBAN(iban: string): string {
  // Normalize IBAN before encrypting
  const normalized = iban.replace(/\s/g, '').toUpperCase()
  return encrypt(normalized)
}

export function decryptIBAN(encrypted: string): string {
  return decrypt(encrypted)
}

// ─────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────

interface RateLimitEntry {
  count: number
  resetAt: number
}

// In-memory store (for single-instance dev/staging)
// In production: swap for Upstash Redis
const rateLimitStore = new Map<string, RateLimitEntry>()

export interface RateLimitConfig {
  windowMs: number   // Time window in milliseconds
  maxRequests: number
  keyPrefix?: string
}

export const RATE_LIMITS = {
  // Auth endpoints — strict
  login:          { windowMs: 15 * 60 * 1000, maxRequests: 10 },
  signup:         { windowMs: 60 * 60 * 1000, maxRequests: 5 },
  invite:         { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  forgotPassword: { windowMs: 60 * 60 * 1000, maxRequests: 5 },

  // API endpoints — moderate
  api:            { windowMs: 60 * 1000, maxRequests: 100 },
  export:         { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  upload:         { windowMs: 60 * 1000, maxRequests: 30 },

  // Admin — generous
  admin:          { windowMs: 60 * 1000, maxRequests: 200 },
} as const

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfterMs: number
}

export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now()
  const fullKey = `${config.keyPrefix ?? 'rl'}:${key}`

  let entry = rateLimitStore.get(fullKey)

  if (!entry || now >= entry.resetAt) {
    entry = { count: 1, resetAt: now + config.windowMs }
    rateLimitStore.set(fullKey, entry)
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: entry.resetAt, retryAfterMs: 0 }
  }

  entry.count++

  if (entry.count > config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterMs: entry.resetAt - now,
    }
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
    retryAfterMs: 0,
  }
}

// Upstash Redis adapter (plug in when available)
export async function checkRateLimitRedis(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  // When UPSTASH_REDIS_REST_URL is set, use Upstash
  if (process.env.UPSTASH_REDIS_REST_URL) {
    try {
      const { Ratelimit } = await import(/* webpackIgnore: true */ '@upstash/ratelimit')
      const { Redis } = await import(/* webpackIgnore: true */ '@upstash/redis')
      const redis = Redis.fromEnv()
      const ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(config.maxRequests, `${config.windowMs}ms`),
      })
      const { success, remaining, reset } = await ratelimit.limit(key)
      return { allowed: success, remaining, resetAt: reset, retryAfterMs: success ? 0 : reset - Date.now() }
    } catch {
      // Fall through to in-memory if Redis unavailable
    }
  }
  return checkRateLimit(key, config)
}

// Rate limit middleware factory
export function withRateLimit(config: RateLimitConfig) {
  return function rateLimitMiddleware(req: NextRequest): NextResponse | null {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      ?? req.headers.get('x-real-ip')
      ?? 'unknown'
    const userId = req.headers.get('x-user-id') ?? ''
    const key = userId || ip

    const result = checkRateLimit(key, config)

    if (!result.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: Math.ceil(result.retryAfterMs / 1000) },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)),
            'X-RateLimit-Limit': String(config.maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(result.resetAt),
          },
        }
      )
    }

    return null // Allow request
  }
}

// ─────────────────────────────────────────────
// INPUT SANITIZATION
// ─────────────────────────────────────────────

/**
 * Strip HTML tags and dangerous characters from user input.
 * Not a replacement for parameterized queries — those are handled by Prisma.
 */
export function sanitizeString(input: string, maxLength = 10000): string {
  if (typeof input !== 'string') return ''
  return input
    .slice(0, maxLength)
    .replace(/<[^>]*>/g, '')           // strip HTML tags
    .replace(/javascript:/gi, '')      // strip JS protocol
    .replace(/data:/gi, '')            // strip data URIs
    .replace(/vbscript:/gi, '')        // strip VBScript
    .trim()
}

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')  // allow safe chars only
    .replace(/\.{2,}/g, '_')            // prevent path traversal
    .slice(0, 255)
}

export function validateIBAN(iban: string): boolean {
  const cleaned = iban.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(cleaned)) return false

  // IBAN checksum validation (MOD-97)
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let remainder = 0
  for (let i = 0; i < numeric.length; i += 9) {
    remainder = parseInt(remainder + numeric.slice(i, i + 9), 10) % 97
  }
  return remainder === 1
}

export function validateVATId(vatId: string, country = 'DE'): boolean {
  const cleaned = vatId.replace(/\s/g, '').toUpperCase()
  const patterns: Record<string, RegExp> = {
    DE: /^DE\d{9}$/,
    AT: /^ATU\d{8}$/,
    CH: /^CHE-?\d{3}\.\d{3}\.\d{3}$/,
    NL: /^NL\d{9}B\d{2}$/,
    FR: /^FR[A-Z0-9]{2}\d{9}$/,
  }
  return (patterns[country] ?? /^[A-Z]{2}[A-Z0-9]+$/).test(cleaned)
}

// ─────────────────────────────────────────────
// REQUEST FINGERPRINTING
// ─────────────────────────────────────────────

export function getRequestFingerprint(req: NextRequest): string {
  const parts = [
    req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown',
    req.headers.get('user-agent') ?? '',
    req.headers.get('accept-language') ?? '',
  ]
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}

export function getClientIP(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'
}

// ─────────────────────────────────────────────
// SECURITY HEADERS
// ─────────────────────────────────────────────

export function applySecurityHeaders(response: NextResponse): NextResponse {
  const headers = {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  }
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value)
  }
  return response
}

// ─────────────────────────────────────────────
// IMMUTABILITY GUARDS
// ─────────────────────────────────────────────

/**
 * Verify that an exported batch has not been tampered with.
 * In production: use a cryptographic hash stored at export time.
 */
export function computeExportHash(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function verifyExportIntegrity(data: string, expectedHash: string): boolean {
  return computeExportHash(data) === expectedHash
}

// ─────────────────────────────────────────────
// AUDIT LOG HELPERS
// ─────────────────────────────────────────────

export interface AuditContext {
  actorId: string
  organizationId?: string
  ipAddress?: string
  userAgent?: string
}

export function extractAuditContext(req: NextRequest, userId: string, orgId?: string): AuditContext {
  return {
    actorId: userId,
    organizationId: orgId,
    ipAddress: getClientIP(req),
    userAgent: req.headers.get('user-agent') ?? undefined,
  }
}

// ─────────────────────────────────────────────
// PERMISSION BOUNDARY CHECK
// ─────────────────────────────────────────────

/**
 * Server-side guard — always call this before returning
 * organization-scoped data to ensure the requesting user
 * actually belongs to that organization.
 *
 * Do NOT rely solely on middleware headers — validate in the handler.
 */
export async function assertOrganizationAccess(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const { default: prisma } = await import('@/lib/db/prisma')
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, organizationId, status: 'ACTIVE' },
    select: { id: true },
  })
  return !!membership
}

/**
 * Validate that an entity (expense, invoice, etc.) belongs
 * to the organization before returning or modifying it.
 */
export async function assertEntityOwnership(
  model: 'expense' | 'supplierInvoice' | 'customerInvoice' | 'card' | 'transaction',
  entityId: string,
  organizationId: string
): Promise<boolean> {
  const { default: prisma } = await import('@/lib/db/prisma')
  const record = await (prisma[model] as { findFirst: (args: { where: Record<string, string> }) => Promise<{ id: string } | null> }).findFirst({
    where: { id: entityId, organizationId },
  })
  return !!record
}

// Aliases used by integration routes
export const encryptValue = encrypt
export const decryptValue = decrypt
export const validateGermanVATId = (vatId: string) => validateVATId(vatId, 'DE')

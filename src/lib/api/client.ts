/**
 * LedgerFlow API Client
 *
 * Typed fetch wrapper that handles:
 * - Session cookie auth (automatic via browser)
 * - JSON envelope unwrapping { data, error, meta, warnings }
 * - Structured error classes (ApiError, AuthError, ValidationError, RateLimitError)
 * - Automatic retry with exponential backoff for 429/503
 * - Request cancellation via AbortController
 * - Request deduplication for identical in-flight GETs
 * - Response caching with configurable TTL
 */

// ─────────────────────────────────────────────
// ERROR CLASSES
// ─────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown[]
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class AuthError extends ApiError {
  constructor(message = 'Session expired. Please sign in again.') {
    super(message, 401, 'UNAUTHORIZED')
    this.name = 'AuthError'
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message, 403, 'FORBIDDEN')
    this.name = 'ForbiddenError'
  }
}

export class ValidationError extends ApiError {
  constructor(
    message: string,
    public fields: Array<{ field: string; message: string }> = []
  ) {
    super(message, 400, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
  }
}

export class RateLimitError extends ApiError {
  constructor(public retryAfterSeconds: number) {
    super(`Rate limit exceeded. Retry after ${retryAfterSeconds}s.`, 429, 'RATE_LIMITED')
    this.name = 'RateLimitError'
  }
}

export class NetworkError extends Error {
  constructor(message = 'Network error. Check your connection.') {
    super(message)
    this.name = 'NetworkError'
  }
}

// ─────────────────────────────────────────────
// RESPONSE ENVELOPE
// ─────────────────────────────────────────────

export interface ApiEnvelope<T> {
  data: T
  error?: string
  meta?: {
    total?: number
    page?: number
    perPage?: number
    totalPages?: number
    unreadCount?: number
  }
  warnings?: string[]
  summary?: Record<string, unknown>
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

// ─────────────────────────────────────────────
// REQUEST OPTIONS
// ─────────────────────────────────────────────

export interface RequestOptions {
  signal?: AbortSignal
  /** Skip deduplication for this request */
  unique?: boolean
  /** Cache TTL in milliseconds. 0 = no cache. Default: 0 */
  cacheTTL?: number
  /** Number of retries on 429/503. Default: 2 */
  maxRetries?: number
}

// ─────────────────────────────────────────────
// IN-FLIGHT DEDUPLICATION
// ─────────────────────────────────────────────

const inFlight = new Map<string, Promise<unknown>>()

// ─────────────────────────────────────────────
// RESPONSE CACHE
// ─────────────────────────────────────────────

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const responseCache = new Map<string, CacheEntry<unknown>>()

function getCached<T>(key: string): T | null {
  const entry = responseCache.get(key) as CacheEntry<T> | undefined
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key)
    return null
  }
  return entry.data
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  responseCache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

export function invalidateCache(prefix: string): void {
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) responseCache.delete(key)
  }
}

// ─────────────────────────────────────────────
// CORE FETCH
// ─────────────────────────────────────────────

const BASE_URL = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_APP_URL ?? '')

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retriesLeft: number
): Promise<Response> {
  try {
    const res = await fetch(url, init)

    if (res.status === 429 && retriesLeft > 0) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10)
      await new Promise((r) => setTimeout(r, retryAfter * 1000))
      return fetchWithRetry(url, init, retriesLeft - 1)
    }

    if (res.status === 503 && retriesLeft > 0) {
      await new Promise((r) => setTimeout(r, 2000 * (3 - retriesLeft)))
      return fetchWithRetry(url, init, retriesLeft - 1)
    }

    return res
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    if (retriesLeft > 0) {
      await new Promise((r) => setTimeout(r, 1000))
      return fetchWithRetry(url, init, retriesLeft - 1)
    }
    throw new NetworkError(err instanceof Error ? err.message : 'Network error')
  }
}

async function parseError(res: Response): Promise<never> {
  let body: Record<string, unknown> = {}
  try { body = await res.json() } catch {}

  const message = (body.error as string) || res.statusText || 'Unknown error'
  const details = body.details as unknown[] | undefined

  switch (res.status) {
    case 400:
      throw new ValidationError(message, details as ValidationError['fields'])
    case 401:
      throw new AuthError(message)
    case 403:
      throw new ForbiddenError(message)
    case 429: {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10)
      throw new RateLimitError(retryAfter)
    }
    default:
      throw new ApiError(message, res.status, body.code as string, details)
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<ApiEnvelope<T>> {
  const { signal, unique = false, cacheTTL = 0, maxRetries = 2 } = options
  const url = `${BASE_URL}${path}`
  const cacheKey = method === 'GET' ? url : ''

  // Cache hit
  if (method === 'GET' && cacheTTL > 0) {
    const cached = getCached<ApiEnvelope<T>>(cacheKey)
    if (cached) return cached
  }

  // In-flight deduplication for GET
  if (method === 'GET' && !unique && inFlight.has(url)) {
    return inFlight.get(url) as Promise<ApiEnvelope<T>>
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const init: RequestInit = {
    method,
    headers,
    credentials: 'include', // Always send session cookie
    signal,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }

  const promise = (async (): Promise<ApiEnvelope<T>> => {
    const res = await fetchWithRetry(url, init, maxRetries)

    if (!res.ok) await parseError(res)

    const envelope = await res.json() as ApiEnvelope<T>

    if (method === 'GET' && cacheTTL > 0) {
      setCache(cacheKey, envelope, cacheTTL)
    }

    return envelope
  })()

  if (method === 'GET' && !unique) {
    inFlight.set(url, promise)
    promise.finally(() => inFlight.delete(url))
  }

  return promise
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>('GET', path, undefined, options),

  post: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),

  put: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, body, options),

  patch: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),

  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, undefined, options),

  /** Upload a file via multipart/form-data */
  upload: async <T>(path: string, formData: FormData, options?: RequestOptions): Promise<ApiEnvelope<T>> => {
    const res = await fetchWithRetry(`${BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
      signal: options?.signal,
    }, options?.maxRetries ?? 1)

    if (!res.ok) await parseError(res)
    return res.json()
  },
}

// ─────────────────────────────────────────────
// QUERY STRING BUILDER
// ─────────────────────────────────────────────

export function buildQuery(
  params: Record<string, string | number | boolean | string[] | undefined | null>
): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      value.forEach((v) => qs.append(key, String(v)))
    } else {
      qs.set(key, String(value))
    }
  }
  const str = qs.toString()
  return str ? `?${str}` : ''
}

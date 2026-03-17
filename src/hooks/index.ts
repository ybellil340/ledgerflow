import { useState, useEffect, useCallback, useRef } from 'react'

// ─────────────────────────────────────────────
// GENERIC FETCH HOOK
// ─────────────────────────────────────────────

interface UseFetchState<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useFetch<T>(url: string | null, options?: RequestInit): UseFetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetch_ = useCallback(async () => {
    if (!url) return
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(url, { ...options, signal: abortRef.current.signal })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setData(json.data)
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    fetch_()
    return () => abortRef.current?.abort()
  }, [fetch_])

  return { data, loading, error, refetch: fetch_ }
}

// ─────────────────────────────────────────────
// PAGINATED LIST HOOK
// ─────────────────────────────────────────────

interface PaginatedState<T> {
  items: T[]
  total: number
  page: number
  totalPages: number
  loading: boolean
  error: string | null
  setPage: (p: number) => void
  refetch: () => void
}

export function usePaginated<T>(
  baseUrl: string,
  params: Record<string, string | string[] | undefined> = {},
  perPage = 25
): PaginatedState<T> {
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    setError(null)

    const searchParams = new URLSearchParams({ page: String(page), perPage: String(perPage) })
    for (const [key, val] of Object.entries(params)) {
      if (!val) continue
      if (Array.isArray(val)) val.forEach((v) => searchParams.append(key, v))
      else searchParams.set(key, val)
    }

    try {
      const res = await fetch(`${baseUrl}?${searchParams}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setItems(json.data ?? [])
      setTotal(json.meta?.total ?? 0)
      setTotalPages(json.meta?.totalPages ?? 1)
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [baseUrl, page, perPage, JSON.stringify(params)])

  useEffect(() => { fetch_() }, [fetch_])

  return { items, total, page, totalPages, loading, error, setPage, refetch: fetch_ }
}

// ─────────────────────────────────────────────
// MUTATION HOOK
// ─────────────────────────────────────────────

interface UseMutationState<TInput, TResult> {
  mutate: (input: TInput) => Promise<TResult | null>
  loading: boolean
  error: string | null
}

export function useMutation<TInput, TResult = unknown>(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
  onSuccess?: (data: TResult) => void
): UseMutationState<TInput, TResult> {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutate = useCallback(async (input: TInput): Promise<TResult | null> => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const json = await res.json()
      if (!res.ok) {
        const msg = json.error ?? `HTTP ${res.status}`
        setError(msg)
        return null
      }
      onSuccess?.(json.data)
      return json.data
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [url, method, onSuccess])

  return { mutate, loading, error }
}

// ─────────────────────────────────────────────
// SPECIFIC HOOKS
// ─────────────────────────────────────────────

export function useDashboard() {
  return useFetch<import('@/types').DashboardMetrics>('/api/dashboard')
}

export function useExpenses(filters: Record<string, string | string[] | undefined> = {}) {
  return usePaginated<import('@/types').ExpenseWithRelations>('/api/expenses', filters)
}

export function useCards(filters: Record<string, string> = {}) {
  return usePaginated<import('@/types').CardWithRelations>('/api/cards', filters, 50)
}

export function useTransactions(filters: Record<string, string | string[]> = {}) {
  return usePaginated<import('@prisma/client').Transaction & { card?: unknown; receipt?: unknown }>('/api/transactions', filters, 30)
}

export function useReimbursements(filters: Record<string, string> = {}) {
  return usePaginated<import('@prisma/client').Reimbursement & { user: unknown; attachments: unknown[] }>('/api/reimbursements', filters)
}

// ─────────────────────────────────────────────
// DEBOUNCED VALUE
// ─────────────────────────────────────────────

export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

// ─────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────

export function useNotifications() {
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/notifications?unreadOnly=true&perPage=1')
        const data = await res.json()
        setUnread(data.meta?.total ?? 0)
      } catch {}
    }
    poll()
    const interval = setInterval(poll, 60_000) // poll every minute
    return () => clearInterval(interval)
  }, [])

  return { unread }
}

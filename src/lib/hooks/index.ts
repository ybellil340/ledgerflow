'use client'

/**
 * LedgerFlow Data Fetching Hooks
 *
 * Lightweight SWR-style hooks without the SWR dependency.
 *
 * - useQuery       — fetch + cache + revalidate
 * - useMutation    — POST/PATCH/DELETE with optimistic updates
 * - usePaginated   — paginated lists with prev/next
 * - useInfinite    — infinite scroll list
 * - useRealtime    — polling-based live updates
 *
 * All hooks expose:
 *   { data, isLoading, error, refetch }
 */

import { useState, useEffect, useRef, useCallback, useReducer } from 'react'
import { ApiError, AuthError, NetworkError } from '@/lib/api/client'

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface QueryState<T> {
  data: T | null
  isLoading: boolean
  isFetching: boolean   // Re-fetching after initial load
  error: Error | null
  lastUpdated: number | null
}

export interface MutationState<T> {
  data: T | null
  isLoading: boolean
  error: Error | null
}

export interface PaginatedState<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
  isLoading: boolean
  isFetching: boolean
  error: Error | null
}

// ─────────────────────────────────────────────
// GLOBAL QUERY CACHE
// ─────────────────────────────────────────────

type QueryCacheEntry = {
  data: unknown
  timestamp: number
  subscribers: Set<() => void>
}

const queryCache = new Map<string, QueryCacheEntry>()
const DEFAULT_STALE_TIME = 30_000 // 30 seconds

function notifySubscribers(key: string) {
  queryCache.get(key)?.subscribers.forEach((cb) => cb())
}

export function invalidateQuery(keyPrefix: string) {
  for (const [key, entry] of queryCache.entries()) {
    if (key.startsWith(keyPrefix)) {
      entry.timestamp = 0 // Force re-fetch
      notifySubscribers(key)
    }
  }
}

// ─────────────────────────────────────────────
// useQuery
// ─────────────────────────────────────────────

export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<{ data: T }>,
  options: {
    staleTime?: number
    revalidateOnFocus?: boolean
    enabled?: boolean
    onSuccess?: (data: T) => void
    onError?: (error: Error) => void
    initialData?: T
  } = {}
): QueryState<T> & { refetch: () => void; mutate: (data: T) => void } {
  const {
    staleTime = DEFAULT_STALE_TIME,
    revalidateOnFocus = true,
    enabled = true,
    onSuccess,
    onError,
    initialData,
  } = options

  const [, forceUpdate] = useReducer((x) => x + 1, 0)
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)
  onSuccessRef.current = onSuccess
  onErrorRef.current = onError

  const [state, setState] = useState<QueryState<T>>({
    data: initialData ?? null,
    isLoading: enabled && !initialData,
    isFetching: false,
    error: null,
    lastUpdated: null,
  })

  const fetchData = useCallback(async (isBackground = false) => {
    if (!key || !enabled) return

    const cached = queryCache.get(key)
    const isStale = !cached || Date.now() - cached.timestamp > staleTime

    if (cached && !isStale) {
      setState((prev) => ({ ...prev, data: cached.data as T, isLoading: false, isFetching: false }))
      return
    }

    setState((prev) => ({
      ...prev,
      isLoading: !prev.data && !isBackground,
      isFetching: !!prev.data || isBackground,
    }))

    try {
      const { data } = await fetcher()

      // Update cache
      const entry = queryCache.get(key) ?? { data: null, timestamp: 0, subscribers: new Set() }
      entry.data = data
      entry.timestamp = Date.now()
      queryCache.set(key, entry)

      setState({ data, isLoading: false, isFetching: false, error: null, lastUpdated: Date.now() })
      onSuccessRef.current?.(data)
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setState((prev) => ({ ...prev, isLoading: false, isFetching: false, error }))
      onErrorRef.current?.(error)
    }
  }, [key, enabled, staleTime, fetcher])

  // Subscribe to cache invalidation
  useEffect(() => {
    if (!key) return
    const entry = queryCache.get(key) ?? { data: null, timestamp: 0, subscribers: new Set<() => void>() }
    const cb = () => { fetchData(true) }
    entry.subscribers.add(cb)
    queryCache.set(key, entry)
    return () => { entry.subscribers.delete(cb) }
  }, [key, fetchData])

  // Initial fetch
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Revalidate on window focus
  useEffect(() => {
    if (!revalidateOnFocus) return
    const handler = () => { if (key && enabled) fetchData(true) }
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [revalidateOnFocus, key, enabled, fetchData])

  const mutate = useCallback((data: T) => {
    if (key) {
      const entry = queryCache.get(key)
      if (entry) { entry.data = data; entry.timestamp = Date.now() }
    }
    setState((prev) => ({ ...prev, data }))
  }, [key])

  return { ...state, refetch: () => fetchData(false), mutate }
}

// ─────────────────────────────────────────────
// useMutation
// ─────────────────────────────────────────────

export function useMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<{ data: TData }>,
  options: {
    onSuccess?: (data: TData, variables: TVariables) => void
    onError?: (error: Error, variables: TVariables) => void
    invalidateKeys?: string[]
  } = {}
): MutationState<TData> & { mutate: (variables: TVariables) => Promise<TData> } {
  const [state, setState] = useState<MutationState<TData>>({
    data: null,
    isLoading: false,
    error: null,
  })

  const optionsRef = useRef(options)
  optionsRef.current = options

  const mutate = useCallback(async (variables: TVariables): Promise<TData> => {
    setState({ data: null, isLoading: true, error: null })
    try {
      const { data } = await mutationFn(variables)
      setState({ data, isLoading: false, error: null })
      optionsRef.current.onSuccess?.(data, variables)
      optionsRef.current.invalidateKeys?.forEach((key) => invalidateQuery(key))
      return data
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setState({ data: null, isLoading: false, error })
      optionsRef.current.onError?.(error, variables)
      throw error
    }
  }, [mutationFn])

  return { ...state, mutate }
}

// ─────────────────────────────────────────────
// usePaginated
// ─────────────────────────────────────────────

export function usePaginated<T>(
  baseKey: string,
  fetcher: (page: number, perPage: number) => Promise<{ data: T[]; meta: PaginatedState<T>['meta'] }>,
  options: { perPage?: number; enabled?: boolean } = {}
): PaginatedState<T> & { page: number; setPage: (p: number) => void; refetch: () => void } {
  const { perPage = 25, enabled = true } = options
  const [page, setPage] = useState(1)
  const [state, setState] = useState<PaginatedState<T>>({
    data: [],
    meta: { total: 0, page: 1, perPage, totalPages: 0 },
    isLoading: true,
    isFetching: false,
    error: null,
  })

  const fetchPage = useCallback(async (p: number, isBackground = false) => {
    if (!enabled) return
    setState((prev) => ({
      ...prev,
      isLoading: !isBackground && p !== prev.meta.page,
      isFetching: isBackground || p === prev.meta.page,
    }))
    try {
      const result = await fetcher(p, perPage)
      setState({ data: result.data, meta: result.meta, isLoading: false, isFetching: false, error: null })
    } catch (err) {
      setState((prev) => ({ ...prev, isLoading: false, isFetching: false, error: err as Error }))
    }
  }, [fetcher, perPage, enabled])

  useEffect(() => { fetchPage(page) }, [page, fetchPage])

  return {
    ...state,
    page,
    setPage: (p: number) => setPage(Math.max(1, p)),
    refetch: () => fetchPage(page, true),
  }
}

// ─────────────────────────────────────────────
// useRealtime — polling
// ─────────────────────────────────────────────

export function useRealtime<T>(
  key: string | null,
  fetcher: () => Promise<{ data: T }>,
  intervalMs = 30_000,
  enabled = true
): T | null {
  const { data, mutate } = useQuery(key, fetcher, { enabled })
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    if (!enabled || !key) return

    timerRef.current = setInterval(async () => {
      try {
        const { data: fresh } = await fetcher()
        mutate(fresh)
      } catch {}
    }, intervalMs)

    return () => clearInterval(timerRef.current)
  }, [enabled, key, fetcher, intervalMs, mutate])

  return data
}

// ─────────────────────────────────────────────
// DOMAIN-SPECIFIC HOOKS
// ─────────────────────────────────────────────

import { useAuth } from '@/lib/store/auth'
import {
  dashboardApi, expensesApi, cardsApi, transactionsApi,
  reimbursementsApi, apInvoicesApi, arInvoicesApi,
  suppliersApi, customersApi, accountingApi, cashFlowApi,
  taxAdvisorApi, notificationsApi, billingApi, settingsApi, adminApi,
} from '@/lib/api/endpoints'
import type { ExpenseFilters, CardFilters, TransactionFilters, APInvoiceFilters, ARInvoiceFilters } from '@/types'

export function useDashboard() {
  return useQuery('dashboard', dashboardApi.get, { staleTime: 30_000 })
}

export function useExpenses(filters: ExpenseFilters = {}) {
  const key = `expenses:${JSON.stringify(filters)}`
  return useQuery(key, () => expensesApi.list(filters) as never, { staleTime: 30_000 })
}

export function useExpense(id: string | null) {
  return useQuery(id ? `expense:${id}` : null, () => expensesApi.get(id!), { staleTime: 60_000 })
}

export function useCards(filters: CardFilters = {}) {
  const key = `cards:${JSON.stringify(filters)}`
  return useQuery(key, () => cardsApi.list(filters) as never, { staleTime: 60_000 })
}

export function useTransactions(filters: TransactionFilters = {}) {
  const key = `transactions:${JSON.stringify(filters)}`
  return useQuery(key, () => transactionsApi.list(filters) as never, { staleTime: 30_000 })
}

export function useReimbursements(filters: Record<string, unknown> = {}) {
  const key = `reimbursements:${JSON.stringify(filters)}`
  return useQuery(key, () => reimbursementsApi.list(filters) as never, { staleTime: 30_000 })
}

export function useAPInvoices(filters: APInvoiceFilters = {}) {
  const key = `ap-invoices:${JSON.stringify(filters)}`
  return useQuery(key, () => apInvoicesApi.list(filters) as never, { staleTime: 30_000 })
}

export function useARInvoices(filters: ARInvoiceFilters = {}) {
  const key = `ar-invoices:${JSON.stringify(filters)}`
  return useQuery(key, () => arInvoicesApi.list(filters) as never, { staleTime: 30_000 })
}

export function useSuppliers(search?: string) {
  return useQuery(`suppliers:${search ?? ''}`, () => suppliersApi.list(search) as never, { staleTime: 60_000 })
}

export function useCustomers(search?: string) {
  return useQuery(`customers:${search ?? ''}`, () => customersApi.list(search) as never, { staleTime: 60_000 })
}

export function useAccountingMappings() {
  return useQuery('accounting-mappings', accountingApi.getMappings, { staleTime: 5 * 60_000 })
}

export function useExportHistory() {
  return useQuery('export-history', accountingApi.listExports as never, { staleTime: 30_000 })
}

export function useCashFlow(horizon: 30 | 60 | 90 | 180 = 30) {
  return useQuery(`cashflow:${horizon}`, () => cashFlowApi.get(horizon), { staleTime: 60_000 })
}

export function useTaxAdvisorPortfolio() {
  return useQuery('tax-advisor-portfolio', taxAdvisorApi.getPortfolio as never, { staleTime: 60_000 })
}

export function useNotifications(unreadOnly = false) {
  return useRealtime(
    `notifications:${unreadOnly}`,
    () => notificationsApi.list({ unreadOnly, perPage: 30 }) as never,
    60_000,
    true
  )
}

export function useNotificationCount() {
  const { data } = useQuery('notification-count', () => notificationsApi.list({ unreadOnly: true, perPage: 1 }), { staleTime: 30_000 })
  return (data as { meta?: { unreadCount?: number } } | null)?.meta?.unreadCount ?? 0
}

export function useBilling() {
  return useQuery('billing', billingApi.get, { staleTime: 5 * 60_000 })
}

export function useTeam() {
  return useQuery('team', settingsApi.getTeam as never, { staleTime: 2 * 60_000 })
}

export function useDepartments() {
  return useQuery('departments', settingsApi.getDepartments as never, { staleTime: 5 * 60_000 })
}

export function useAdminStats() {
  const { isSuperAdmin } = useAuth()
  return useQuery('admin-stats', adminApi.getStats as never, { enabled: isSuperAdmin, staleTime: 60_000 })
}

export function useFeatureFlags() {
  const { isSuperAdmin } = useAuth()
  return useQuery('feature-flags', adminApi.getFlags as never, { enabled: isSuperAdmin, staleTime: 5 * 60_000 })
}

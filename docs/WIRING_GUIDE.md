# LedgerFlow — API Wiring Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    React Pages/Components                 │
│  useDashboard()  useExpenses()  useCards()  ...          │
└──────────────────────┬──────────────────────────────────┘
                       │ domain hooks
┌──────────────────────▼──────────────────────────────────┐
│                    hooks/index.ts                         │
│  useQuery()  useMutation()  usePaginated()               │
│  useRealtime()  invalidateQuery()                        │
└──────────────────────┬──────────────────────────────────┘
                       │ typed API calls
┌──────────────────────▼──────────────────────────────────┐
│                   api/endpoints.ts                        │
│  expensesApi  cardsApi  apInvoicesApi  accountingApi ... │
└──────────────────────┬──────────────────────────────────┘
                       │ fetch wrapper
┌──────────────────────▼──────────────────────────────────┐
│                    api/client.ts                          │
│  api.get()  api.post()  api.patch()  api.upload()        │
│  Retry · Dedup · Cache · Error parsing                   │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP → session cookie
┌──────────────────────▼──────────────────────────────────┐
│                  Next.js API Routes                       │
│  (Phases 1–4 backend — already implemented)              │
└─────────────────────────────────────────────────────────┘
```

---

## Files Delivered

| File | Purpose |
|---|---|
| `src/lib/api/client.ts` | Core fetch wrapper — error classes, retry, cache, dedup |
| `src/lib/api/endpoints.ts` | All domain API functions, fully typed |
| `src/lib/store/auth.tsx` | AuthContext, session state, permission helpers |
| `src/lib/hooks/index.ts` | useQuery, useMutation, usePaginated + all domain hooks |
| `src/components/providers/error-system.tsx` | ErrorBoundary, ToastProvider, handleApiError |
| `src/components/providers/index.tsx` | Root Providers wrapper |
| `src/app/layout.tsx` | SSR session loading, zero-flash auth |
| `src/app/api/auth/me/route.ts` | Session hydration endpoint |
| `src/app/dashboard/page.tsx` | Dashboard — fully wired, optimistic approvals |
| `src/app/expenses/page.tsx` | Expenses — wired, filtering, inline approve/reject/upload |

---

## How To Wire Any Page

Every page follows the same 4-step pattern:

### Step 1 — Use the domain hook

```tsx
import { useExpenses } from '@/lib/hooks'

const { data, isLoading, error, refetch, mutate } = useExpenses({
  status: 'PENDING_APPROVAL',
  page: 1,
  perPage: 25,
})
```

### Step 2 — Render loading/error states

```tsx
if (isLoading) return <PageSkeleton />
if (error) return <ErrorMessage error={error} />
```

### Step 3 — Perform mutations with optimistic updates

```tsx
import { expensesApi } from '@/lib/api/endpoints'
import { invalidateQuery } from '@/lib/hooks'
import { useToast, handleApiError } from '@/components/providers/error-system'

const toast = useToast()

async function handleApprove(id: string) {
  // 1. Optimistic — update UI immediately
  mutate({ data: data.data.map(e => e.id === id ? { ...e, status: 'APPROVED' } : e) })

  try {
    // 2. Server call
    await expensesApi.approve(id)
    toast.success('Expense approved')

    // 3. Invalidate related caches
    invalidateQuery('dashboard')
  } catch (err) {
    // 4. Revert on failure
    invalidateQuery('expenses')
    handleApiError(err, toast, 'Approve')
  }
}
```

### Step 4 — Use permission guards

```tsx
import { useAuth } from '@/lib/store/auth'

const { can, hasRole } = useAuth()

// In JSX:
{can('approve:expenses') && <button onClick={handleApprove}>Approve</button>}
{hasRole('COMPANY_ADMIN') && <AdminPanel />}
```

---

## Wiring Remaining Pages

### Cards page

```tsx
import { useCards } from '@/lib/hooks'
import { cardsApi } from '@/lib/api/endpoints'

const { data, refetch } = useCards({ status: 'ACTIVE' })
const cards = data?.data ?? []

// Freeze
async function freeze(id: string) {
  await cardsApi.freeze(id)
  invalidateQuery('cards')
}
```

### AP Invoices (kanban)

```tsx
import { useAPInvoices } from '@/lib/hooks'
import { apInvoicesApi } from '@/lib/api/endpoints'

const { data } = useAPInvoices()
const byStatus = groupBy(data?.data ?? [], 'status')

async function approve(id: string) {
  await apInvoicesApi.approve(id)
  invalidateQuery('ap-invoices')
}
```

### Accounting / DATEV Export

```tsx
import { useExportHistory, useAccountingMappings } from '@/lib/hooks'
import { accountingApi } from '@/lib/api/endpoints'

const { data: history } = useExportHistory()
const { data: mappings } = useAccountingMappings()

async function createExport(params) {
  const { data } = await accountingApi.createExport(params)
  // data.downloadUrl → trigger browser download
  window.open(data.downloadUrl)
  invalidateQuery('export-history')
}
```

### Notifications (live polling)

```tsx
import { useNotifications, useNotificationCount } from '@/lib/hooks'
import { notificationsApi } from '@/lib/api/endpoints'

// Polls every 60 seconds automatically
const notifications = useNotifications()
const unreadCount = useNotificationCount()

async function markAllRead() {
  await notificationsApi.markAllRead()
  invalidateQuery('notification-count')
  invalidateQuery('notifications')
}
```

### Tax Advisor portal

```tsx
import { useTaxAdvisorPortfolio } from '@/lib/hooks'
import { taxAdvisorApi } from '@/lib/api/endpoints'

const { data: portfolio } = useTaxAdvisorPortfolio()

async function addComment(orgId: string, entityId: string, content: string) {
  await taxAdvisorApi.addComment({
    organizationId: orgId,
    entityType: 'expense',
    entityId,
    content,
    visibility: 'EXTERNAL',
    requestDocument: true,
  })
  toast.success('Comment sent to client')
}
```

---

## Cache Invalidation Map

After every mutation, invalidate the appropriate cache prefixes:

| Mutation | Invalidate |
|---|---|
| Approve/reject expense | `expenses`, `dashboard` |
| Create expense | `expenses`, `dashboard` |
| Upload receipt | `expense:{id}`, `expenses` |
| Freeze/unfreeze card | `cards` |
| Create AP invoice | `ap-invoices` |
| Approve AP invoice | `ap-invoices` |
| Mark invoice paid | `ap-invoices`, `cashflow` |
| Create AR invoice | `ar-invoices`, `cashflow` |
| Record payment | `ar-invoices`, `cashflow` |
| Create export | `export-history` |
| Mark notifications read | `notification-count`, `notifications` |
| Create department | `departments`, `team` |
| Update team member | `team` |
| Toggle feature flag | `feature-flags` |

---

## Error Handling Reference

```tsx
import { handleApiError } from '@/components/providers/error-system'
import { ValidationError, ForbiddenError, RateLimitError } from '@/lib/api/client'

try {
  await api.post(...)
} catch (err) {
  if (err instanceof ValidationError) {
    // err.fields = [{ field: 'email', message: 'Invalid format' }]
    setFieldErrors(err.fields)
  } else if (err instanceof ForbiddenError) {
    toast.error('Permission denied')
  } else {
    // handleApiError covers all cases: auth redirect, rate limit warning, generic error
    handleApiError(err, toast, 'Save')
  }
}
```

---

## Global Auth Error Handling

When any API call returns `401`, the client automatically:
1. Dispatches `ledgerflow:auth_error` window event
2. `AuthContext` catches it → `setUser(null)`
3. Redirects to `/login?reason=session_expired`

No per-page handling needed.

---

## Adding the Providers to the App

The `src/app/layout.tsx` already includes server-side session loading.
On the client, the `Providers` component wraps everything:

```tsx
// src/app/layout.tsx
import { Providers } from '@/components/providers'

export default async function RootLayout({ children }) {
  const initialUser = await getServerSession() // reads cookie server-side

  return (
    <html lang="de">
      <body>
        <Providers initialUser={initialUser}>
          {children}
        </Providers>
      </body>
    </html>
  )
}
```

This means:
- **Zero flash** — user is authenticated before React hydrates
- **No waterfall** — data fetching starts immediately in `useEffect`
- **Consistent state** — server and client agree on auth state from the first render

---

## Route Protection

```tsx
// Protect entire pages
import { RequireAuth } from '@/lib/store/auth'

export default function InvoicePage() {
  return (
    <RequireAuth permission="manage:invoices">
      <InvoiceContent />
    </RequireAuth>
  )
}

// Protect specific UI elements
const { can } = useAuth()
{can('export:accounting') && <DATEVExportButton />}
{can('super_admin') && <AdminLink />}
```

---

## Environment Variables Required

```env
NEXT_PUBLIC_APP_URL=https://app.ledgerflow.de

# These already exist from Phase 1:
DATABASE_URL=...
JWT_SECRET=...
ENCRYPTION_KEY=...
```

No new env vars needed — the API client reads `NEXT_PUBLIC_APP_URL`
and always sends the session cookie via `credentials: 'include'`.

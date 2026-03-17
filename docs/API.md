# LedgerFlow API Reference

**Base URL:** `https://app.ledgerflow.de/api`  
**Auth:** All endpoints require a valid session cookie (`ledgerflow_session` JWT). Obtain via `POST /api/auth/login`.  
**Response envelope:** `{ data, error, meta, warnings? }`  
**Rate limits:** See headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

---

## Authentication

### POST /api/auth/login
Sign in with email and password.

**Body**
```json
{
  "email": "katrin@mueller-consulting.de",
  "password": "your-password",
  "organizationId": "optional-cuid"  // switch org on login
}
```

**Response 200**
```json
{
  "data": {
    "user": {
      "id": "clx...",
      "email": "katrin@mueller-consulting.de",
      "firstName": "Katrin",
      "lastName": "Müller",
      "currentOrganizationId": "clx...",
      "currentRole": "COMPANY_ADMIN",
      "isSuperAdmin": false,
      "organizations": [{ "id": "clx...", "name": "Müller GmbH", "role": "COMPANY_ADMIN" }]
    }
  }
}
```

**Errors:** `401 Invalid email or password` · `403 No organization access`

---

### POST /api/auth/signup
Create a new account and organization.

**Body**
```json
{
  "email": "string",
  "password": "string (min 8 chars)",
  "firstName": "string",
  "lastName": "string",
  "organizationName": "string",
  "legalForm": "GmbH | AG | GbR | KG | UG | Freelancer",
  "vatId": "DE123456789 (optional)",
  "country": "DE (default)",
  "industry": "string (optional)"
}
```

**Response 201** — Returns user + org, sets session cookie.

---

### POST /api/auth/logout
Clears the session cookie. Always returns 200.

---

### POST /api/auth/invite
**Send invitation** (requires `manage:users` permission):
```json
{ "email": "string", "role": "EMPLOYEE | APPROVER | FINANCE_MANAGER | COMPANY_ADMIN", "departmentId": "cuid (optional)" }
```

**Accept invitation:**
```json
{ "token": "invitation-token", "firstName": "string", "lastName": "string", "password": "string" }
```

---

## Expenses

### GET /api/expenses
List expenses with filtering and pagination.

**Query params**
| Param | Type | Description |
|---|---|---|
| `status` | enum[] | `DRAFT \| SUBMITTED \| PENDING_APPROVAL \| APPROVED \| REJECTED \| EXPORTED \| FLAGGED` |
| `userId` | cuid | Filter by employee (admin/finance only) |
| `departmentId` | cuid | Filter by department |
| `costCenterId` | cuid | Filter by cost center |
| `dateFrom` | ISO date | Expense date from |
| `dateTo` | ISO date | Expense date to |
| `amountMin` | number | Minimum gross amount |
| `amountMax` | number | Maximum gross amount |
| `hasReceipt` | boolean | `true` = matched, `false` = missing |
| `search` | string | Search merchant/notes |
| `page` | int | Default 1 |
| `perPage` | int | Default 25, max 100 |

**Response 200**
```json
{
  "data": [{ "id": "clx...", "merchant": "Lufthansa", "grossAmount": 842.00, ... }],
  "meta": { "total": 47, "page": 1, "perPage": 25, "totalPages": 2 },
  "stats": [{ "status": "APPROVED", "count": 30, "total": 28500.00 }]
}
```

---

### POST /api/expenses
Create a new expense (draft).

**Body**
```json
{
  "merchant": "string (required)",
  "expenseDate": "ISO datetime (required)",
  "currency": "EUR",
  "grossAmount": 842.00,
  "vatRate": 19.00,
  "vatAmount": 134.29,
  "netAmount": 707.71,
  "vatCodeId": "cuid",
  "categoryId": "Travel | Software | Meals | Equipment | ...",
  "departmentId": "cuid",
  "costCenterId": "cuid",
  "projectCode": "string",
  "paymentMethod": "card | cash | bank_transfer | other",
  "cardId": "cuid",
  "notes": "string",
  "transactionId": "cuid"
}
```

**Note:** `vatAmount` and `netAmount` are auto-computed from `grossAmount + vatRate` if not provided.

---

### GET /api/expenses/:id
Get expense detail with comments, receipt, and attachments.

### PUT /api/expenses/:id
Update expense fields (not allowed if status is `EXPORTED`).

### DELETE /api/expenses/:id
Soft-delete an expense (not allowed if `EXPORTED`).

### POST /api/expenses/:id/submit
Submit for approval. Triggers the approval workflow engine.

**Response includes `warnings` array** if no receipt is attached.

### POST /api/expenses/:id/approve
Approve an expense. Requires `approve:expenses` permission.
```json
{ "comment": "string (optional)" }
```

### POST /api/expenses/:id/reject
Reject with mandatory reason.
```json
{ "reason": "string (required)" }
```

---

## Cards

### GET /api/cards
List cards. Employees see only their own. Accepts `?status=ACTIVE|FROZEN|REQUESTED`.

### POST /api/cards
Issue a new virtual or physical card.

```json
{
  "userId": "cuid",
  "type": "VIRTUAL | PHYSICAL",
  "purpose": "Travel expenses",
  "limitAmount": 5000.00,
  "limitPeriod": "DAILY | WEEKLY | MONTHLY | ONE_TIME",
  "allowedMerchantCategories": ["3000", "7011"],
  "blockedMerchantCategories": [],
  "allowedMerchants": [],
  "blockedMerchants": []
}
```

**Subscription limits:** Returns `429` if card limit reached for plan.

### GET /api/cards/:id
Card detail with last 20 transactions.

### PATCH /api/cards/:id
**Freeze/unfreeze/cancel:**
```json
{ "action": "freeze | unfreeze | cancel" }
```

**Update limits:**
```json
{ "limitAmount": 3000, "limitPeriod": "MONTHLY", "allowedMerchantCategories": ["3000"] }
```

---

## Transactions

### GET /api/transactions
List transaction ledger. Supports `?status=`, `?cardId=`, `?dateFrom=`, `?dateTo=`, `?search=`.

### PATCH /api/transactions
Bulk categorize up to 100 transactions.
```json
{
  "ids": ["cuid1", "cuid2"],
  "categoryId": "Travel",
  "vatCodeId": "cuid",
  "status": "CATEGORIZED",
  "accountingCode": "4670"
}
```

### POST /api/transactions
Import transactions from bank sync (admin/finance only).
```json
{
  "transactions": [{
    "externalId": "string",
    "merchant": "string",
    "amount": -842.00,
    "currency": "EUR",
    "transactionDate": "ISO datetime",
    "merchantCategory": "string"
  }]
}
```

---

## Receipts

### POST /api/receipts
Upload a receipt. `multipart/form-data`.

| Field | Type | Description |
|---|---|---|
| `file` | File | JPEG, PNG, WebP, or PDF. Max 20MB. |
| `expenseId` | string | Link to expense (optional) |
| `transactionId` | string | Link to transaction (optional) |

**Response 201** — OCR extraction runs asynchronously. Poll the expense to get extracted fields.

---

## Invoices — AP (Accounts Payable)

### GET /api/invoices/ap
List supplier invoices. Query params: `status[]`, `supplierId`, `dateFrom`, `dateTo`, `isOverdue=true`, `search`, `page`, `perPage`.

**Response includes** `summary.byStatus` counts and `summary.overdueCount`.

### POST /api/invoices/ap
Create supplier invoice. Automatically checks for duplicates (same supplier + invoice number) and initiates approval workflow.

```json
{
  "supplierId": "cuid",
  "invoiceNumber": "RE-2025-001",
  "invoiceDate": "ISO datetime",
  "dueDate": "ISO datetime",
  "currency": "EUR",
  "grossAmount": 8330.00,
  "vatAmount": 1330.00,
  "vatCodeId": "cuid",
  "categoryId": "Consulting",
  "lineItems": [{ "description": "IT Services Q1", "quantity": 1, "unitPrice": 7000, "vatRate": 19 }]
}
```

**Response 201** — includes `warnings` array if duplicate detected.

### GET /api/invoices/ap/:id
Full detail with line items, comments, attachments, export batch link.

### PATCH /api/invoices/ap/:id
**Actions:**
```json
{ "action": "approve", "comment": "optional" }
{ "action": "reject", "reason": "required" }
{ "action": "mark_paid", "paidAmount": 8330.00, "paymentRef": "SEPA-REF-001" }
{ "action": "schedule_payment" }
{ "action": "cancel" }
```

**Field updates** (DRAFT/PENDING only): `dueDate`, `grossAmount`, `vatAmount`, `notes`, `vatCodeId`, `categoryId`.

---

## Invoices — AR (Accounts Receivable)

### GET /api/invoices/ar
List customer invoices. Similar filters to AP.

### POST /api/invoices/ar
Create customer invoice with line items. Invoice number auto-generated (`RE-YYYY-NNNN`) if not provided.

### PATCH /api/invoices/ar/:id
**Actions:**
```json
{ "action": "send" }
{ "action": "mark_viewed" }
{ "action": "record_payment", "amount": 5000.00, "paymentDate": "ISO", "reference": "string" }
{ "action": "cancel", "reason": "string" }
{ "action": "create_credit_note", "amount": 1000.00, "reason": "Partial refund" }
```

---

## Accounting

### GET /api/accounting/mappings
Returns chart of accounts mappings, VAT codes, and SKR03 reference data.

### POST /api/accounting/mappings
Create/update a mapping. Send `{ "seedDefaults": true }` to apply all SKR03 defaults.

### GET /api/accounting/export
List export batches with readiness check for current month.

### POST /api/accounting/export
Generate export package.

```json
{
  "format": "DATEV | CSV",
  "periodStart": "ISO datetime",
  "periodEnd": "ISO datetime",
  "includeExpenses": true,
  "includeSupplierInvoices": true,
  "includeCustomerInvoices": true,
  "includeReimbursements": true,
  "lockPeriod": false,
  "chartOfAccounts": "SKR03 | SKR04",
  "beraterNummer": 12345,
  "mandantNummer": 1
}
```

**Response 201** includes `downloadUrl` and `preview` (first 2000 chars of export).

**Errors:** `409` if period overlaps with locked batch · `400` if no records found.

---

## Cash Flow

### GET /api/cashflow
Returns forecast + historical data.

**Query params:** `horizon=30|60|90|180` · `historyMonths=6`

**Response includes:**
- `forecast.dataPoints` — day-by-day balance projection
- `forecast.upcomingObligations` — AP + payroll + tax obligations
- `forecast.expectedInflows` — open AR invoices with probability
- `summary.burnRate` — 3-month average monthly outflow
- `summary.runwayMonths` — months of runway at current burn rate

---

## Tax Advisor

### GET /api/tax-advisor/portfolio
Returns all client organizations with health metrics. Requires `TAX_ADVISOR` role or `manage:tax_advisor` permission.

### GET /api/tax-advisor/review/:orgId
Review queue for a client: missing receipts, VAT anomalies, uncategorized transactions, pending exports, overdue AP.

### POST /api/tax-advisor/comment
Leave a comment on an entity, optionally requesting a document from the employee.

### POST /api/tax-advisor/lock-period
Lock/unlock an accounting period for a client.

---

## Notifications

### GET /api/notifications
List notifications for current user. `?unreadOnly=true` · `?page=` · `?perPage=`.

### PATCH /api/notifications
Mark as read.
```json
{ "ids": ["cuid1", "cuid2"] }  // specific
{ "markAll": true }             // all
```

### DELETE /api/notifications
`?id=cuid` to delete one · omit to clear read notifications older than 30 days.

---

## Dashboard

### GET /api/dashboard
All KPI data for the dashboard in a single call. Runs ~10 queries in parallel.

Returns: `totalSpendMonth`, `cashPosition`, `pendingApprovals`, `missingReceipts`, `overdueInvoices`, `spendByCategory`, `monthlyFlow`, `recentTransactions`, `topMerchants`, `unreadNotifications`.

---

## Admin (Super Admin only)

### GET /api/admin/stats
Platform-wide metrics: org count, user count, financial volume, subscription breakdown.

### GET /api/admin/companies
All organizations with owner, subscription, and usage counts.

### GET /api/admin/users
All users with memberships and tax advisor profile.

### GET /api/admin/audit-logs
All audit logs with filtering by actor, org, action, entity type, date range.

### GET /api/admin/flags
Feature flags with per-org overrides.

### PATCH /api/admin/flags
Toggle a flag globally or per-org.
```json
{ "key": "ocr_receipt_extraction", "isEnabled": true, "organizationId": "cuid (optional)" }
```

### POST /api/admin/impersonate
Log in as a user for support purposes. Fully logged in audit trail.
```json
{ "userId": "cuid", "organizationId": "cuid" }
```

### PATCH /api/admin/companies/:id
```json
{ "isActive": false }  // suspend company
```

---

## Health

### GET /api/health
Health check endpoint. Returns `200 healthy` or `503 degraded`.

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "environment": "production",
  "timestamp": "2025-03-15T09:00:00.000Z",
  "latencyMs": 42,
  "checks": {
    "database": { "status": "ok", "latencyMs": 8 },
    "environment": { "status": "ok" },
    "storage": { "status": "ok", "detail": "s3" }
  }
}
```

---

## Webhooks

### POST /api/webhooks/stripe
Handles Stripe billing events. Verified via `stripe-signature` header.

Events handled: `invoice.paid` · `customer.subscription.deleted` · `invoice.payment_failed`

### POST /api/webhooks/tink
Open banking transaction sync. Verified via `x-tink-signature` HMAC-SHA256.

### POST /api/webhooks/marqeta
Card authorization and status change events. Verified via `x-webhook-signature`.

---

## Error Codes

| Status | Meaning |
|---|---|
| `400` | Validation error — check `details` array |
| `401` | Unauthorized — session expired or missing |
| `403` | Forbidden — insufficient permissions |
| `404` | Entity not found or not in your organization |
| `409` | Conflict — duplicate entry, locked period |
| `429` | Rate limited — see `Retry-After` header |
| `500` | Internal server error — contact support |

---

## Permissions Matrix

| Endpoint | Employee | Approver | Finance Mgr | Admin | Tax Advisor |
|---|---|---|---|---|---|
| Own expenses | ✓ | ✓ | ✓ | ✓ | — |
| All expenses | — | — | ✓ | ✓ | — |
| Approve expenses | — | ✓ | ✓ | ✓ | — |
| Cards | Own | — | ✓ | ✓ | — |
| AP/AR Invoices | — | ✓ | ✓ | ✓ | — |
| Accounting/Export | — | — | ✓ | ✓ | ✓ |
| Tax Advisor Portal | — | — | — | ✓ | ✓ |
| Team Management | — | — | — | ✓ | — |
| Billing | — | — | — | ✓ | — |
| Admin Backoffice | — | — | — | — (Super) | — |

---

## SDK Usage (TypeScript)

```typescript
// Typed API client example
const LEDGERFLOW_BASE = 'https://app.ledgerflow.de/api'

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${LEDGERFLOW_BASE}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error((await res.json()).error)
  return (await res.json()).data
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${LEDGERFLOW_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.json()).error)
  return (await res.json()).data
}

// Usage
const expenses = await apiGet<Expense[]>('/expenses?status=PENDING_APPROVAL')
const newExpense = await apiPost<Expense>('/expenses', { merchant: 'Lufthansa', grossAmount: 842 })
```

---

## Vercel Cron Configuration

```json
// vercel.json
{
  "crons": [
    { "path": "/api/cron/daily-reminders",     "schedule": "0 7 * * *"  },
    { "path": "/api/cron/overdue-invoices",     "schedule": "0 8 * * *"  },
    { "path": "/api/cron/subscription-checks",  "schedule": "0 5 * * *"  },
    { "path": "/api/cron/approval-escalations", "schedule": "0 * * * *"  }
  ]
}
```

Secure with `CRON_SECRET` environment variable and `x-cron-secret` request header.

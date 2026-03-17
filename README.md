# LedgerFlow

**Financial Operating System for German SMEs**

A production-grade SaaS fintech platform combining business banking interface, corporate card management, expense management, invoicing, DATEV-ready accounting exports, tax advisor collaboration, and cash flow forecasting — built for the German market.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Auth | JWT + bcrypt |
| Styling | Tailwind CSS |
| State | TanStack Query |
| Tables | TanStack Table |
| Charts | Recharts |
| Storage | AWS S3 (pluggable) |
| Email | Nodemailer (SMTP/SES/Resend) |
| Export | DATEV Buchungsstapel CSV |

---

## Project Structure

```
ledgerflow/
├── prisma/
│   ├── schema.prisma          # Full database schema (30+ models)
│   └── seed.ts                # Demo data (3 companies, tax advisor)
│
├── src/
│   ├── app/
│   │   ├── api/               # API routes
│   │   │   ├── auth/          # login, signup, logout, invite
│   │   │   ├── expenses/      # CRUD + submit/approve/reject/export
│   │   │   ├── invoices/      # AP + AR
│   │   │   ├── cards/         # Card management
│   │   │   ├── transactions/  # Transaction ledger
│   │   │   ├── reimbursements/
│   │   │   ├── accounting/    # Mappings + DATEV export
│   │   │   ├── cashflow/      # Forecasting
│   │   │   ├── notifications/
│   │   │   ├── audit-logs/
│   │   │   └── admin/         # Super admin routes
│   │   │
│   │   ├── (auth)/            # Login, signup, invite pages
│   │   ├── dashboard/         # Main dashboard
│   │   ├── cards/             # Card management
│   │   ├── expenses/          # Expense list + detail
│   │   ├── invoices/          # AP + AR
│   │   ├── transactions/      # Transaction ledger
│   │   ├── reimbursements/
│   │   ├── accounting/        # Mappings + export center
│   │   ├── cashflow/
│   │   ├── tax-advisor/       # Tax advisor portal
│   │   ├── team/
│   │   ├── settings/
│   │   └── admin/             # Super admin backoffice
│   │
│   ├── components/
│   │   ├── ui/                # Reusable primitives (Button, Badge, Table...)
│   │   ├── layout/            # Sidebar, Header, Shell
│   │   └── modules/           # Feature-specific components
│   │
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── rbac.ts        # Role-based access control
│   │   │   ├── session.ts     # JWT session management
│   │   │   └── middleware.ts  # Route protection
│   │   ├── db/
│   │   │   └── prisma.ts      # Prisma client singleton
│   │   ├── services/
│   │   │   ├── datev-export.ts  # DATEV Buchungsstapel generation
│   │   │   ├── approval-engine.ts
│   │   │   ├── notification.ts
│   │   │   ├── cash-flow.ts
│   │   │   └── ocr.ts           # OCR abstraction layer
│   │   └── utils/
│   │       ├── currency.ts
│   │       ├── vat.ts
│   │       └── audit.ts
│   │
│   ├── types/
│   │   └── index.ts           # TypeScript types + Prisma re-exports
│   │
│   └── hooks/                 # React hooks (useExpenses, useCards...)
│
├── .env.example               # All environment variables documented
├── package.json
└── README.md
```

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- PostgreSQL 14+
- (Optional) AWS S3 bucket for file storage

### 2. Install

```bash
git clone https://github.com/your-org/ledgerflow
cd ledgerflow
npm install
```

### 3. Configure environment

```bash
cp .env.example .env.local
# Edit .env.local with your values
```

Minimum required:
```env
DATABASE_URL="postgresql://user:pass@localhost:5432/ledgerflow"
JWT_SECRET="your-32-char-secret"
```

### 4. Database setup

```bash
# Generate Prisma client
npm run db:generate

# Run migrations (development)
npm run db:push

# Seed demo data
npm run db:seed
```

### 5. Run

```bash
npm run dev
# → http://localhost:3000
```

### 6. Demo login

After seeding:

| Role | Email | Password |
|---|---|---|
| Platform Admin | admin@ledgerflow.de | demo123 |
| Company Admin | katrin.mueller@mueller-consulting.de | demo123 |
| Employee | thomas.huber@mueller-consulting.de | demo123 |
| Tax Advisor | weber@weber-partner.de | demo123 |

---

## User Roles & Permissions

| Permission | Super Admin | Company Admin | Finance Manager | Approver | Employee | Tax Advisor |
|---|---|---|---|---|---|---|
| Manage organization | ✓ | ✓ | — | — | — | — |
| Manage users | ✓ | ✓ | — | — | — | — |
| Manage cards | ✓ | ✓ | — | — | — | — |
| Manage expenses | ✓ | ✓ | ✓ | — | Own only | — |
| Manage invoices | ✓ | ✓ | ✓ | — | — | — |
| Approve expenses | ✓ | ✓ | ✓ | ✓ | — | — |
| Export accounting | ✓ | ✓ | ✓ | — | — | ✓ |
| View analytics | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Manage billing | ✓ | ✓ | — | — | — | — |
| Platform admin | ✓ | — | — | — | — | — |

---

## Core Modules

### Expense Management
- Upload receipts (drag & drop)
- OCR extraction (pluggable provider)
- VAT assignment (7%, 19%, 0%, EU)
- Cost center + department allocation
- Approval workflow (multi-step, configurable)
- Bulk approve/export

### Corporate Cards
- Virtual + physical card support
- Per-card spending limits (daily/weekly/monthly/one-time)
- Merchant category restrictions
- Freeze/unfreeze
- Real-time transaction feed
- Receipt matching

### DATEV Export
- Full Buchungsstapel v700 format
- SKR03/SKR04 account mapping
- VAT code mapping (VSt19, VSt7, USt19, EUV, etc.)
- Immutable export history
- Period locking

### Tax Advisor Portal
- Multi-client portfolio dashboard
- Missing document tracking
- VAT anomaly review
- Comment threads on entries
- Export center per client
- Period locking

### Cash Flow Forecasting
- 7/30/90 day projections
- Inflow: open AR invoices
- Outflow: AP due dates, payroll estimate, tax obligations
- Historical trend analysis
- Runway calculation

### Approval Workflow Engine
- Configurable multi-step policies per entity type
- Amount thresholds for auto-approval
- Role-based or user-specific approvers
- Escalation rules
- Full audit trail

---

## DATEV Integration

This platform produces **DATEV-ready exports** in the official Buchungsstapel CSV format (v700) compatible with:
- DATEV Unternehmen Online
- DATEV Kanzlei-Rechnungswesen
- Any compatible accounting tool

⚠️ This is NOT a certified DATEV integration. Real-time DATEV sync requires an official DATEV developer partnership. The export files are correctly formatted but must be manually imported.

Supported VAT codes:
- `VSt19` — Vorsteuer 19%
- `VSt7` — Vorsteuer 7%
- `USt19` / `USt7` — Umsatzsteuer
- `EUV` — EU innergemeinschaftlicher Erwerb
- `EUIG` — Innergemeinschaftliche Lieferung
- `DRITTLAND` — Reverse Charge

---

## API Design

All routes follow REST conventions under `/api/`:

```
GET    /api/expenses              List (paginated, filtered)
POST   /api/expenses              Create
GET    /api/expenses/:id          Detail
PUT    /api/expenses/:id          Update
DELETE /api/expenses/:id          Soft delete
POST   /api/expenses/:id/submit   Submit for approval
POST   /api/expenses/:id/approve  Approve
POST   /api/expenses/:id/reject   Reject with reason
POST   /api/expenses/:id/export   Add to export batch

GET    /api/invoices/ap           Supplier invoices
POST   /api/invoices/ap           Create supplier invoice
...
GET    /api/invoices/ar           Customer invoices
POST   /api/invoices/ar           Create customer invoice

GET    /api/accounting/export     Export batches
POST   /api/accounting/export     Create DATEV export
GET    /api/accounting/export/:id Download export file

GET    /api/dashboard/metrics     Dashboard KPIs
GET    /api/cashflow/forecast     Cash flow forecast

GET    /api/admin/companies       All companies (super admin)
GET    /api/admin/audit-logs      Platform audit logs
POST   /api/admin/impersonate     Support impersonation
```

Every response follows `{ data, error, meta }` envelope.

---

## Mock Services

The following are **intentional placeholders** for regulated/licensed services:

| Service | Placeholder | Real Provider Options |
|---|---|---|
| Card issuing | Mock card generator | Stripe Issuing, Marqeta, Solaris |
| Open banking | Mock transactions | Plaid, Tink, finAPI, Token.io |
| OCR | Mock extraction | Mindee, Veryfi, Google Vision |
| DATEV live sync | Export only | DATEV developer program |
| Payments | Mock | GoCardless, SEPA via bank API |
| Billing | Mock | Stripe |

---

## Security

- JWT session tokens (httpOnly cookies)
- bcrypt password hashing (cost factor 12)
- Row-level security via organizationId on all queries
- RBAC enforced server-side on every API route
- Soft deletes (no permanent financial data loss)
- Immutable export records (snapshots at export time)
- Audit log on every critical action
- Encrypted sensitive fields (IBAN, bank credentials)
- Rate limiting placeholder (Upstash Redis)
- Input validation via Zod on all API routes

---

## Compliance Note

> LedgerFlow is fintech-ready software designed for German SME financial workflows. Real regulated banking, card issuing, payment processing, and money movement features require licensed infrastructure integrations and full regulatory compliance review (BaFin, PSD2, GDPR) before any production deployment. This platform must not be used to hold, move, or process real funds without appropriate licenses and legal review.

---

## Roadmap

- [ ] Phase 1: Auth + org + dashboard + seed ✓ (architecture complete)
- [ ] Phase 2: Cards + transactions + expenses + receipts + approval
- [ ] Phase 3: AP invoices + AR invoices + accounting + DATEV export
- [ ] Phase 4: Cash flow + analytics + billing + admin + notifications
- [ ] Phase 5: Audit logs + permissions hardening + API docs + integration layer
- [ ] Phase 6: OCR integration + open banking + card issuer + SSO

---

## License

Proprietary — All rights reserved.

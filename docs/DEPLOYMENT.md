# LedgerFlow — Production Deployment Guide

## Architecture Overview

```
Internet → CDN (Cloudflare) → Load Balancer → Next.js App (Vercel / Docker)
                                                      ↓
                                              PostgreSQL (Neon / Supabase / RDS)
                                                      ↓
                                         S3 (receipts) · Redis (rate limits)
                                                      ↓
                            External: Stripe · Tink · Resend · Mindee · Sentry
```

---

## 1. Prerequisites

- Node.js 18+ (LTS)
- PostgreSQL 14+
- AWS account (for S3) or Cloudflare R2
- Domain with DNS access
- (Optional) Upstash Redis for distributed rate limiting

---

## 2. Environment Variables

Copy `.env.example` to `.env.production` and fill in all values:

```bash
cp .env.example .env.production
```

### Required (will fail to start without):
```env
DATABASE_URL=postgresql://user:pass@host:5432/ledgerflow_prod
JWT_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
NEXT_PUBLIC_APP_URL=https://app.ledgerflow.de
```

### Storage:
```env
STORAGE_PROVIDER=s3
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=ledgerflow-receipts-prod
```

### Email:
```env
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@ledgerflow.de
```

### Integrations (as needed):
```env
CARD_PROVIDER=stripe_issuing
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

BANK_PROVIDER=tink
TINK_CLIENT_ID=...
TINK_CLIENT_SECRET=...
TINK_WEBHOOK_SECRET=...

OCR_PROVIDER=mindee
MINDEE_API_KEY=...

CRON_SECRET=<openssl rand -hex 16>
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

---

## 3. Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Run migrations in production (never db:push)
npm run db:migrate:prod

# Seed demo data (staging only)
npm run db:seed
```

### PostgreSQL recommended settings:
```sql
-- Connection pooling (use PgBouncer or Neon connection pooling)
max_connections = 100

-- For DATEV exports (large result sets)
work_mem = '256MB'
max_parallel_workers_per_gather = 4
```

---

## 4. Build & Deploy

### Vercel (recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod

# Set environment variables via Vercel dashboard or:
vercel env add DATABASE_URL production
```

**vercel.json:**
```json
{
  "crons": [
    { "path": "/api/cron/daily-reminders",     "schedule": "0 7 * * *"  },
    { "path": "/api/cron/overdue-invoices",     "schedule": "0 8 * * *"  },
    { "path": "/api/cron/subscription-checks",  "schedule": "0 5 * * *"  },
    { "path": "/api/cron/approval-escalations", "schedule": "0 * * * *"  }
  ],
  "regions": ["fra1"]
}
```

### Docker (self-hosted)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t ledgerflow .
docker run -p 3000:3000 --env-file .env.production ledgerflow
```

### Docker Compose (with PostgreSQL)

```yaml
version: '3.9'
services:
  app:
    build: .
    ports: ["3000:3000"]
    env_file: .env.production
    depends_on: [db]
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ledgerflow
      POSTGRES_USER: ledgerflow
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports: ["5432:5432"]
    restart: unless-stopped

volumes:
  pgdata:
```

---

## 5. Database Backups

```bash
# Automated daily backup
pg_dump $DATABASE_URL | gzip > backup_$(date +%Y%m%d).sql.gz
aws s3 cp backup_$(date +%Y%m%d).sql.gz s3://ledgerflow-backups/

# Point-in-time recovery: use Neon branching or RDS automated backups
```

---

## 6. Security Hardening Checklist

- [ ] `JWT_SECRET` is 32+ random chars, never reused across environments
- [ ] `ENCRYPTION_KEY` is 32+ random chars, stored in secrets manager
- [ ] `SESSION_COOKIE_SECURE=true` in production
- [ ] Database SSL enabled (`?sslmode=require` in `DATABASE_URL`)
- [ ] S3 bucket is private (no public ACLs)
- [ ] S3 presigned URLs used for receipt access (expire in 1 hour)
- [ ] Rate limiting enabled (Upstash Redis configured)
- [ ] `CRON_SECRET` set and all cron routes protected
- [ ] Webhook secrets configured for all providers
- [ ] Sentry DSN configured for error monitoring
- [ ] CSP headers verified in browser dev tools
- [ ] HSTS preloading enabled
- [ ] Database credentials rotated every 90 days
- [ ] Super admin accounts use 2FA

---

## 7. Monitoring & Alerting

### Sentry (error tracking)
```env
SENTRY_DSN=https://...@sentry.io/...
SENTRY_ENVIRONMENT=production
```

```typescript
// src/app/global-error.tsx
import * as Sentry from '@sentry/nextjs'
export default function GlobalError({ error }) {
  Sentry.captureException(error)
  return <div>Something went wrong</div>
}
```

### Uptime monitoring
- Monitor `/api/health` every 60 seconds
- Alert if response time > 2000ms or status != 200
- Recommended: Betterstack, Better Uptime, or UptimeRobot

### Key metrics to alert on:
| Metric | Threshold | Action |
|---|---|---|
| DB latency | > 500ms | Scale DB or check queries |
| Error rate | > 1% | Check Sentry |
| `/api/health` | != 200 | Page on-call |
| Failed logins | > 20/min | Possible brute force |
| Export failures | Any | Check DB + S3 |

---

## 8. Performance Optimisation

### Database indexes (already in schema)
All critical query patterns are indexed. Run `EXPLAIN ANALYZE` on slow queries:
```sql
EXPLAIN ANALYZE
SELECT * FROM "Expense"
WHERE "organizationId" = 'clx...'
AND status IN ('APPROVED', 'EXPORTED')
AND "expenseDate" >= '2025-01-01';
```

### Prisma connection pooling
```env
# For serverless (Vercel) — use PgBouncer or Prisma Accelerate
DATABASE_URL="postgresql://user:pass@host/db?pgbouncer=true&connection_limit=1"
```

### Next.js caching
```typescript
// Cache dashboard data for 30 seconds
export const revalidate = 30

// Cache static reference data (VAT codes, SKR03) for 1 hour
export const revalidate = 3600
```

---

## 9. GDPR / DSGVO Compliance

LedgerFlow processes personal and financial data subject to GDPR (DSGVO).

### Data processing
- All data stored in EU regions (Frankfurt `eu-central-1`)
- Encryption at rest for sensitive fields (IBAN, bank credentials) via AES-256-GCM
- Encryption in transit via TLS 1.3
- Session tokens expire after 7 days

### Data subject rights
- **Right to access**: Users can export their data from Settings → Privacy
- **Right to deletion**: Soft-delete on all entities, full purge available via admin
- **Right to portability**: CSV/JSON export of all expense and invoice data

### Data retention
- Expense records: 10 years (§147 AO — German tax code retention requirement)
- Audit logs: 7 years
- Session tokens: 7 days
- Deleted organizations: 90-day grace period before purge

### Vendor DPAs required for:
- PostgreSQL host (Neon/Supabase/AWS RDS)
- S3/R2 storage provider
- Email provider (Resend/SendGrid)
- Error monitoring (Sentry)
- Banking integration (Tink/Plaid)

---

## 10. Legal / Compliance Notice

```
⚠️  IMPORTANT — READ BEFORE PRODUCTION DEPLOYMENT

LedgerFlow is fintech-ready software designed for German SME financial
workflows. Before deploying with real users and real financial data:

BANKING & PAYMENTS
Real-time bank account access (PSD2/Open Banking) requires either:
  - Direct licensing as an AISP with BaFin, OR
  - Partnership with a licensed AISP (e.g., Tink, finAPI, Plaid)

CARD ISSUING
Issuing corporate cards with real spending power requires:
  - E-Money Institution license (EMI) from BaFin, OR
  - Partnership with a licensed card issuer (Solaris, Marqeta + EMI partner,
    Stripe Issuing + Baas partner)

PAYMENT INITIATION
Initiating SEPA transfers on behalf of users requires:
  - PISP license from BaFin, OR
  - Partnership with a licensed payment initiation provider

DATEV INTEGRATION
Real-time DATEV sync (beyond file export) requires:
  - Acceptance into the DATEV Marktplatz developer program
  - Compliance with DATEV technical and data protection requirements

ACCOUNTING DATA RETENTION
§147 AO requires retention of accounting documents for 10 years.
Ensure your database backup strategy supports this requirement.

This software is provided as infrastructure — regulatory compliance
and licensing are the responsibility of the deploying organization.
```

---

## 11. Runbook — Common Operations

### Rotate JWT secret (requires all users to re-login)
```bash
# 1. Generate new secret
openssl rand -hex 32

# 2. Update environment variable
vercel env add JWT_SECRET production

# 3. Redeploy
vercel --prod

# All active sessions will be invalidated immediately
```

### Lock an accounting period (manual)
```sql
UPDATE "ExportBatch"
SET "isLocked" = true, "lockedAt" = NOW()
WHERE "organizationId" = 'clx...'
AND "periodStart" >= '2025-01-01'
AND "periodEnd" <= '2025-03-31';
```

### Purge a deleted organization (after 90-day grace period)
```bash
# Via Prisma Studio
npx prisma studio

# Or direct SQL (careful — irreversible)
DELETE FROM "Organization" WHERE id = 'clx...' AND "deletedAt" < NOW() - INTERVAL '90 days';
```

### Emergency: disable a compromised account
```sql
UPDATE "User" SET "isActive" = false WHERE email = 'compromised@example.de';
-- All active sessions will be rejected by middleware on next request
```

### Force re-export of a period (unlock → re-export → relock)
```sql
-- 1. Unlock the period
UPDATE "ExportBatch" SET "isLocked" = false WHERE id = 'clx...';

-- 2. Reset affected records
UPDATE "Expense" SET status = 'APPROVED', "exportBatchId" = NULL, "exportedAt" = NULL
WHERE "exportBatchId" = 'clx...';

-- 3. Re-run the export via the UI, then relock
```

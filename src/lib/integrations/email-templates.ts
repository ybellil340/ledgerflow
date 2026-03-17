/**
 * LedgerFlow Email Templates
 *
 * All transactional emails sent via the email adapter.
 * HTML is inlined and responsive for major email clients.
 */

import { getEmailAdapter } from '@/lib/integrations/adapters'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.ledgerflow.de'
const BRAND_COLOR = '#1a1a2e'

// ─────────────────────────────────────────────
// BASE TEMPLATE
// ─────────────────────────────────────────────

function baseTemplate(content: string, preheader = ''): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>LedgerFlow</title>
<style>
  body { margin: 0; padding: 0; background: #f8f9fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .wrapper { max-width: 600px; margin: 0 auto; padding: 32px 16px; }
  .card { background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; }
  .header { background: ${BRAND_COLOR}; padding: 24px 32px; }
  .logo { color: #ffffff; font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
  .body { padding: 32px; }
  .h1 { font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 8px; }
  .p { font-size: 15px; color: #4b5563; line-height: 1.6; margin: 0 0 16px; }
  .p-sm { font-size: 13px; color: #6b7280; line-height: 1.6; margin: 0 0 12px; }
  .btn { display: inline-block; background: ${BRAND_COLOR}; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; margin: 8px 0; }
  .divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
  .data-row { display: flex; gap: 16px; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
  .data-label { font-size: 12px; color: #9ca3af; min-width: 120px; }
  .data-value { font-size: 13px; color: #111827; font-weight: 500; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 100px; font-size: 11px; font-weight: 600; }
  .badge-green { background: #ecfdf5; color: #065f46; }
  .badge-red { background: #fef2f2; color: #991b1b; }
  .badge-amber { background: #fffbeb; color: #92400e; }
  .footer { padding: 24px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb; }
  .footer-text { font-size: 12px; color: #9ca3af; line-height: 1.6; }
</style>
</head>
<body>
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ''}
<div class="wrapper">
  <div class="card">
    <div class="header">
      <div class="logo">
        ▪︎ LedgerFlow
      </div>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p class="footer-text">
        This email was sent by LedgerFlow GmbH, Musterstraße 1, 80331 München, Germany.<br/>
        You are receiving this because you are a member of a LedgerFlow organization.<br/>
        <a href="${APP_URL}/settings/notifications" style="color: #6b7280;">Manage notification preferences</a>
      </p>
    </div>
  </div>
</div>
</body>
</html>`
}

// ─────────────────────────────────────────────
// INVITATION EMAIL
// ─────────────────────────────────────────────

export async function sendInvitationEmail(params: {
  to: string
  inviterName: string
  organizationName: string
  role: string
  inviteUrl: string
  expiresAt: Date
}) {
  const roleLabel: Record<string, string> = {
    COMPANY_ADMIN: 'Company Admin',
    FINANCE_MANAGER: 'Finance Manager',
    APPROVER: 'Approver / Department Manager',
    EMPLOYEE: 'Employee',
  }

  const content = `
<h1 class="h1">You've been invited to ${params.organizationName}</h1>
<p class="p">${params.inviterName} has invited you to join <strong>${params.organizationName}</strong> on LedgerFlow as <strong>${roleLabel[params.role] ?? params.role}</strong>.</p>
<p class="p">LedgerFlow is a financial operating system for managing expenses, corporate cards, invoices, and accounting — all DATEV-ready.</p>
<a href="${params.inviteUrl}" class="btn">Accept invitation →</a>
<hr class="divider"/>
<p class="p-sm">This invitation expires on <strong>${params.expiresAt.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>. If you weren't expecting this, you can ignore this email.</p>
<p class="p-sm">Or copy this link: <br/><span style="font-family: monospace; font-size: 12px; color: #4b5563;">${params.inviteUrl}</span></p>
`

  await getEmailAdapter().send({
    to: params.to,
    subject: `${params.inviterName} invited you to ${params.organizationName} on LedgerFlow`,
    html: baseTemplate(content, `You've been invited to join ${params.organizationName} on LedgerFlow`),
  })
}

// ─────────────────────────────────────────────
// EXPENSE APPROVED/REJECTED
// ─────────────────────────────────────────────

export async function sendExpenseDecisionEmail(params: {
  to: string
  firstName: string
  decision: 'approved' | 'rejected'
  merchant: string
  amount: number
  currency: string
  reason?: string
  expenseUrl: string
}) {
  const isApproved = params.decision === 'approved'
  const amountFormatted = new Intl.NumberFormat('de-DE', { style: 'currency', currency: params.currency }).format(params.amount)

  const content = `
<h1 class="h1">Expense ${isApproved ? 'approved ✓' : 'rejected ✗'}</h1>
<p class="p">Hi ${params.firstName}, your expense has been <strong>${params.decision}</strong>.</p>
<div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
  <div class="data-row"><span class="data-label">Merchant</span><span class="data-value">${params.merchant}</span></div>
  <div class="data-row"><span class="data-label">Amount</span><span class="data-value">${amountFormatted}</span></div>
  <div class="data-row" style="border-bottom: none;"><span class="data-label">Status</span><span class="data-value"><span class="badge ${isApproved ? 'badge-green' : 'badge-red'}">${isApproved ? 'Approved' : 'Rejected'}</span></span></div>
</div>
${params.reason ? `<p class="p"><strong>Reason:</strong> ${params.reason}</p>` : ''}
<a href="${params.expenseUrl}" class="btn">View expense →</a>
`

  await getEmailAdapter().send({
    to: params.to,
    subject: `Expense ${params.decision}: ${params.merchant} — ${amountFormatted}`,
    html: baseTemplate(content, `Your expense at ${params.merchant} has been ${params.decision}`),
  })
}

// ─────────────────────────────────────────────
// INVOICE OVERDUE REMINDER
// ─────────────────────────────────────────────

export async function sendInvoiceOverdueEmail(params: {
  to: string
  organizationName: string
  invoiceNumber: string
  supplierName: string
  amount: number
  currency: string
  dueDate: Date
  daysOverdue: number
  invoiceUrl: string
}) {
  const amountFormatted = new Intl.NumberFormat('de-DE', { style: 'currency', currency: params.currency }).format(params.amount)

  const content = `
<h1 class="h1">Invoice overdue — action required</h1>
<p class="p">The following supplier invoice for <strong>${params.organizationName}</strong> is <strong>${params.daysOverdue} days overdue</strong> and requires immediate attention.</p>
<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
  <div class="data-row"><span class="data-label">Supplier</span><span class="data-value">${params.supplierName}</span></div>
  <div class="data-row"><span class="data-label">Invoice</span><span class="data-value" style="font-family: monospace;">${params.invoiceNumber}</span></div>
  <div class="data-row"><span class="data-label">Due date</span><span class="data-value" style="color: #dc2626;">${params.dueDate.toLocaleDateString('de-DE')}</span></div>
  <div class="data-row" style="border-bottom: none;"><span class="data-label">Amount</span><span class="data-value" style="font-size: 16px;">${amountFormatted}</span></div>
</div>
<a href="${params.invoiceUrl}" class="btn">Review invoice →</a>
<hr class="divider"/>
<p class="p-sm">Late payments may incur penalty interest under §286 BGB (Verzugszinsen). Please arrange payment or contact the supplier to agree on a payment plan.</p>
`

  await getEmailAdapter().send({
    to: params.to,
    subject: `⚠ Invoice overdue ${params.daysOverdue}d — ${params.supplierName} ${amountFormatted}`,
    html: baseTemplate(content, `Overdue invoice from ${params.supplierName} requires attention`),
  })
}

// ─────────────────────────────────────────────
// TAX ADVISOR COMMENT NOTIFICATION
// ─────────────────────────────────────────────

export async function sendTaxAdvisorCommentEmail(params: {
  to: string
  firstName: string
  advisorName: string
  advisorFirm: string
  comment: string
  entityDescription: string
  requestsDocument: boolean
  entityUrl: string
}) {
  const content = `
<h1 class="h1">Comment from your tax advisor</h1>
<p class="p">Hi ${params.firstName}, <strong>${params.advisorName}</strong> from <strong>${params.advisorFirm}</strong> has left a comment on: <em>${params.entityDescription}</em></p>
<div style="background: #f0f9ff; border-left: 3px solid #0ea5e9; border-radius: 0 8px 8px 0; padding: 16px; margin: 16px 0;">
  <p style="font-size: 14px; color: #0c4a6e; margin: 0; line-height: 1.6;">"${params.comment}"</p>
  <p style="font-size: 12px; color: #7dd3fc; margin: 8px 0 0;">— ${params.advisorName}, ${params.advisorFirm}</p>
</div>
${params.requestsDocument ? `
<div style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
  <p style="font-size: 13px; color: #92400e; margin: 0;">📎 <strong>Document requested:</strong> Your tax advisor needs you to upload a receipt or document for this item.</p>
</div>` : ''}
<a href="${params.entityUrl}" class="btn">View and respond →</a>
`

  await getEmailAdapter().send({
    to: params.to,
    subject: `Tax advisor comment: ${params.entityDescription}`,
    html: baseTemplate(content, `${params.advisorName} left a comment on your ${params.entityDescription}`),
  })
}

// ─────────────────────────────────────────────
// MISSING RECEIPT REMINDER
// ─────────────────────────────────────────────

export async function sendMissingReceiptReminderEmail(params: {
  to: string
  firstName: string
  expenses: Array<{ merchant: string; amount: number; currency: string; date: Date }>
  uploadUrl: string
}) {
  const items = params.expenses.slice(0, 5).map((e) => {
    const amt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: e.currency }).format(e.amount)
    return `<div class="data-row"><span class="data-label">${e.date.toLocaleDateString('de-DE')}</span><span class="data-value">${e.merchant} — ${amt}</span></div>`
  }).join('')

  const content = `
<h1 class="h1">Missing receipts — action needed</h1>
<p class="p">Hi ${params.firstName}, you have <strong>${params.expenses.length} expense${params.expenses.length !== 1 ? 's' : ''}</strong> without a receipt attached. Receipts are required for expense approval and DATEV export.</p>
<div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
  ${items}
  ${params.expenses.length > 5 ? `<p class="p-sm" style="margin: 8px 0 0;">...and ${params.expenses.length - 5} more</p>` : ''}
</div>
<a href="${params.uploadUrl}" class="btn">Upload receipts →</a>
<hr class="divider"/>
<p class="p-sm">Tip: You can photograph receipts with your phone and upload them directly in the mobile view. Supported formats: JPEG, PNG, PDF (max 20MB).</p>
`

  await getEmailAdapter().send({
    to: params.to,
    subject: `${params.expenses.length} missing receipt${params.expenses.length !== 1 ? 's' : ''} — upload required`,
    html: baseTemplate(content, `You have ${params.expenses.length} expenses without receipts`),
  })
}

// ─────────────────────────────────────────────
// EXPORT READY NOTIFICATION
// ─────────────────────────────────────────────

export async function sendExportReadyEmail(params: {
  to: string
  firstName: string
  format: string
  recordCount: number
  period: string
  downloadUrl: string
}) {
  const content = `
<h1 class="h1">Export ready for download</h1>
<p class="p">Hi ${params.firstName}, your <strong>${params.format}</strong> export is ready.</p>
<div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 16px 0;">
  <div class="data-row"><span class="data-label">Format</span><span class="data-value">${params.format}</span></div>
  <div class="data-row"><span class="data-label">Period</span><span class="data-value">${params.period}</span></div>
  <div class="data-row" style="border-bottom: none;"><span class="data-label">Records</span><span class="data-value">${params.recordCount}</span></div>
</div>
<a href="${params.downloadUrl}" class="btn">Download export →</a>
<hr class="divider"/>
<p class="p-sm">The download link expires in 7 days. For DATEV import: open DATEV Unternehmen Online → Buchführung → Belege → Buchungsstapel importieren.</p>
`

  await getEmailAdapter().send({
    to: params.to,
    subject: `DATEV export ready — ${params.period} (${params.recordCount} records)`,
    html: baseTemplate(content, `Your ${params.format} accounting export for ${params.period} is ready`),
  })
}

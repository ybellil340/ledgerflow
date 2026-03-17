'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { billingApi } from '@/lib/api/endpoints'
import { useAuth } from '@/lib/store/auth'
import { useToast } from '@/components/providers/error-system'
import { Button, Badge, Modal, Card, Spinner, EmptyState, Amount } from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanId = 'STARTER' | 'GROWTH' | 'PRO' | 'ENTERPRISE'
type BillingCycle = 'MONTHLY' | 'ANNUAL'

interface Plan {
  id: PlanId
  name: string
  monthlyPrice: number
  annualPrice: number
  features: string[]
  limits: { users: number; cards: number; expenses: string }
  popular?: boolean
}

interface UsageMeter {
  label: string
  current: number
  limit: number | null    // null = unlimited
  unit: string
}

interface BillingInvoice {
  id: string
  description: string
  amount: number
  currency: string
  period: string
  status: 'PAID' | 'OPEN' | 'VOID'
  pdfUrl?: string
  createdAt: string
}

interface BillingInfo {
  currentPlan: PlanId
  billingCycle: BillingCycle
  nextRenewalDate: string
  trialEndsAt?: string
  isTrialing: boolean
  monthlyPrice: number
  usage: UsageMeter[]
  paymentMethodLast4?: string
  paymentMethodBrand?: string
}

// ─── Plan definitions (mirrored from API) ─────────────────────────────────────

const PLANS: Plan[] = [
  {
    id: 'STARTER',
    name: 'Starter',
    monthlyPrice: 29,
    annualPrice: 24,
    features: [
      'Up to 5 users',
      '10 corporate cards',
      'Expense management',
      'AP/AR invoicing',
      'DATEV Buchungsstapel export',
      'Email support',
    ],
    limits: { users: 5, cards: 10, expenses: 'Unlimited' },
  },
  {
    id: 'GROWTH',
    name: 'Growth',
    monthlyPrice: 89,
    annualPrice: 74,
    features: [
      'Up to 25 users',
      '50 corporate cards',
      'Everything in Starter',
      'Tax advisor collaboration portal',
      'Multi-step approval workflows',
      'Cash flow forecasting',
      'Priority support',
    ],
    limits: { users: 25, cards: 50, expenses: 'Unlimited' },
    popular: true,
  },
  {
    id: 'PRO',
    name: 'Pro',
    monthlyPrice: 199,
    annualPrice: 165,
    features: [
      'Up to 100 users',
      '200 corporate cards',
      'Everything in Growth',
      'Multi-currency support',
      'Budget management',
      'Custom approval policies',
      'Dedicated account manager',
      'SSO (SAML)',
    ],
    limits: { users: 100, cards: 200, expenses: 'Unlimited' },
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    monthlyPrice: 0,
    annualPrice: 0,
    features: [
      'Unlimited users & cards',
      'Everything in Pro',
      'Custom DATEV live sync',
      'Custom integrations',
      'SLA guarantee',
      'On-premise deployment option',
      'Dedicated support engineer',
    ],
    limits: { users: Infinity, cards: Infinity, expenses: 'Unlimited' },
  },
]

// ─── Usage bar component ───────────────────────────────────────────────────────

function UsageBar({ meter }: { meter: UsageMeter }) {
  const isUnlimited = meter.limit === null || meter.limit === 0
  const pct = isUnlimited ? 0 : Math.min(100, Math.round((meter.current / meter.limit!) * 100))
  const isWarning = pct > 80
  const isCritical = pct > 95

  return (
    <div className="mb-4 last:mb-0">
      <div className="flex justify-between mb-1.5">
        <span className="text-sm text-gray-600">{meter.label}</span>
        <span className="text-sm font-medium">
          {meter.current}
          {!isUnlimited && ` / ${meter.limit}`}
          {isUnlimited && ' (unlimited)'}
          {meter.unit && ` ${meter.unit}`}
        </span>
      </div>
      {!isUnlimited && (
        <>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                background: isCritical ? '#E24B4A' : isWarning ? '#EF9F27' : '#185FA5',
              }}
            />
          </div>
          {isWarning && (
            <p className="text-xs mt-1" style={{ color: isCritical ? '#A32D2D' : '#BA7517' }}>
              {isCritical
                ? '⚠ Limit almost reached — upgrade to avoid disruption'
                : '↑ Approaching limit — consider upgrading'}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ─── Upgrade modal ─────────────────────────────────────────────────────────────

function UpgradeModal({
  currentPlan,
  currentCycle,
  onClose,
  onUpgrade,
}: {
  currentPlan: PlanId
  currentCycle: BillingCycle
  onClose(): void
  onUpgrade(planId: PlanId, cycle: BillingCycle): Promise<void>
}) {
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(
    currentPlan === 'STARTER' ? 'GROWTH'
    : currentPlan === 'GROWTH' ? 'PRO'
    : 'ENTERPRISE'
  )
  const [cycle, setCycle] = useState<BillingCycle>(currentCycle)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  async function handleConfirm() {
    if (selectedPlan === 'ENTERPRISE') {
      // Route to contact sales
      window.open('mailto:sales@ledgerflow.de?subject=Enterprise%20inquiry', '_blank')
      onClose()
      return
    }
    setLoading(true)
    try {
      await onUpgrade(selectedPlan, cycle)
    } finally {
      setLoading(false)
    }
  }

  const price = (plan: Plan) =>
    cycle === 'ANNUAL' ? plan.annualPrice : plan.monthlyPrice

  return (
    <Modal title="Upgrade your plan" subtitle="Changes take effect immediately. Prorated billing applies." onClose={onClose} wide>
      {/* Billing cycle toggle */}
      <div className="flex items-center justify-center gap-3 mb-5">
        <button
          className={`text-sm px-4 py-1.5 rounded-lg border transition-colors ${cycle === 'MONTHLY' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 border-gray-200 hover:border-gray-300'}`}
          onClick={() => setCycle('MONTHLY')}
        >
          Monthly
        </button>
        <button
          className={`text-sm px-4 py-1.5 rounded-lg border transition-colors ${cycle === 'ANNUAL' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 border-gray-200 hover:border-gray-300'}`}
          onClick={() => setCycle('ANNUAL')}
        >
          Annual <span className="text-green-500 text-xs ml-1">Save 17%</span>
        </button>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan
          const isSelected = plan.id === selectedPlan
          const isDowngrade = PLANS.findIndex(p => p.id === plan.id) < PLANS.findIndex(p => p.id === currentPlan)

          return (
            <div
              key={plan.id}
              className={`rounded-xl border-2 p-3 cursor-pointer transition-all ${
                isSelected ? 'border-blue-600 bg-blue-50' :
                isCurrent ? 'border-gray-200 bg-gray-50' :
                'border-gray-100 hover:border-gray-200'
              } ${isDowngrade ? 'opacity-50' : ''}`}
              onClick={() => !isDowngrade && setSelectedPlan(plan.id)}
            >
              {plan.popular && (
                <div className="text-[9px] font-semibold text-blue-600 uppercase tracking-wide mb-1">Popular</div>
              )}
              <div className="font-semibold text-sm mb-1">{plan.name}</div>
              {plan.id === 'ENTERPRISE' ? (
                <div className="text-xs font-medium text-gray-500">Custom</div>
              ) : (
                <div>
                  <span className="text-lg font-bold">€{price(plan)}</span>
                  <span className="text-xs text-gray-400">/mo</span>
                </div>
              )}
              {isCurrent && (
                <div className="text-[9px] text-gray-400 mt-1">Current plan</div>
              )}
              <ul className="mt-2 space-y-1">
                {plan.features.slice(0, 3).map((f) => (
                  <li key={f} className="text-[10px] text-gray-500 flex items-start gap-1">
                    <span className="text-green-600 mt-px">✓</span> {f}
                  </li>
                ))}
                {plan.features.length > 3 && (
                  <li className="text-[10px] text-blue-600">+{plan.features.length - 3} more</li>
                )}
              </ul>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={handleConfirm}
          loading={loading}
          disabled={selectedPlan === currentPlan}
        >
          {selectedPlan === 'ENTERPRISE'
            ? 'Contact sales'
            : `Upgrade to ${PLANS.find(p => p.id === selectedPlan)?.name}`}
        </Button>
      </div>
    </Modal>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { can } = useAuth()
  const { toast } = useToast()
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)

  const { data: billing, isLoading } = useQuery<BillingInfo>(
    'billing',
    () => billingApi.getBillingInfo()
  )

  const { data: invoices, isLoading: invoicesLoading } = useQuery<BillingInvoice[]>(
    'billing/invoices',
    () => billingApi.listInvoices()
  )

  const upgradeMutation = useMutation()

  const handleUpgrade = useCallback(async (planId: PlanId, cycle: BillingCycle) => {
    try {
      await upgradeMutation.mutate(() =>
        billingApi.upgrade({ planId, billingCycle: cycle })
      )
      toast({ type: 'success', message: `Plan upgraded to ${planId}` })
      invalidateQuery('billing')
      setShowUpgradeModal(false)
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }, [upgradeMutation, toast])

  const currentPlanDef = PLANS.find(p => p.id === billing?.currentPlan)

  return (
    <AppShell
      title="Billing & Subscription"
      subtitle={billing ? `${billing.currentPlan} Plan · Renews ${billing.nextRenewalDate}` : 'Loading...'}
    >
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !billing ? null : (
        <>
          {/* Trial banner */}
          {billing.isTrialing && billing.trialEndsAt && (
            <div className="info-box amber mb-4 flex items-center justify-between">
              <div>
                <strong>Free trial active</strong> — your trial ends on{' '}
                <strong>{billing.trialEndsAt}</strong>. Add a payment method to continue after trial.
              </div>
              <Button variant="primary" size="sm" onClick={() => setShowUpgradeModal(true)}>
                Upgrade now
              </Button>
            </div>
          )}

          <div className="g2 mb-4">
            {/* Current plan panel */}
            <Card>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg font-medium">{currentPlanDef?.name} Plan</span>
                    <Badge label="Active" variant="green" />
                  </div>
                  <div className="text-sm text-gray-400">
                    Renews {billing.nextRenewalDate} ·{' '}
                    {billing.billingCycle === 'ANNUAL' ? 'Annual billing' : 'Monthly billing'}
                  </div>
                  <div className="mt-2">
                    <span className="text-2xl font-medium">€{billing.monthlyPrice}</span>
                    <span className="text-sm text-gray-400">/month</span>
                  </div>
                </div>
                {can('billing:manage') && (
                  <Button variant="primary" onClick={() => setShowUpgradeModal(true)}>
                    Upgrade plan
                  </Button>
                )}
              </div>

              <div className="divider mb-4" />

              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Included features
              </div>
              {(currentPlanDef?.features ?? []).map((f) => (
                <div key={f} className="flex items-center gap-2 text-sm text-gray-600 py-1">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M2 7l3 3 6-6" stroke="#3B6D11" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {f}
                </div>
              ))}

              {billing.paymentMethodLast4 && (
                <>
                  <div className="divider my-4" />
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
                      <rect x="0.5" y="0.5" width="17" height="11" rx="1.5" stroke="#D1D5DB" />
                      <rect y="3" width="18" height="3" fill="#E5E7EB" />
                    </svg>
                    {billing.paymentMethodBrand} ending in {billing.paymentMethodLast4}
                  </div>
                </>
              )}
            </Card>

            {/* Usage meters */}
            <Card>
              <div className="panel-title mb-4">Usage this month</div>
              {billing.usage.map((meter) => (
                <UsageBar key={meter.label} meter={meter} />
              ))}
            </Card>
          </div>

          {/* Invoice history */}
          <Card>
            <div className="panel-title mb-4">Invoice history</div>
            {invoicesLoading ? <Spinner /> : !invoices?.length ? (
              <EmptyState title="No invoices yet" description="Your billing invoices will appear here." />
            ) : (
              <div>
                {invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0"
                  >
                    <div className="flex-1">
                      <div className="text-sm font-medium">{inv.description}</div>
                      <div className="text-xs text-gray-400">{inv.period}</div>
                    </div>
                    <div className="text-sm font-medium">
                      <Amount value={inv.amount} currency={inv.currency} />
                    </div>
                    <Badge
                      label={inv.status.charAt(0) + inv.status.slice(1).toLowerCase()}
                      variant={inv.status === 'PAID' ? 'green' : inv.status === 'OPEN' ? 'amber' : 'gray'}
                    />
                    {inv.pdfUrl && (
                      <a
                        href={inv.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Download
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="info-box mt-3 bg-gray-50 border-gray-200 text-gray-400 text-xs">
            All invoices issued by LedgerFlow GmbH · Maximilianstraße 45 · 80331 München ·
            VAT ID: DE000000000. Prices shown exclude VAT (19%). German VAT added unless
            a valid EU VAT ID is provided.
          </div>
        </>
      )}

      {showUpgradeModal && billing && (
        <UpgradeModal
          currentPlan={billing.currentPlan}
          currentCycle={billing.billingCycle}
          onClose={() => setShowUpgradeModal(false)}
          onUpgrade={handleUpgrade}
        />
      )}
    </AppShell>
  )
}

'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, invalidateQuery } from '@/lib/hooks'
import { settingsApi } from '@/lib/api/endpoints'
import { useAuth } from '@/lib/store/auth'
import { useToast } from '@/components/providers/error-system'
import { Button, Badge, Modal, Input, Card, Spinner } from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

type IntegrationStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'PENDING'

interface Integration {
  id: string
  key: string
  name: string
  description: string
  category: 'accounting' | 'banking' | 'payments' | 'ocr' | 'notifications' | 'hr'
  status: IntegrationStatus
  connectedAt?: string
  connectedBy?: string
  lastSyncAt?: string
  syncCount?: number
  errorMessage?: string
  logoUrl?: string
  docsUrl?: string
  authType: 'oauth2' | 'api_key' | 'webhook' | 'manual'
  isBeta?: boolean
  isComingSoon?: boolean
}

// ─── Integration logos (inline SVG stubs) ─────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  accounting: '📒 Accounting',
  banking: '🏦 Open Banking',
  payments: '💳 Payments',
  ocr: '🔍 OCR & Receipt',
  notifications: '🔔 Notifications',
  hr: '👥 HR & Payroll',
}

const STATUS_VARIANTS: Record<IntegrationStatus, string> = {
  CONNECTED: 'green',
  DISCONNECTED: 'gray',
  ERROR: 'red',
  PENDING: 'amber',
}

// ─── Connect modal ─────────────────────────────────────────────────────────────

function ConnectModal({ integration, onClose, onSuccess }: {
  integration: Integration
  onClose(): void
  onSuccess(): void
}) {
  const [apiKey, setApiKey] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const { toast } = useToast()
  const mutation = useMutation()

  async function handleOAuth() {
    try {
      const result = await mutation.mutate(() =>
        settingsApi.getIntegrationOAuthUrl(integration.key)
      ) as { authUrl: string }
      // Redirect to OAuth provider
      window.location.href = result.authUrl
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  async function handleApiKey() {
    if (!apiKey.trim()) {
      toast({ type: 'error', message: 'API key is required' })
      return
    }
    try {
      await mutation.mutate(() =>
        settingsApi.connectIntegration(integration.key, { apiKey })
      )
      toast({ type: 'success', message: `${integration.name} connected successfully` })
      invalidateQuery('integrations')
      onSuccess()
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }

  return (
    <Modal
      title={`Connect ${integration.name}`}
      subtitle={integration.description}
      onClose={onClose}
    >
      {integration.authType === 'oauth2' ? (
        <div>
          <div className="p-4 bg-gray-50 rounded-xl mb-4 text-sm text-gray-600 leading-relaxed">
            You'll be redirected to <strong>{integration.name}</strong> to authorize access.
            LedgerFlow will only request the minimum permissions needed.
          </div>
          {integration.key === 'tink' && (
            <div className="info-box blue mb-4 text-xs">
              <strong>Tink Open Banking (PSD2):</strong> Connects your German bank accounts
              (Deutsche Bank, Commerzbank, Sparkasse, etc.) for automatic transaction import.
              Uses PSD2-compliant authentication.
            </div>
          )}
          {integration.key === 'stripe_issuing' && (
            <div className="info-box blue mb-4 text-xs">
              <strong>Stripe Issuing:</strong> Powers corporate card issuance. Your cards
              will be issued as Stripe virtual/physical cards with real-time spend controls.
              Requires Stripe identity verification.
            </div>
          )}
          <Button
            variant="primary"
            onClick={handleOAuth}
            loading={mutation.isLoading}
            className="w-full justify-center"
          >
            Connect with {integration.name} →
          </Button>
        </div>
      ) : integration.authType === 'api_key' ? (
        <div className="space-y-3">
          <div>
            <label className="f-label">API Key *</label>
            <Input
              type="password"
              value={apiKey}
              onChange={setApiKey}
              placeholder="Enter your API key..."
            />
            {integration.docsUrl && (
              <p className="text-xs text-gray-400 mt-1">
                Find your API key in{' '}
                <a href={integration.docsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {integration.name} settings
                </a>
              </p>
            )}
          </div>
          <Button variant="primary" onClick={handleApiKey} loading={mutation.isLoading} className="w-full justify-center">
            Connect {integration.name}
          </Button>
        </div>
      ) : (
        <div className="text-sm text-gray-500 p-4 bg-gray-50 rounded-xl">
          Manual setup required. Please contact support@ledgerflow.de for configuration assistance.
        </div>
      )}
    </Modal>
  )
}

// ─── Integration card ──────────────────────────────────────────────────────────

function IntegrationCard({ integration, onConnect, onDisconnect }: {
  integration: Integration
  onConnect(i: Integration): void
  onDisconnect(key: string): void
}) {
  const isConnected = integration.status === 'CONNECTED'
  const hasError = integration.status === 'ERROR'

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          {/* Logo placeholder */}
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-xl flex-shrink-0">
            {integration.key === 'datev' ? '📒'
             : integration.key === 'tink' ? '🏦'
             : integration.key === 'stripe_issuing' ? '💳'
             : integration.key === 'mindee' ? '🔍'
             : integration.key === 'google_vision' ? '👁'
             : integration.key === 'slack' ? '💬'
             : integration.key === 'resend' ? '✉️'
             : integration.key === 'datev_lohn' ? '👥'
             : '🔌'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{integration.name}</span>
              {integration.isBeta && <Badge label="Beta" variant="amber" size="sm" />}
              {integration.isComingSoon && <Badge label="Soon" variant="gray" size="sm" />}
            </div>
            <div className="text-xs text-gray-400 mt-0.5 max-w-[200px] leading-snug">
              {integration.description}
            </div>
          </div>
        </div>
        <Badge label={integration.status.charAt(0) + integration.status.slice(1).toLowerCase()} variant={STATUS_VARIANTS[integration.status] as any} size="sm" />
      </div>

      {isConnected && integration.lastSyncAt && (
        <div className="text-xs text-gray-400 mb-3">
          Last sync: {new Date(integration.lastSyncAt).toLocaleString('de-DE')}
          {integration.syncCount && ` · ${integration.syncCount} records`}
        </div>
      )}

      {hasError && integration.errorMessage && (
        <div className="text-xs text-red-500 mb-3 bg-red-50 rounded-lg px-2.5 py-1.5">
          ⚠ {integration.errorMessage}
        </div>
      )}

      <div className="flex gap-2">
        {integration.isComingSoon ? (
          <Button variant="ghost" size="sm" disabled className="text-gray-300">Coming soon</Button>
        ) : isConnected ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => settingsApi.syncIntegration(integration.key).then(() => invalidateQuery('integrations'))}>
              ↻ Sync now
            </Button>
            <Button variant="danger-ghost" size="sm" onClick={() => onDisconnect(integration.key)}>
              Disconnect
            </Button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={() => onConnect(integration)}>
            Connect
          </Button>
        )}
        {integration.docsUrl && (
          <a
            href={integration.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-gray-600 self-center ml-auto"
          >
            Docs ↗
          </a>
        )}
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { can } = useAuth()
  const { toast } = useToast()
  const [connectingIntegration, setConnectingIntegration] = useState<Integration | null>(null)

  const { data: integrations, isLoading } = useQuery<Integration[]>(
    'integrations',
    () => settingsApi.listIntegrations()
  )

  const disconnectMutation = useMutation()

  const handleDisconnect = useCallback(async (key: string) => {
    try {
      await disconnectMutation.mutate(() => settingsApi.disconnectIntegration(key))
      toast({ type: 'info', message: 'Integration disconnected' })
      invalidateQuery('integrations')
    } catch (e: any) {
      toast({ type: 'error', message: e.message })
    }
  }, [disconnectMutation, toast])

  // Group integrations by category
  const grouped = (integrations ?? []).reduce((acc: Record<string, Integration[]>, i) => {
    (acc[i.category] = acc[i.category] || []).push(i)
    return acc
  }, {})

  const connectedCount = (integrations ?? []).filter(i => i.status === 'CONNECTED').length
  const errorCount = (integrations ?? []).filter(i => i.status === 'ERROR').length

  return (
    <AppShell
      title="Integrations"
      subtitle={integrations ? `${connectedCount} connected · ${(integrations ?? []).length} available` : 'Loading...'}
    >
      {errorCount > 0 && (
        <div className="info-box red mb-4">
          <strong>⚠ {errorCount} integration{errorCount > 1 ? 's' : ''} need{errorCount === 1 ? 's' : ''} attention</strong>
          {' '}— Check the affected integrations below.
        </div>
      )}

      {/* PSD2 / DATEV compliance note */}
      <div className="info-box blue mb-4 text-xs">
        <strong>Compliance note:</strong> Open banking connections use PSD2-regulated flows.
        DATEV live sync requires an official DATEV developer partnership and annual certification.
        All connections are encrypted at rest (AES-256-GCM) and transmitted over TLS 1.3.
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {CATEGORY_LABELS[category] ?? category}
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {items.map((integration) => (
                  <IntegrationCard
                    key={integration.key}
                    integration={integration}
                    onConnect={setConnectingIntegration}
                    onDisconnect={handleDisconnect}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {connectingIntegration && (
        <ConnectModal
          integration={connectingIntegration}
          onClose={() => setConnectingIntegration(null)}
          onSuccess={() => setConnectingIntegration(null)}
        />
      )}
    </AppShell>
  )
}

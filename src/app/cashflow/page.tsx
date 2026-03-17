'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@/lib/hooks'
import { cashFlowApi } from '@/lib/api/endpoints'
import { Card, Spinner, Amount } from '@/components/ui'
import { AppShell } from '@/components/layout/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CashFlowForecast {
  currentBalance: number
  projectedBalance: number
  burnRateMonthly: number
  runwayMonths: number
  expectedInflow30d: number
  expectedOutflow30d: number
  inflowCoverageRatio: number
  monthlyHistory: { month: string; inflow: number; outflow: number; balance: number }[]
  obligations: {
    id: string
    label: string
    dueDate: string
    amount: number
    category: 'payroll' | 'tax' | 'invoice' | 'subscription' | 'other'
    daysUntilDue: number
  }[]
  expectedInflows: {
    id: string
    label: string
    expectedDate: string
    amount: number
    source: 'ar_invoice' | 'recurring' | 'other'
    confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  }[]
  dailyForecast: {
    date: string
    openingBalance: number
    inflows: number
    outflows: number
    closingBalance: number
  }[]
}

type Range = '7d' | '30d' | '90d' | '180d'
type ViewMode = 'chart' | 'table'

// ─── SVG bar chart ─────────────────────────────────────────────────────────────

function BarChart({
  data,
  height = 130,
}: {
  data: { month: string; inflow: number; outflow: number }[]
  height?: number
}) {
  const maxV = Math.max(...data.flatMap((d) => [d.inflow, d.outflow]), 1)
  const barW = 100 / (data.length * 3)

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      {data.map((d, i) => {
        const x = (i / data.length) * 100 + barW * 0.3
        const inflowH = (d.inflow / maxV) * (height - 16)
        const outflowH = (d.outflow / maxV) * (height - 16)
        return (
          <g key={d.month}>
            {/* Inflow bar */}
            <rect
              x={`${x}%`}
              y={height - 16 - inflowH}
              width={`${barW}%`}
              height={inflowH}
              fill="#185FA5"
              rx="2"
            />
            {/* Outflow bar */}
            <rect
              x={`${x + barW}%`}
              y={height - 16 - outflowH}
              width={`${barW}%`}
              height={outflowH}
              fill="#D3D1C7"
              rx="2"
            />
            {/* Label */}
            <text
              x={`${x + barW}%`}
              y={height - 4}
              fontSize="5"
              fill="#9CA3AF"
              textAnchor="middle"
            >
              {d.month}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Obligation row ────────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  payroll: '#185FA5',
  tax: '#E24B4A',
  invoice: '#EF9F27',
  subscription: '#534AB7',
  other: '#B4B2A9',
}

function ObligationRow({ ob }: { ob: CashFlowForecast['obligations'][0] }) {
  const urgent = ob.daysUntilDue <= 7
  const dot = CAT_COLORS[ob.category] ?? '#B4B2A9'
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-gray-50 last:border-0">
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{ob.label}</div>
        <div className={`text-xs ${urgent ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
          {ob.dueDate} {urgent && `· ${ob.daysUntilDue}d left`}
        </div>
      </div>
      <span className="text-sm font-medium flex-shrink-0">
        −<Amount value={ob.amount} />
      </span>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function CashFlowPage() {
  const [range, setRange] = useState<Range>('30d')
  const [viewMode, setViewMode] = useState<ViewMode>('chart')

  const { data: forecast, isLoading } = useQuery<CashFlowForecast>(
    `cashflow/${range}`,
    () => cashFlowApi.getForecast({ range })
  )

  const RANGES: { label: string; value: Range }[] = [
    { label: '7 days', value: '7d' },
    { label: '30 days', value: '30d' },
    { label: '90 days', value: '90d' },
    { label: '180 days', value: '180d' },
  ]

  return (
    <AppShell
      title="Cash Flow"
      subtitle="30-day forecast and runway analysis"
    >
      {/* Range filters */}
      <div className="filter-row mb-4">
        {RANGES.map((r) => (
          <button
            key={r.value}
            className={`fchip${range === r.value ? ' on' : ''}`}
            onClick={() => setRange(r.value)}
          >
            {r.label}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button className={`hdr-action${viewMode === 'chart' ? ' active' : ''}`} onClick={() => setViewMode('chart')}>📊 Chart</button>
          <button className={`hdr-action${viewMode === 'table' ? ' active' : ''}`} onClick={() => setViewMode('table')}>☰ Table</button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !forecast ? null : (
        <>
          {/* KPI strip */}
          <div className="krow k4 mb-4">
            <Card kpi
              label="Current balance"
              value={<Amount value={forecast.currentBalance} />}
              valueColor="green"
              sub="Estimated · 2 accounts"
            />
            <Card kpi
              label={`Projected (${range})`}
              value={<Amount value={forecast.projectedBalance} />}
              valueColor={forecast.projectedBalance >= forecast.currentBalance ? 'green' : 'red'}
              sub={`${forecast.projectedBalance >= forecast.currentBalance ? '+' : ''}${((forecast.projectedBalance - forecast.currentBalance) / Math.max(forecast.currentBalance, 1) * 100).toFixed(1)}%`}
            />
            <Card kpi
              label="Burn rate"
              value={<><Amount value={forecast.burnRateMonthly} />/mo</>}
              sub="3-month average"
            />
            <Card kpi
              label="Runway"
              value={`${forecast.runwayMonths} months`}
              valueColor={forecast.runwayMonths >= 12 ? 'green' : forecast.runwayMonths >= 6 ? 'amber' : 'red'}
              sub="At current burn rate"
            />
          </div>

          {viewMode === 'chart' ? (
            <>
              <div className="g2 mb-4">
                {/* Bar chart */}
                <Card>
                  <div className="panel-hdr mb-3">
                    <span className="panel-title">Inflow vs outflow — 6 months</span>
                    <div className="flex gap-3">
                      {[['#185FA5', 'Inflow'], ['#D3D1C7', 'Outflow']].map(([color, label]) => (
                        <span key={label} className="text-xs text-gray-400 flex items-center gap-1">
                          <span className="w-2.5 h-1.5 rounded-sm inline-block" style={{ background: color }} />
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                  {forecast.monthlyHistory.length > 0 ? (
                    <BarChart data={forecast.monthlyHistory} />
                  ) : (
                    <div className="text-center text-xs text-gray-300 py-8">No historical data</div>
                  )}
                </Card>

                {/* 30-day forecast box */}
                <Card>
                  <div className="panel-title mb-3">Next 30 days forecast</div>
                  <div className="flex gap-2 mb-3">
                    <div className="flex-1 p-3 bg-green-50 rounded-lg">
                      <div className="text-xs text-green-800 mb-1">Expected inflow</div>
                      <div className="text-base font-semibold text-green-700">
                        <Amount value={forecast.expectedInflow30d} />
                      </div>
                    </div>
                    <div className="flex-1 p-3 bg-red-50 rounded-lg">
                      <div className="text-xs text-red-800 mb-1">Expected outflow</div>
                      <div className="text-base font-semibold text-red-700">
                        −<Amount value={forecast.expectedOutflow30d} />
                      </div>
                    </div>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden flex gap-px mb-1.5">
                    <div
                      className="bg-green-700 rounded-l-full"
                      style={{ width: `${Math.min(100, Math.round(forecast.inflowCoverageRatio * 100))}%` }}
                    />
                    <div className="flex-1 bg-gray-200 rounded-r-full" />
                  </div>
                  <div className="text-xs text-gray-400">
                    Inflow covers {Math.round(forecast.inflowCoverageRatio * 100)}% of projected outflow
                  </div>
                </Card>
              </div>

              {/* Obligations & Inflows */}
              <div className="g2">
                <Card>
                  <div className="panel-title mb-2">Upcoming obligations</div>
                  {forecast.obligations.length === 0 ? (
                    <div className="text-xs text-gray-300 py-4 text-center">No upcoming obligations</div>
                  ) : (
                    forecast.obligations.map((ob) => <ObligationRow key={ob.id} ob={ob} />)
                  )}
                </Card>
                <Card>
                  <div className="panel-title mb-2">Expected inflows</div>
                  {forecast.expectedInflows.length === 0 ? (
                    <div className="text-xs text-gray-300 py-4 text-center">No expected inflows</div>
                  ) : (
                    forecast.expectedInflows.map((inf) => (
                      <div key={inf.id} className="flex items-center gap-2.5 py-2 border-b border-gray-50 last:border-0">
                        <div className="w-2 h-2 rounded-full bg-green-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{inf.label}</div>
                          <div className="text-xs text-gray-400 flex items-center gap-1.5">
                            {inf.expectedDate}
                            <span className={`px-1 rounded text-[9px] font-medium ${
                              inf.confidence === 'HIGH' ? 'bg-green-100 text-green-700' :
                              inf.confidence === 'MEDIUM' ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-500'
                            }`}>{inf.confidence}</span>
                          </div>
                        </div>
                        <span className="text-sm font-medium text-green-700 flex-shrink-0">
                          +<Amount value={inf.amount} />
                        </span>
                      </div>
                    ))
                  )}
                </Card>
              </div>
            </>
          ) : (
            /* ── TABLE VIEW ── */
            <Card className="p-0">
              <table className="tbl w-full">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Opening balance</th>
                    <th>Inflows</th>
                    <th>Outflows</th>
                    <th>Closing balance</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {(forecast.dailyForecast ?? []).map((day) => {
                    const delta = day.closingBalance - day.openingBalance
                    return (
                      <tr key={day.date}>
                        <td className="font-medium">{day.date}</td>
                        <td><Amount value={day.openingBalance} /></td>
                        <td className="text-green-600">+<Amount value={day.inflows} /></td>
                        <td className="text-red-500">−<Amount value={day.outflows} /></td>
                        <td className="font-medium"><Amount value={day.closingBalance} /></td>
                        <td className={delta >= 0 ? 'text-green-600' : 'text-red-500'}>
                          {delta >= 0 ? '+' : ''}<Amount value={delta} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </AppShell>
  )
}

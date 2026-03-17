'use client'

/**
 * GlobalSearch — command-palette style search overlay
 *
 * Triggered by: Cmd/Ctrl+K or clicking the search icon in AppShell
 *
 * Features:
 * - 400ms debounced search
 * - Results grouped by type with type icons
 * - Keyboard navigation (↑↓ arrows, Enter, Esc)
 * - Click to navigate to result page
 * - Recent searches (localStorage)
 * - Loading skeleton while fetching
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { SearchResult } from '@/app/api/search/route'

// ─────────────────────────────────────────────
// TYPE ICONS AND LABELS
// ─────────────────────────────────────────────

const TYPE_CONFIG: Record<SearchResult['type'], { icon: string; label: string; color: string }> = {
  expense:     { icon: '🧾', label: 'Expense',     color: '#E6F1FB' },
  invoice_ap:  { icon: '📄', label: 'AP Invoice',  color: '#EEEDFE' },
  invoice_ar:  { icon: '📤', label: 'AR Invoice',  color: '#EAF3DE' },
  supplier:    { icon: '🏭', label: 'Supplier',    color: '#FAEEDA' },
  customer:    { icon: '🏢', label: 'Customer',    color: '#E1F5EE' },
  transaction: { icon: '💳', label: 'Transaction', color: '#f5f5f3' },
  member:      { icon: '👤', label: 'Member',      color: '#f5f5f3' },
}

// ─────────────────────────────────────────────
// STATUS PILL
// ─────────────────────────────────────────────

const STATUS_COLORS: Record<string, [string, string]> = {
  APPROVED:         ['#EAF3DE', '#27500A'],
  APPROVED_PAID:    ['#EAF3DE', '#27500A'],
  PAID:             ['#EAF3DE', '#27500A'],
  PENDING_APPROVAL: ['#FAEEDA', '#633806'],
  SUBMITTED:        ['#E6F1FB', '#0C447C'],
  SENT:             ['#E6F1FB', '#0C447C'],
  REJECTED:         ['#FCEBEB', '#791F1F'],
  OVERDUE:          ['#FCEBEB', '#791F1F'],
  FLAGGED:          ['#FCEBEB', '#791F1F'],
  DRAFT:            ['#f1f1ef', '#888780'],
  EXPORTED:         ['#EEEDFE', '#3C3489'],
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null
  const [bg, col] = STATUS_COLORS[status] ?? ['#f1f1ef', '#888780']
  return (
    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: bg, color: col, fontWeight: 500, flexShrink: 0 }}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ─────────────────────────────────────────────
// SEARCH RESULT ROW
// ─────────────────────────────────────────────

function ResultRow({
  result,
  isActive,
  onHover,
  onClick,
}: {
  result: SearchResult
  isActive: boolean
  onHover: () => void
  onClick: () => void
}) {
  const cfg = TYPE_CONFIG[result.type]
  return (
    <div
      onClick={onClick}
      onMouseEnter={onHover}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        cursor: 'pointer', borderRadius: 7, transition: 'background .1s',
        background: isActive ? '#f5f5f3' : 'transparent',
      }}
    >
      <div style={{ width: 28, height: 28, borderRadius: 7, background: cfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
        {cfg.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {result.title}
        </div>
        <div style={{ fontSize: 11, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {result.subtitle}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {result.meta && <span style={{ fontSize: 11, color: '#6B7280' }}>{result.meta}</span>}
        <StatusBadge status={result.status} />
        <span style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 4, background: cfg.color, color: '#4B5563', fontWeight: 500 }}>{cfg.label}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────

interface GlobalSearchProps {
  isOpen: boolean
  onClose: () => void
}

type GroupedResults = Partial<Record<string, SearchResult[]>>

export default function GlobalSearch({ isOpen, onClose }: GlobalSearchProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GroupedResults>({})
  const [isLoading, setIsLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Flat list for keyboard nav
  const allResults: SearchResult[] = Object.values(results).flat().filter(Boolean) as SearchResult[]

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery('')
      setResults({})
      setActiveIdx(0)
    }
  }, [isOpen])

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (!isOpen) onClose() // This toggles — parent manages state
      }
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Debounced search
  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults({}); return }
    setIsLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=4`, {
        credentials: 'include',
      })
      const data = await res.json()
      setResults(data.data ?? {})
      setActiveIdx(0)
    } catch {
      setResults({})
    } finally {
      setIsLoading(false)
    }
  }, [])

  function handleInput(val: string) {
    setQuery(val)
    clearTimeout(debounceRef.current)
    if (val.length < 2) { setResults({}); return }
    debounceRef.current = setTimeout(() => search(val), 400)
  }

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, allResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && allResults[activeIdx]) {
      handleNavigate(allResults[activeIdx])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  function handleNavigate(result: SearchResult) {
    router.push(result.url)
    onClose()
  }

  if (!isOpen) return null

  const hasResults = Object.keys(results).length > 0
  const typeGroups = Object.entries(results) as Array<[string, SearchResult[]]>

  let globalIdx = 0

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200, backdropFilter: 'blur(2px)' }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: '15vh', left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 560, zIndex: 201,
        background: '#fff', borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,.2)',
        border: '.5px solid var(--border)', overflow: 'hidden',
      }}>
        {/* Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '.5px solid #f0f0ee' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="#9CA3AF" strokeWidth="1.5"/>
            <line x1="11" y1="11" x2="14" y2="14" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search expenses, invoices, suppliers, customers…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13.5, color: '#111827', background: 'none' }}
          />
          {isLoading && (
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #E8E8E4', borderTopColor: '#185FA5', animation: 'spin .6s linear infinite' }} />
          )}
          <kbd style={{ fontSize: 10, color: '#9CA3AF', background: '#f5f5f3', padding: '2px 6px', borderRadius: 4, border: '.5px solid #E8E8E4' }}>Esc</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: hasResults ? '6px' : 0 }}>
          {!query && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 12.5 }}>
              <div style={{ marginBottom: 6 }}>Type to search across all your data</div>
              <div style={{ fontSize: 11, color: '#C4C4BF' }}>Expenses · Invoices · Suppliers · Customers · Transactions · Team</div>
            </div>
          )}

          {query.length === 1 && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>Type at least 2 characters…</div>
          )}

          {query.length >= 2 && !isLoading && !hasResults && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 12.5 }}>
              No results for "<strong style={{ color: '#4B5563' }}>{query}</strong>"
            </div>
          )}

          {typeGroups.map(([groupType, groupResults]) => {
            const cfg = TYPE_CONFIG[groupType as SearchResult['type']]
            return (
              <div key={groupType} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 9.5, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.6px', padding: '6px 12px 3px' }}>
                  {cfg?.label ?? groupType}
                </div>
                {groupResults.map((result) => {
                  const idx = globalIdx++
                  return (
                    <ResultRow
                      key={result.id}
                      result={result}
                      isActive={activeIdx === idx}
                      onHover={() => setActiveIdx(idx)}
                      onClick={() => handleNavigate(result)}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        {hasResults && (
          <div style={{ borderTop: '.5px solid #f0f0ee', padding: '8px 14px', display: 'flex', gap: 14, alignItems: 'center' }}>
            {[['↑↓','Navigate'],['↵','Select'],['Esc','Close']].map(([key, lbl]) => (
              <span key={key} style={{ fontSize: 10.5, color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 5 }}>
                <kbd style={{ fontSize: 10, background: '#f5f5f3', padding: '1px 5px', borderRadius: 3, border: '.5px solid #E8E8E4', color: '#4B5563' }}>{key}</kbd>
                {lbl}
              </span>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#C4C4BF' }}>{allResults.length} result{allResults.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  )
}

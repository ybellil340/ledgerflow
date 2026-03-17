/// <reference lib="webworker" />

/**
 * LedgerFlow Service Worker
 * 
 * Caching strategy:
 *   - App shell (HTML/JS/CSS)  → Cache First, fallback to network
 *   - API requests             → Network First, fallback to cache (stale)
 *   - Static assets (images)   → Cache First, long TTL
 * 
 * Background sync:
 *   - Queued expense submissions are retried when connectivity resumes
 */

declare const self: ServiceWorkerGlobalScope

const CACHE_VERSION = 'ledgerflow-v1'
const STATIC_CACHE = `${CACHE_VERSION}-static`
const API_CACHE    = `${CACHE_VERSION}-api`

const PRECACHE_URLS = [
  '/',
  '/dashboard',
  '/offline',
  // Core JS/CSS bundles are added at build time via next-pwa or workbox
]

// ─── Install ───────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

// ─── Activate — clean old caches ──────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('ledgerflow-') && !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

// ─── Fetch — routing strategies ───────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET, cross-origin, and chrome-extension requests
  if (
    request.method !== 'GET' ||
    !url.origin.includes(self.location.origin) ||
    url.protocol === 'chrome-extension:'
  ) {
    return
  }

  // API routes — Network First
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request))
    return
  }

  // Static assets (images, fonts) — Cache First
  if (
    url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf)$/)
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // HTML pages — Network First with offline fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      networkFirst(request).catch(() =>
        caches.match('/offline') ?? new Response('Offline', { status: 503 })
      )
    )
    return
  }

  // JS/CSS — Cache First (versioned by Next.js build hash)
  event.respondWith(cacheFirst(request, STATIC_CACHE))
})

// ─── Strategies ───────────────────────────────────────────────────────────────

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request)
    if (response.ok && request.url.startsWith('/api/')) {
      const cache = await caches.open(API_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    throw new Error('Network error and no cache available')
  }
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(cacheName)
    cache.put(request, response.clone())
  }
  return response
}

// ─── Background sync — queued expense submissions ─────────────────────────────

const SYNC_TAG = 'ledgerflow-expense-queue'

self.addEventListener('sync', (event: any) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(processExpenseQueue())
  }
})

async function processExpenseQueue(): Promise<void> {
  // Read queued items from IndexedDB
  // In production, use idb or a simple IndexedDB wrapper:
  //
  // const queue = await db.getAll('expense-queue')
  // for (const item of queue) {
  //   try {
  //     await fetch('/api/expenses', { method: 'POST', body: JSON.stringify(item) })
  //     await db.delete('expense-queue', item.id)
  //   } catch {
  //     // Will retry on next sync
  //   }
  // }
  console.log('[SW] Processing expense queue...')
}

// ─── Push notifications ────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return

  let data: { title: string; body: string; url?: string; icon?: string; badge?: string } = {
    title: 'LedgerFlow',
    body: 'You have a new notification',
  }

  try {
    data = event.data.json()
  } catch {
    data.body = event.data.text()
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon ?? '/icons/icon-192x192.png',
      badge: data.badge ?? '/icons/badge-72x72.png',
      tag: 'ledgerflow-notification',
      data: { url: data.url ?? '/notifications' },
      actions: [
        { action: 'open', title: 'Open' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'dismiss') return

  const url = (event.notification.data as any)?.url ?? '/dashboard'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin))
      if (existing) {
        existing.focus()
        existing.navigate(url)
      } else {
        self.clients.openWindow(url)
      }
    })
  )
})

export {}

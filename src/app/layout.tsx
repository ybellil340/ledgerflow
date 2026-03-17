/**
 * Root layout — loads session on the server for zero-flash auth
 * src/app/layout.tsx
 */

import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/session'
import { Providers } from '@/components/providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'LedgerFlow — Financial OS for German SMEs',
  description: 'Expenses, corporate cards, invoicing, DATEV-ready accounting, and tax advisor collaboration.',
  robots: { index: false, follow: false }, // SaaS app — no SEO
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Server-side session to prevent flash of unauthenticated state
  let initialUser = null
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('ledgerflow_session')?.value
    if (token) {
      const payload = await verifyToken(token)
      initialUser = payload
    }
  } catch {
    // Cookie invalid or expired — let client handle redirect
  }

  return (
    <html lang="de">
      <body style={{ margin: 0, padding: 0, background: '#F5F5F3' }}>
        <Providers initialUser={initialUser}>
          {children}
        </Providers>
      </body>
    </html>
  )
}

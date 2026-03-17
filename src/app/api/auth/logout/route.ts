export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'ledgerflow_session'

export async function POST(req: NextRequest) {
  const response = NextResponse.json({ success: true })
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}

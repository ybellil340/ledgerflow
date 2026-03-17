export const dynamic = 'force-dynamic'

/**
 * POST /api/import           — parse CSV/XLSX, return preview
 * POST /api/import/confirm   — execute confirmed import
 * GET  /api/import/template  — download CSV template
 * GET  /api/import/history   — list past import jobs
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/session'
import { assertPermission } from '@/lib/auth/rbac'
import {
  buildImportPreview, executeImport, generateCSVTemplate,
  type ImportType, type ColumnMapping
} from '@/lib/services/csv-import'
import { prisma } from '@/lib/db/prisma'
import type { SessionUser } from '@/types'

const ALLOWED_TYPES: ImportType[] = ['expenses', 'transactions', 'suppliers', 'customers', 'ap_invoices']
const MAX_FILE_SIZE_MB = 10

// ─────────────────────────────────────────────
// POST /api/import — preview
// ─────────────────────────────────────────────

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  assertPermission(session, 'create:expenses') // Finance Manager+

  const contentType = req.headers.get('content-type') ?? ''

  let csvContent: string
  let importType: ImportType
  let customMapping: ColumnMapping | undefined

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    importType = (formData.get('importType') as ImportType) ?? 'expenses'
    const mappingStr = formData.get('mapping') as string | null
    if (mappingStr) customMapping = JSON.parse(mappingStr)

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return NextResponse.json({ error: `File too large (max ${MAX_FILE_SIZE_MB}MB)` }, { status: 413 })
    }

    csvContent = await file.text()
  } else {
    const body = await req.json()
    csvContent = body.content
    importType = body.importType ?? 'expenses'
    customMapping = body.mapping
  }

  if (!ALLOWED_TYPES.includes(importType)) {
    return NextResponse.json({ error: `Invalid importType. Must be one of: ${ALLOWED_TYPES.join(', ')}` }, { status: 400 })
  }

  if (!csvContent?.trim()) {
    return NextResponse.json({ error: 'Empty file content' }, { status: 400 })
  }

  try {
    const preview = buildImportPreview(csvContent, importType, customMapping)
    return NextResponse.json({ data: preview })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Parse error'
    return NextResponse.json({ error: `Failed to parse file: ${msg}` }, { status: 400 })
  }
})

// ─────────────────────────────────────────────
// POST /api/import/confirm — execute
// ─────────────────────────────────────────────

export async function CONFIRM(req: NextRequest, session: SessionUser) {
  assertPermission(session, 'create:expenses')

  const body = await req.json()
  const { content, importType, mapping, skipErrors = false } = body as {
    content: string
    importType: ImportType
    mapping: ColumnMapping
    skipErrors?: boolean
  }

  if (!content || !importType || !mapping) {
    return NextResponse.json({ error: 'content, importType, and mapping are required' }, { status: 400 })
  }

  const result = await executeImport(
    content,
    importType,
    session.currentOrganizationId,
    mapping,
    { skipErrors, defaultUserId: session.id }
  )

  return NextResponse.json({ data: result })
}

// ─────────────────────────────────────────────
// GET /api/import?action=template&type=expenses
// ─────────────────────────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const type = (searchParams.get('type') ?? 'expenses') as ImportType

  if (action === 'template') {
    if (!ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const csv = generateCSVTemplate(type)
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ledgerflow-import-template-${type}.csv"`,
      },
    })
  }

  if (action === 'history') {
    const logs = await prisma.auditLog.findMany({
      where: {
        organizationId: session.currentOrganizationId,
        action: 'BULK_IMPORT',
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    return NextResponse.json({
      data: logs.map(l => ({
        id: l.id,
        importType: (l.metadata as Record<string, unknown>)?.importType,
        imported: (l.metadata as Record<string, unknown>)?.imported,
        errors: (l.metadata as Record<string, unknown>)?.errors,
        total: (l.metadata as Record<string, unknown>)?.totalProcessed,
        at: l.createdAt,
      })),
    })
  }

  return NextResponse.json({ error: 'Specify ?action=template or ?action=history' }, { status: 400 })
})

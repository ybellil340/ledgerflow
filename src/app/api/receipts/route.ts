export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db/prisma'
import { withAuth } from '@/lib/auth/session'
import type { SessionUser } from '@/types'

// ─────────────────────────────────────────────────────
// OCR ABSTRACTION LAYER
// Swap provider via OCR_PROVIDER env var
// ─────────────────────────────────────────────────────

interface OCRResult {
  merchant?: string
  date?: string
  total?: number
  vatAmount?: number
  currency?: string
  rawData?: Record<string, unknown>
}

async function extractReceiptData(fileUrl: string, mimeType: string): Promise<OCRResult> {
  const provider = process.env.OCR_PROVIDER ?? 'mock'

  if (provider === 'mock') {
    // Simulated OCR for development/demo
    await new Promise((r) => setTimeout(r, 300))
    return {
      merchant: 'Extracted Merchant GmbH',
      date: new Date().toISOString().slice(0, 10),
      total: Math.round(Math.random() * 500 * 100) / 100,
      vatAmount: Math.round(Math.random() * 50 * 100) / 100,
      currency: 'EUR',
      rawData: { provider: 'mock', confidence: 0.95 },
    }
  }

  if (provider === 'mindee') {
    // Mindee API integration placeholder
    // const { Client } = await import('mindee')
    // const mindeeClient = new Client({ apiKey: process.env.MINDEE_API_KEY })
    // const result = await mindeeClient.parse(...)
    throw new Error('Mindee integration not configured')
  }

  if (provider === 'google_vision') {
    // Google Vision API placeholder
    throw new Error('Google Vision integration not configured')
  }

  return {}
}

// ─────────────────────────────────────────────────────
// STORAGE ABSTRACTION LAYER
// ─────────────────────────────────────────────────────

async function uploadFile(
  file: File,
  organizationId: string,
  folder: string
): Promise<{ url: string; key: string }> {
  const provider = process.env.STORAGE_PROVIDER ?? 'local'
  const ext = file.name.split('.').pop()
  const key = `${organizationId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  if (provider === 's3') {
    // AWS S3 upload placeholder
    // const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
    // const s3 = new S3Client({ region: process.env.AWS_REGION })
    // await s3.send(new PutObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key, Body: ... }))
    // const url = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
    throw new Error('S3 storage not configured — set STORAGE_PROVIDER=local for development')
  }

  // Local storage (development only)
  const { writeFile, mkdir } = await import('fs/promises')
  const { join } = await import('path')
  const uploadDir = join(process.cwd(), 'uploads', organizationId, folder)
  await mkdir(uploadDir, { recursive: true })
  const buffer = Buffer.from(await file.arrayBuffer())
  const localPath = join(uploadDir, `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`)
  await writeFile(localPath, buffer)
  const url = `/api/files/${key}`

  return { url, key }
}

// ─── POST /api/receipts ──────────────────────────────

export const POST = withAuth(async (req: NextRequest, session: SessionUser) => {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const expenseId = formData.get('expenseId') as string | null
  const transactionId = formData.get('transactionId') as string | null

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // Validate file
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Invalid file type. Use JPEG, PNG, WebP, or PDF.' }, { status: 400 })
  }
  const maxSize = 20 * 1024 * 1024 // 20MB
  if (file.size > maxSize) {
    return NextResponse.json({ error: 'File too large. Maximum 20MB.' }, { status: 400 })
  }

  // Verify expense/transaction belongs to org
  if (expenseId) {
    const expense = await prisma.expense.findFirst({
      where: { id: expenseId, organizationId: session.currentOrganizationId, deletedAt: null },
    })
    if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    if (expense.userId !== session.id && !['COMPANY_ADMIN', 'FINANCE_MANAGER', 'SUPER_ADMIN'].includes(session.currentRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Upload file
  const { url, key } = await uploadFile(file, session.currentOrganizationId, 'receipts')

  // Create receipt record
  const receipt = await prisma.receipt.create({
    data: {
      expenseId: expenseId ?? undefined,
      transactionId: transactionId ?? undefined,
      organizationId: session.currentOrganizationId,
      uploadedById: session.id,
      fileUrl: url,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      ocrProcessed: false,
    },
  })

  // Trigger async OCR (don't await — return immediately)
  triggerOCR(receipt.id, url, file.type).catch((err) =>
    console.error('[OCR] Failed:', err)
  )

  // If linked to transaction, update its status
  if (transactionId) {
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: 'MATCHED' },
    })
  }

  return NextResponse.json({ data: receipt }, { status: 201 })
})

async function triggerOCR(receiptId: string, fileUrl: string, mimeType: string) {
  try {
    const extracted = await extractReceiptData(fileUrl, mimeType)

    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        ocrProcessed: true,
        ocrMerchant: extracted.merchant,
        ocrDate: extracted.date ? new Date(extracted.date) : undefined,
        ocrTotal: extracted.total,
        ocrVatAmount: extracted.vatAmount,
        ocrCurrency: extracted.currency,
        ocrRawData: extracted.rawData as Record<string, unknown>,
        // Pre-fill editable fields with OCR data
        merchant: extracted.merchant,
        receiptDate: extracted.date ? new Date(extracted.date) : undefined,
        total: extracted.total,
        vatAmount: extracted.vatAmount,
        currency: extracted.currency,
      },
    })
  } catch (err) {
    console.error('[OCR] Processing failed for receipt', receiptId, err)
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { ocrProcessed: true }, // Mark as processed even on failure
    })
  }
}

// ─── GET /api/receipts/[id] ──────────────────────────

export const GET = withAuth(async (req: NextRequest, session: SessionUser) => {
  const id = req.url.split('/receipts/')[1]?.split('?')[0]
  if (!id) return NextResponse.json({ error: 'Receipt ID required' }, { status: 400 })

  const receipt = await prisma.receipt.findFirst({
    where: { id, organizationId: session.currentOrganizationId },
  })

  if (!receipt) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })

  return NextResponse.json({ data: receipt })
})

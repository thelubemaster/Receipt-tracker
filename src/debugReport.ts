import type { AiId } from './aiRoster'
import type { CategoryId, ReceiptLineItem } from './types'
import { APP_VERSION } from './version'

export type DebugReportPayload = {
  id: string
  createdAt: string
  appVersion: string
  userNote: string
  /** What the AI team produced */
  suggestion: {
    date: string | null
    vendor: string
    amount: number | null
    description: string
    categoryId: CategoryId
    notes: string
    lineItems: ReceiptLineItem[]
    subtotal?: number | null
    tax?: number | null
    agentReport?: string
    aisUsed?: AiId[]
    activeAiLabel?: string
    confidence?: number
    rawText?: string
    source?: string
  }
  /** What the user was looking at / edited on the form */
  formSnapshot?: {
    date: string
    vendor: string
    amount: string
    description: string
    categoryId: CategoryId
    notes: string
    lineItems: ReceiptLineItem[]
  }
  /** data:image/...;base64,... */
  receiptDataUrl: string
  receiptMime: string
}

export function newReportId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${stamp}_${rand}`
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

export function downloadDebugReport(report: DebugReportPayload): void {
  const json = JSON.stringify(
    {
      ...report,
      // keep image in file so it can be re-uploaded to chat
      receiptDataUrl: report.receiptDataUrl,
    },
    null,
    2,
  )
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `schoolie-debug-${report.id}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export type SubmitDebugResult =
  | { ok: true; mode: 'server'; id: string; path: string }
  | { ok: true; mode: 'download'; id: string }
  | { ok: false; error: string }

/**
 * Try to POST to the app host (dev/preview with debug middleware).
 * Always falls back to downloading a JSON bundle you can share.
 */
export async function submitDebugReport(
  report: DebugReportPayload,
  options?: { preferDownloadOnly?: boolean },
): Promise<SubmitDebugResult> {
  if (!options?.preferDownloadOnly) {
    try {
      const res = await fetch('/api/debug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      })
      if (res.ok) {
        const data = (await res.json()) as { id?: string; path?: string }
        return {
          ok: true,
          mode: 'server',
          id: data.id ?? report.id,
          path: data.path ?? `debug-scans/${report.id}`,
        }
      }
    } catch {
      /* fall through to download */
    }
  }

  downloadDebugReport(report)
  return { ok: true, mode: 'download', id: report.id }
}

export type RemoteDebugSummary = {
  id: string
  createdAt: string
  userNote: string
  amount: number | null
  vendor: string
  aisUsed: string[]
  hasReceipt: boolean
  appVersion: string
}

export async function listRemoteDebugReports(): Promise<RemoteDebugSummary[]> {
  try {
    const res = await fetch('/api/debug-reports', { cache: 'no-store' })
    if (!res.ok) return []
    const data = (await res.json()) as { reports?: RemoteDebugSummary[] }
    return data.reports ?? []
  } catch {
    return []
  }
}

export function buildReportShell(input: {
  suggestion: DebugReportPayload['suggestion']
  formSnapshot?: DebugReportPayload['formSnapshot']
  userNote: string
  receiptDataUrl: string
  receiptMime: string
}): DebugReportPayload {
  return {
    id: newReportId(),
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    userNote: input.userNote.trim() || '(no note)',
    suggestion: input.suggestion,
    formSnapshot: input.formSnapshot,
    receiptDataUrl: input.receiptDataUrl,
    receiptMime: input.receiptMime || 'image/jpeg',
  }
}

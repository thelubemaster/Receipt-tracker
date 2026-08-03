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

export type ScanDebugTextInput = {
  userNote?: string
  suggestion: {
    date?: string | null
    vendor?: string
    amount?: number | null
    description?: string
    categoryId?: CategoryId
    notes?: string
    lineItems?: ReceiptLineItem[]
    subtotal?: number | null
    tax?: number | null
    agentReport?: string
    aisUsed?: AiId[]
    activeAiLabel?: string
    confidence?: number
    rawText?: string
    source?: string
    fieldSources?: {
      primary?: AiId
      ocr?: AiId
      total?: AiId
      vendor?: AiId
      category?: AiId
      date?: AiId
      answerLabel?: string
    }
  }
  /** What the user currently sees / edited on the form */
  form?: {
    date?: string
    vendor?: string
    amount?: string
    description?: string
    categoryId?: CategoryId
    notes?: string
    lineItems?: ReceiptLineItem[]
  }
}

/**
 * Plain-text dump for pasting into chat with the coding agent.
 * No image bytes — just what the scan did and what it decided.
 */
export function formatScanDebugText(input: ScanDebugTextInput): string {
  const s = input.suggestion
  const f = input.form
  const lines: string[] = []
  const money = (n: number | null | undefined) =>
    n == null || Number.isNaN(n) ? '—' : `$${Number(n).toFixed(2)}`

  lines.push('=== SCHOOLIE SCAN DEBUG (paste into chat) ===')
  lines.push(`App version: ${APP_VERSION}`)
  lines.push(`When: ${new Date().toISOString()}`)
  if (input.userNote?.trim()) lines.push(`User note: ${input.userNote.trim()}`)
  lines.push('')

  lines.push('--- AI ANSWER (what the scan produced) ---')
  lines.push(`Active label: ${s.activeAiLabel || '—'}`)
  lines.push(`Source: ${s.source || '—'}`)
  lines.push(
    `Confidence: ${s.confidence != null ? `${Math.round(s.confidence * 100)}%` : '—'}`,
  )
  lines.push(`Vendor: ${s.vendor || '—'}`)
  lines.push(`Date: ${s.date || '—'}`)
  lines.push(`Total: ${money(s.amount ?? null)}`)
  lines.push(`Subtotal: ${money(s.subtotal ?? null)}`)
  lines.push(`Tax: ${money(s.tax ?? null)}`)
  lines.push(`Category: ${s.categoryId || '—'}`)
  lines.push(`Description: ${s.description || '—'}`)
  lines.push(`Notes: ${s.notes || '—'}`)
  if (s.fieldSources) {
    const fs = s.fieldSources
    lines.push(
      `Field sources: primary=${fs.primary || '—'} ocr=${fs.ocr || '—'} total=${fs.total || '—'} vendor=${fs.vendor || '—'} category=${fs.category || '—'} date=${fs.date || '—'}`,
    )
    if (fs.answerLabel) lines.push(`Answer label: ${fs.answerLabel}`)
  }
  lines.push(
    `AIs that actually ran (${s.aisUsed?.length ?? 0}): ${(s.aisUsed || []).join(', ') || '—'}`,
  )
  lines.push('')
  lines.push('--- LINE ITEMS (AI) ---')
  if (s.lineItems?.length) {
    for (const li of s.lineItems) {
      lines.push(
        `  • ${li.description || '(no name)'} | ${money(li.amount)} | cat=${li.categoryId}`,
      )
    }
  } else {
    lines.push('  (none)')
  }

  if (f) {
    lines.push('')
    lines.push('--- FORM ON SCREEN (what user sees / edited) ---')
    lines.push(`Vendor: ${f.vendor || '—'}`)
    lines.push(`Date: ${f.date || '—'}`)
    lines.push(`Total: ${f.amount || '—'}`)
    lines.push(`Category: ${f.categoryId || '—'}`)
    lines.push(`Description: ${f.description || '—'}`)
    lines.push(`Notes: ${f.notes || '—'}`)
    lines.push('--- LINE ITEMS (FORM) ---')
    if (f.lineItems?.length) {
      for (const li of f.lineItems) {
        lines.push(
          `  • ${li.description || '(no name)'} | ${money(li.amount)} | cat=${li.categoryId}`,
        )
      }
    } else {
      lines.push('  (none)')
    }
  }

  lines.push('')
  lines.push('--- RAW OCR / VISION TEXT ---')
  lines.push((s.rawText || '').trim() || '(empty — OCR produced no text)')
  lines.push('')
  lines.push('--- FULL AGENT REPORT ---')
  lines.push((s.agentReport || '').trim() || '(no agent report)')
  lines.push('')
  lines.push('=== END SCAN DEBUG ===')
  return lines.join('\n')
}

export type ProjectPurchaseDebugRow = {
  id: string
  date: string
  vendor: string
  amount: number
  description: string
  categoryId: string
  notes: string
  lineItems: ReceiptLineItem[]
  aisUsed?: AiId[]
  scanDebug?: {
    capturedAt?: string
    appVersion?: string
    activeAiLabel?: string
    source?: string
    confidence?: number
    rawText?: string
    agentReport?: string
    aisUsed?: AiId[]
    subtotal?: number | null
    tax?: number | null
    fieldSources?: ScanDebugTextInput['suggestion']['fieldSources']
    aiAnswer?: {
      date?: string | null
      vendor?: string
      amount?: number | null
      description?: string
      categoryId?: string
      notes?: string
      lineItems?: ReceiptLineItem[]
    }
  } | null
}

/**
 * Full project dump: every saved receipt + OCR/agent data when available.
 * Paste into chat so the coding agent can see systematic AI mistakes.
 */
export function formatProjectDebugText(input: {
  projectName: string
  projectId: string
  purchases: ProjectPurchaseDebugRow[]
}): string {
  const money = (n: number | null | undefined) =>
    n == null || Number.isNaN(n) ? '—' : `$${Number(n).toFixed(2)}`
  const lines: string[] = []
  lines.push('=== SCHOOLIE PROJECT DATA (paste into chat) ===')
  lines.push(`App version: ${APP_VERSION}`)
  lines.push(`When: ${new Date().toISOString()}`)
  lines.push(`Project: ${input.projectName}`)
  lines.push(`Project id: ${input.projectId}`)
  lines.push(`Receipts: ${input.purchases.length}`)
  lines.push('')

  const withDump = input.purchases.filter((p) => p.scanDebug?.rawText || p.scanDebug?.agentReport)
  lines.push(
    `Scan dumps saved: ${withDump.length}/${input.purchases.length} (older receipts may lack OCR — re-scan to capture)`,
  )
  lines.push('')

  input.purchases.forEach((p, idx) => {
    lines.push(`######## RECEIPT ${idx + 1}/${input.purchases.length} · id ${p.id} ########`)
    lines.push('--- SAVED (what is in the project) ---')
    lines.push(`Date: ${p.date || '—'}`)
    lines.push(`Vendor: ${p.vendor || '—'}`)
    lines.push(`Total: ${money(p.amount)}`)
    lines.push(`Category: ${p.categoryId || '—'}`)
    lines.push(`Description: ${p.description || '—'}`)
    lines.push(`Notes: ${p.notes || '—'}`)
    lines.push('Line items:')
    if (p.lineItems?.length) {
      for (const li of p.lineItems) {
        lines.push(
          `  • ${li.description || '(no name)'} | ${money(li.amount)} | cat=${li.categoryId}`,
        )
      }
    } else {
      lines.push('  (none)')
    }

    const sd = p.scanDebug
    if (sd) {
      lines.push('')
      lines.push('--- AI SCAN DUMP (what free AIs produced) ---')
      lines.push(`Captured: ${sd.capturedAt || '—'}`)
      lines.push(`Scan app version: ${sd.appVersion || '—'}`)
      lines.push(`Active label: ${sd.activeAiLabel || '—'}`)
      lines.push(`Source: ${sd.source || '—'}`)
      lines.push(
        `Confidence: ${sd.confidence != null ? `${Math.round(sd.confidence * 100)}%` : '—'}`,
      )
      if (sd.aiAnswer) {
        const a = sd.aiAnswer
        lines.push(`AI vendor: ${a.vendor || '—'}`)
        lines.push(`AI date: ${a.date || '—'}`)
        lines.push(`AI total: ${money(a.amount ?? null)}`)
        lines.push(`AI category: ${a.categoryId || '—'}`)
        lines.push(`AI description: ${a.description || '—'}`)
        lines.push('AI line items:')
        if (a.lineItems?.length) {
          for (const li of a.lineItems) {
            lines.push(
              `  • ${li.description || '(no name)'} | ${money(li.amount)} | cat=${li.categoryId}`,
            )
          }
        } else {
          lines.push('  (none)')
        }
      }
      lines.push(
        `AIs that ran (${(sd.aisUsed || p.aisUsed || []).length}): ${(sd.aisUsed || p.aisUsed || []).join(', ') || '—'}`,
      )
      if (sd.fieldSources) {
        const fs = sd.fieldSources
        lines.push(
          `Field sources: primary=${fs.primary || '—'} ocr=${fs.ocr || '—'} total=${fs.total || '—'} vendor=${fs.vendor || '—'} category=${fs.category || '—'} date=${fs.date || '—'}`,
        )
      }
      lines.push('')
      lines.push('--- RAW OCR / VISION TEXT ---')
      lines.push((sd.rawText || '').trim() || '(empty)')
      lines.push('')
      lines.push('--- FULL AGENT REPORT ---')
      lines.push((sd.agentReport || '').trim() || '(no agent report)')
    } else {
      lines.push('')
      lines.push('--- AI SCAN DUMP ---')
      lines.push('(none saved — this receipt was typed in or scanned before AI dumps were stored)')
    }
    lines.push('')
  })

  lines.push('=== END PROJECT DATA ===')
  return lines.join('\n')
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
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

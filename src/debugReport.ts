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
  a.download = `cost-tracker-debug-${report.id}.json`
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

/** Caps for clipboard dumps — Termux / small paste buffers crash on huge text. */
export const DEBUG_OCR_MAX_CHARS = 1800
export const DEBUG_REPORT_MAX_CHARS = 900
export const DEBUG_DESC_MAX = 120

function moneyFmt(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? '—' : `$${Number(n).toFixed(2)}`
}

/** Keep head + tail of long OCR so money/totals at both ends survive. */
export function compactOcrText(raw: string, max = DEBUG_OCR_MAX_CHARS): string {
  const t = (raw || '').trim()
  if (!t) return '(empty)'
  if (t.length <= max) return t
  const head = Math.floor(max * 0.72)
  const tail = Math.floor(max * 0.22)
  const omitted = t.length - head - tail
  return `${t.slice(0, head)}\n…[${omitted} chars cut for Termux]…\n${t.slice(-tail)}`
}

/**
 * Agent reports are huge (huddle [finding] spam). Keep only high-signal lines.
 */
export function compactAgentReport(report: string, max = DEBUG_REPORT_MAX_CHARS): string {
  const t = (report || '').trim()
  if (!t) return '(no agent report)'
  const kept: string[] = []
  for (const line of t.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    // Drop noisy per-AI chatter (biggest bulk)
    if (/^\[finding\]/i.test(s)) continue
    if (/^\[challenge\]/i.test(s) && !/fatal|inflated|subtotal/i.test(s)) continue
    if (/Score \d+/i.test(s) && /read \d+ lines/i.test(s)) continue
    if (/I read \d+ lines/i.test(s)) continue
    // Keep decisions, answers, reasoner, totals, errors
    if (
      /^\[(decision|answer)\]/i.test(s) ||
      /REASONER|WHO ANSWERED|Actually ran|Skipped|Consensus|PRICE:|fatal|Final:|Primary:|Winner|Quorum free vote|Parse from|LOCAL SMART|CONSENSUS PASS|soft match|Grand total|line sum|even-?split|Catalog/i.test(
        s,
      ) ||
      /^Free AIs:/i.test(s) ||
      /^---/i.test(s) ||
      /^Mosaic |^Hammer:|^Forge |^Lens |^Prism |^Bloom |^Wedge |^Ruler:/i.test(s)
    ) {
      kept.push(s.length > 200 ? `${s.slice(0, 200)}…` : s)
    }
  }
  let out = kept.length ? kept.join('\n') : t.slice(0, max)
  if (out.length > max) {
    out = `${out.slice(0, max)}\n…[report cut for Termux]`
  }
  return out
}

function shortDesc(s: string | undefined | null, max = DEBUG_DESC_MAX): string {
  const t = (s || '').replace(/\s+/g, ' ').trim()
  if (!t) return '—'
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

/**
 * Plain-text dump for pasting into chat with the coding agent.
 * Compact by default so Termux / phone clipboards do not crash.
 * No image bytes — just what the scan did and what it decided.
 */
export function formatScanDebugText(input: ScanDebugTextInput): string {
  const s = input.suggestion
  const f = input.form
  const lines: string[] = []

  lines.push('=== COST TRACKER SCAN (compact) ===')
  lines.push(`v${APP_VERSION} · ${new Date().toISOString().slice(0, 19)}Z`)
  if (input.userNote?.trim()) lines.push(`Note: ${input.userNote.trim().slice(0, 200)}`)
  lines.push(
    `AI: ${s.vendor || '—'} · ${s.date || '—'} · ${moneyFmt(s.amount ?? null)} · ${s.categoryId || '—'} · conf ${s.confidence != null ? `${Math.round(s.confidence * 100)}%` : '—'}`,
  )
  lines.push(`Label: ${shortDesc(s.activeAiLabel, 80)}`)
  lines.push(`Desc: ${shortDesc(s.description)}`)
  if (s.fieldSources) {
    const fs = s.fieldSources
    lines.push(
      `Sources: ${fs.primary || '—'}/${fs.ocr || '—'}/tot=${fs.total || '—'}/vnd=${fs.vendor || '—'}`,
    )
  }
  lines.push(`AIs(${s.aisUsed?.length ?? 0}): ${(s.aisUsed || []).slice(0, 12).join(',') || '—'}`)
  lines.push('Lines:')
  if (s.lineItems?.length) {
    for (const li of s.lineItems.slice(0, 20)) {
      lines.push(`  • ${shortDesc(li.description, 70)} | ${moneyFmt(li.amount)} | ${li.categoryId}`)
    }
    if (s.lineItems.length > 20) lines.push(`  …+${s.lineItems.length - 20} more`)
  } else {
    lines.push('  (none)')
  }

  if (f) {
    lines.push(
      `Form: ${f.vendor || '—'} · ${f.date || '—'} · $${f.amount || '—'} · ${f.categoryId || '—'}`,
    )
    if (f.lineItems?.length) {
      lines.push('Form lines:')
      for (const li of f.lineItems.slice(0, 15)) {
        lines.push(`  • ${shortDesc(li.description, 70)} | ${moneyFmt(li.amount)}`)
      }
    }
  }

  lines.push('--- OCR ---')
  lines.push(compactOcrText(s.rawText || ''))
  lines.push('--- REPORT ---')
  lines.push(compactAgentReport(s.agentReport || ''))
  lines.push('=== END ===')
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
 * Project dump for chat — compact so Termux can paste multi-receipt projects.
 * Keeps saved fields + short OCR + slim agent report per receipt.
 */
export function formatProjectDebugText(input: {
  projectName: string
  projectId: string
  purchases: ProjectPurchaseDebugRow[]
}): string {
  const lines: string[] = []
  lines.push('=== COST TRACKER PROJECT (compact · Termux-safe) ===')
  lines.push(`v${APP_VERSION} · ${new Date().toISOString().slice(0, 19)}Z`)
  lines.push(`Project: ${input.projectName} (${input.projectId})`)
  const withDump = input.purchases.filter((p) => p.scanDebug?.rawText || p.scanDebug?.agentReport)
  lines.push(
    `Receipts: ${input.purchases.length} · dumps: ${withDump.length}/${input.purchases.length}`,
  )
  lines.push('')

  input.purchases.forEach((p, idx) => {
    lines.push(`## R${idx + 1}/${input.purchases.length} ${p.id.slice(0, 8)}`)
    lines.push(
      `Saved: ${p.date || '—'} · ${p.vendor || '—'} · ${moneyFmt(p.amount)} · ${p.categoryId || '—'}`,
    )
    lines.push(`Desc: ${shortDesc(p.description)}`)
    if (p.notes?.trim()) lines.push(`Notes: ${shortDesc(p.notes, 100)}`)
    if (p.lineItems?.length) {
      lines.push('Lines:')
      for (const li of p.lineItems.slice(0, 16)) {
        lines.push(
          `  • ${shortDesc(li.description, 65)} | ${moneyFmt(li.amount)} | ${li.categoryId}`,
        )
      }
      if (p.lineItems.length > 16) lines.push(`  …+${p.lineItems.length - 16} more`)
    } else {
      lines.push('Lines: (none)')
    }

    const sd = p.scanDebug
    if (sd) {
      lines.push(
        `AI: conf ${sd.confidence != null ? `${Math.round(sd.confidence * 100)}%` : '—'} · ${shortDesc(sd.activeAiLabel, 60)} · app ${sd.appVersion || '—'}`,
      )
      if (sd.aiAnswer) {
        const a = sd.aiAnswer
        // Only show AI answer when it differs from saved (saves space)
        const sameTotal =
          a.amount != null && Math.abs((a.amount ?? 0) - p.amount) < 0.02
        const sameVendor =
          (a.vendor || '').toLowerCase() === (p.vendor || '').toLowerCase()
        if (!sameTotal || !sameVendor) {
          lines.push(
            `AI said: ${a.vendor || '—'} · ${moneyFmt(a.amount ?? null)} · ${shortDesc(a.description, 80)}`,
          )
        }
      }
      const ais = sd.aisUsed || p.aisUsed || []
      if (ais.length) lines.push(`AIs(${ais.length}): ${ais.slice(0, 10).join(',')}`)
      lines.push('OCR:')
      lines.push(compactOcrText(sd.rawText || '', DEBUG_OCR_MAX_CHARS))
      lines.push('Report:')
      lines.push(compactAgentReport(sd.agentReport || '', DEBUG_REPORT_MAX_CHARS))
    } else {
      lines.push('AI dump: (none saved)')
    }
    lines.push('')
  })

  lines.push('=== END ===')
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

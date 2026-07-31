import type { AiId } from './aiRoster'
import type { RejectedScanSnapshot } from './agents/retryFeedback'
import {
  parseReceiptText,
  runOnDeviceReceiptAgent,
  type AgentProgress,
  type LocalAgentResult,
} from './localAgent'
import type { ReceiptSuggestion } from './types'
import { getReceiptMemory } from './db'

export type ScanResult = ReceiptSuggestion & {
  source: 'on-device'
  confidence?: number
  rawText?: string
}

export type ScanOptions = {
  /** Default true — heavy-tier free AIs allowed unless disabled */
  maxPower?: boolean
  /** Free AIs turned off in Settings */
  disabledAis?: AiId[]
  /**
   * Prior scan the user rejected with Try again.
   * AIs diversify instead of returning the same answer.
   */
  rejected?: RejectedScanSnapshot
  /** From user ✓/✗ history — boosts trusted free AIs in voting */
  reliability?: Partial<Record<AiId, number>>
  /** Multi-page PDF: one image per page (full page res) */
  pageBlobs?: Blob[]
  onProgress?: (
    p: AgentProgress & {
      engine: 'on-device'
      aiId?: AiId
      aiName?: string
    },
  ) => void
}

/**
 * Free keyless scan — Forge, Lens, Hammer, Titan, Quorum, etc. on your phone.
 * No API keys. maxPower (default on) runs the heavy engines.
 * Pass `rejected` when the user pressed Try again so the team avoids that answer.
 */
export async function scanReceipt(
  imageBlob: Blob,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const {
    onProgress,
    maxPower = true,
    disabledAis = [],
    rejected,
    reliability,
    pageBlobs,
  } = options

  onProgress?.({
    stage: 'prepare',
    progress: 0.02,
    message: rejected
      ? `Try again #${rejected.attempt}: AIs know the last result was wrong…`
      : pageBlobs && pageBlobs.length > 1
        ? `Starting free AI team (${pageBlobs.length} PDF pages)…`
        : maxPower
          ? 'Starting free AI team…'
          : 'Starting free AI team (light mode)…',
    engine: 'on-device',
    aiId: rejected ? 'arbiter' : 'forge',
    aiName: rejected ? 'Arbiter' : 'Forge',
  })

  const local: LocalAgentResult = await runOnDeviceReceiptAgent(
    imageBlob,
    (p) => onProgress?.({ ...p, engine: 'on-device', aiId: p.aiId, aiName: p.aiName }),
    {
      maxPower: rejected ? true : maxPower,
      disabledAis,
      rejected,
      reliability,
      pageBlobs,
    },
  )

  onProgress?.({
    stage: 'done',
    progress: 1,
    message: rejected
      ? 'Retry finished — check if this reading looks better…'
      : 'Free AI team finished — preparing your review…',
    engine: 'on-device',
    aiId: 'quorum',
    aiName: 'Quorum',
  })

  return {
    ...local,
    source: 'on-device',
    // Only credit AIs that actually ran — never invent a full roster
    aisUsed: local.aisUsed?.length
      ? local.aisUsed
      : ['ledger', 'cashier', 'clerk', 'arbiter'],
    activeAiLabel:
      local.activeAiLabel ??
      (rejected ? `Retry #${rejected.attempt}` : 'Free scan team'),
  }
}

/**
 * Parse a digital invoice from embedded PDF text (no camera OCR).
 * Much more accurate for email / accounting PDFs than photo OCR.
 */
export async function scanInvoiceFromText(
  rawText: string,
  options: {
    onProgress?: ScanOptions['onProgress']
    fileName?: string
    layoutLines?: import('./agents/layoutText').LayoutLine[] | null
    rejected?: RejectedScanSnapshot
  } = {},
): Promise<ScanResult> {
  const { onProgress, fileName, layoutLines, rejected } = options
  onProgress?.({
    stage: 'parse',
    progress: 0.2,
    message: fileName
      ? `Reading invoice text from ${fileName}…`
      : 'Reading invoice text from PDF…',
    engine: 'on-device',
    aiId: 'ledger',
    aiName: 'Ledger',
  })

  let memory = null
  try {
    memory = await getReceiptMemory()
  } catch {
    memory = null
  }

  onProgress?.({
    stage: 'parse',
    progress: 0.55,
    message: rejected
      ? 'Re-reading invoice — avoiding the previous wrong answer…'
      : 'Extracting store, totals, and line items…',
    engine: 'on-device',
    aiId: 'cashier',
    aiName: 'Cashier',
  })

  const { banFromRejected } = await import('./agents/receiptEngine')
  const ban = rejected ? banFromRejected(rejected) : undefined
  const preferTotal =
    rejected?.marks?.total === 'right' ? rejected.amount : undefined
  const preferVendor =
    rejected?.marks?.vendor === 'right' ? rejected.vendor : undefined

  const local: LocalAgentResult = parseReceiptText(rawText, memory, {
    layoutLines,
    ban,
    preferTotal,
    preferVendor,
  })
  local.activeAiLabel = fileName
    ? `PDF invoice · ${fileName}`
    : 'PDF invoice · structured engine'
  local.agentReport = [
    'Source: digital PDF (layout text + structured receipt engine).',
    fileName ? `File: ${fileName}` : null,
    rejected ? `Retry #${rejected.attempt} with banned previous wrong values` : null,
    local.agentReport,
  ]
    .filter(Boolean)
    .join('\n')
  local.fieldSources = {
    ...(local.fieldSources ?? {}),
    primary: 'arbiter',
    answerLabel: local.activeAiLabel,
  }

  onProgress?.({
    stage: 'done',
    progress: 1,
    message: 'Invoice ready for review…',
    engine: 'on-device',
    aiId: 'arbiter',
    aiName: 'Arbiter',
  })

  return {
    ...local,
    source: 'on-device',
    aisUsed: local.aisUsed ?? ['ledger', 'sieve', 'cashier', 'clerk', 'arbiter'],
  }
}

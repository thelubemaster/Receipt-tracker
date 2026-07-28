import type { AiId } from './aiRoster'
import type { RejectedScanSnapshot } from './agents/retryFeedback'
import {
  runOnDeviceReceiptAgent,
  type AgentProgress,
  type LocalAgentResult,
} from './localAgent'
import type { ReceiptSuggestion } from './types'

export type ScanResult = ReceiptSuggestion & {
  source: 'on-device'
  confidence?: number
  rawText?: string
}

export type ScanOptions = {
  /** Default true — Hammer parallel OCR + Titan neural (heavy phone load) */
  maxPower?: boolean
  /**
   * Prior scan the user rejected with Try again.
   * AIs diversify instead of returning the same answer.
   */
  rejected?: RejectedScanSnapshot
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
  const { onProgress, maxPower = true, rejected } = options

  onProgress?.({
    stage: 'prepare',
    progress: 0.02,
    message: rejected
      ? `Try again #${rejected.attempt}: AIs know the last result was wrong…`
      : maxPower
        ? 'Starting MAX-POWER free AI team…'
        : 'Starting free AI team…',
    engine: 'on-device',
    aiId: rejected ? 'arbiter' : 'hammer',
    aiName: rejected ? 'Arbiter' : 'Hammer',
  })

  const local: LocalAgentResult = await runOnDeviceReceiptAgent(
    imageBlob,
    (p) => onProgress?.({ ...p, engine: 'on-device', aiId: p.aiId, aiName: p.aiName }),
    { maxPower: rejected ? true : maxPower, rejected },
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
    aisUsed: local.aisUsed ?? [
      'forge',
      'lens',
      'hammer',
      'titan',
      'scout',
      'ledger',
      'sieve',
      'cashier',
      'clerk',
      'arbiter',
      'quorum',
    ],
    activeAiLabel:
      local.activeAiLabel ??
      (rejected ? `Retry #${rejected.attempt}` : 'Max-power free team'),
  }
}

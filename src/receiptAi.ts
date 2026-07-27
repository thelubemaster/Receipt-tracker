import type { AiId } from './aiRoster'
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
 */
export async function scanReceipt(
  imageBlob: Blob,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const { onProgress, maxPower = true } = options

  onProgress?.({
    stage: 'prepare',
    progress: 0.02,
    message: maxPower
      ? 'Starting MAX-POWER free AI team…'
      : 'Starting free AI team…',
    engine: 'on-device',
    aiId: 'hammer',
    aiName: 'Hammer',
  })

  const local: LocalAgentResult = await runOnDeviceReceiptAgent(
    imageBlob,
    (p) => onProgress?.({ ...p, engine: 'on-device', aiId: p.aiId, aiName: p.aiName }),
    { maxPower },
  )

  onProgress?.({
    stage: 'done',
    progress: 1,
    message: 'Free AI team finished — preparing your review…',
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
    activeAiLabel: local.activeAiLabel ?? 'Max-power free team',
  }
}

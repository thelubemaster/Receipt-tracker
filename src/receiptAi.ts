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
  onProgress?: (
    p: AgentProgress & {
      engine: 'on-device'
      aiId?: AiId
      aiName?: string
    },
  ) => void
}

/**
 * Free keyless scan only — Forge, Lens, Sieve, Quorum, etc. on your phone.
 * No API keys. No cloud.
 */
export async function scanReceipt(
  imageBlob: Blob,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const { onProgress } = options

  onProgress?.({
    stage: 'prepare',
    progress: 0.02,
    message: 'Starting free keyless AI team…',
    engine: 'on-device',
    aiId: 'forge',
    aiName: 'Forge',
  })

  const local: LocalAgentResult = await runOnDeviceReceiptAgent(imageBlob, (p) =>
    onProgress?.({ ...p, engine: 'on-device', aiId: p.aiId, aiName: p.aiName }),
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
      'scout',
      'ledger',
      'sieve',
      'cashier',
      'clerk',
      'arbiter',
      'quorum',
    ],
    activeAiLabel: local.activeAiLabel ?? 'Free keyless team',
  }
}

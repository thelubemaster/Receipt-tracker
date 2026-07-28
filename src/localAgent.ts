/**
 * On-device multi-agent receipt team (OCR + specialists + arbiter).
 * Re-exports pipeline entry points and pure parsers used by tests.
 */
export type { AgentProgress, LocalAgentResult } from './agents/pipeline'
export {
  disposeOnDeviceAgent,
  prepareImageForOcr,
  runMultiAgentReceiptPipeline,
} from './agents/pipeline'
export { runLineItemsAgent } from './agents/lineItemsAgent'
export { runTotalsAgent } from './agents/totalsAgent'
export { runMerchantAgent, extractDate, extractVendor } from './agents/merchantAgent'
export { categorizeText } from './agents/keywords'
export { runArbiterAgent } from './agents/arbiterAgent'

import { runCouncilAgent } from './agents/councilAgent'
import {
  runMultiAgentReceiptPipeline,
  type AgentProgress,
  type LocalAgentResult,
} from './agents/pipeline'
import { runLineItemsAgent } from './agents/lineItemsAgent'
import { runTotalsAgent } from './agents/totalsAgent'
import { runMerchantAgent } from './agents/merchantAgent'
import { runArbiterAgent } from './agents/arbiterAgent'
import { normalizeOcrText } from './agents/normalizeOcrText'
import { runLocalSmartPass } from './agents/localSmartPass'
import type { ReceiptMemory } from './receiptMemory'

/** Pure multi-agent parse from OCR text (no Tesseract) — tests & reuse. */
export function parseReceiptText(
  rawText: string,
  memory?: ReceiptMemory | null,
): LocalAgentResult {
  const text = normalizeOcrText(rawText)
  const lines = runLineItemsAgent(text)
  const totals = runTotalsAgent(text)
  const merchant = runMerchantAgent(text)
  const draft = runArbiterAgent({ rawText: text, lines, totals, merchant })
  const council = runCouncilAgent(
    {
      ...draft,
      aisUsed: ['ledger', 'sieve', 'cashier', 'clerk', 'arbiter'],
      activeAiLabel: 'Text parse',
    },
    text,
  )
  return runLocalSmartPass(council, text, memory)
}

export function extractAmount(text: string): number | null {
  return runTotalsAgent(text).total
}

export async function runOnDeviceReceiptAgent(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
  options?: {
    maxPower?: boolean
    disabledAis?: import('./aiRoster').AiId[]
    rejected?: import('./agents/retryFeedback').RejectedScanSnapshot
    reliability?: Partial<Record<import('./aiRoster').AiId, number>>
  },
): Promise<LocalAgentResult> {
  return runMultiAgentReceiptPipeline(imageBlob, onProgress, options)
}

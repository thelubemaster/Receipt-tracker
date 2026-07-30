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

import { runReceiptEngine, type EngineBan } from './agents/receiptEngine'
import type { LayoutLine } from './agents/layoutText'

/** Pure multi-agent parse from OCR/PDF text (no Tesseract) — tests & reuse. */
export function parseReceiptText(
  rawText: string,
  memory?: ReceiptMemory | null,
  opts?: {
    layoutLines?: LayoutLine[] | null
    ban?: EngineBan
    preferTotal?: number | null
    preferVendor?: string | null
  },
): LocalAgentResult {
  const text = normalizeOcrText(rawText)

  // 1) Structured engine first (arithmetic-first — best for invoices)
  const engine = runReceiptEngine(text, {
    layoutLines: opts?.layoutLines,
    ban: opts?.ban,
    preferTotal: opts?.preferTotal,
    preferVendor: opts?.preferVendor,
  })

  // 2) Classic multi-agent path as a challenger
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
  const classic = runLocalSmartPass(council, text, memory)

  // Product quality: penalize address-y / fee-only descriptions
  const productQuality = (items: { description: string }[]) => {
    let s = 0
    for (const it of items) {
      const d = it.description || ''
      if (/\b(shipped to|pennsylvania|street| rd\b|convenience fee)\b/i.test(d)) s -= 8
      if (/filter|kit|ford|pump|tow|foam|wire|stud|piston|oil|part/i.test(d)) s += 6
      if (d.length >= 8 && /[A-Za-z]{4,}/.test(d)) s += 2
    }
    return s
  }

  // 3) Prefer engine when it has a total + better arithmetic / confidence
  const engineScore =
    (engine.confidence ?? 0) * 40 +
    (engine.amount != null ? 20 : 0) +
    Math.min(15, (engine.lineItems?.length ?? 0) * 3) +
    (engine.vendor ? 8 : 0) +
    productQuality(engine.lineItems ?? [])
  const classicScore =
    (classic.confidence ?? 0) * 40 +
    (classic.amount != null ? 18 : 0) +
    Math.min(15, (classic.lineItems?.length ?? 0) * 3) +
    (classic.vendor ? 8 : 0) +
    productQuality(classic.lineItems ?? [])

  // Ban enforcement: if classic repeats banned total, force engine
  if (opts?.ban?.amounts?.length && classic.amount != null) {
    const banned = opts.ban.amounts.some(
      (a) => Math.abs(a - classic.amount!) < 0.05,
    )
    if (banned && engine.amount != null && Math.abs(engine.amount - classic.amount) > 0.05) {
      return {
        ...engine,
        agentReport: [engine.agentReport, 'Chose engine over classic (banned previous total).'].join(
          '\n',
        ),
        activeAiLabel: 'Receipt engine (retry)',
      }
    }
  }

  if (engineScore >= classicScore - 2) {
    // Blend: engine totals when strong; prefer classic product names if better
    const classicProducts = (classic.lineItems ?? []).filter(
      (i) =>
        !/\b(shipping|fee|convenience)\b/i.test(i.description) &&
        !/\bshipped to\b/i.test(i.description),
    )
    const engineProducts = (engine.lineItems ?? []).filter(
      (i) =>
        !/\b(shipping|fee|convenience)\b/i.test(i.description) &&
        !/\bshipped to\b/i.test(i.description),
    )
    const useClassicLines =
      productQuality(classicProducts) > productQuality(engineProducts) + 4 &&
      classicProducts.length > 0

    const merged = {
      ...engine,
      vendor: engine.vendor || classic.vendor,
      date: engine.date || classic.date,
      lineItems: useClassicLines
        ? [
            ...classicProducts,
            ...(engine.lineItems ?? []).filter((i) =>
              /\b(shipping|fee|convenience)\b/i.test(i.description),
            ),
          ]
        : engine.lineItems,
      description: useClassicLines ? classic.description : engine.description,
      agentReport: [
        engine.agentReport,
        '---',
        `Classic challenger conf ${Math.round((classic.confidence ?? 0) * 100)}% total ${classic.amount ?? '—'}`,
        useClassicLines ? 'Used classic product lines (cleaner names)' : null,
        classic.agentReport,
      ]
        .filter(Boolean)
        .join('\n'),
    }
    return runLocalSmartPass(merged, text, memory)
  }

  // Classic won — still run smart pass
  const out = runLocalSmartPass(classic, text, memory)
  out.agentReport = [
    out.agentReport,
    '---',
    `Engine challenger conf ${Math.round((engine.confidence ?? 0) * 100)}% total ${engine.amount ?? '—'}`,
    engine.agentReport,
  ]
    .filter(Boolean)
    .join('\n')
  return out
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

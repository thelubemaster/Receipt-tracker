import type { AiId } from '../aiRoster'
import { getAi, isAiEnabled } from '../aiRoster'

function getAiName(id: AiId): string {
  return getAi(id).name
}
import type { ReceiptSuggestion } from '../types'
import { runArbiterAgent } from './arbiterAgent'
import { runForgeOcr } from './forgeOcr'
import { runHammerOcr } from './hammerOcr'
import { mergeOcrTexts, runLensOcr } from './lensOcr'
import { runLineItemsAgent } from './lineItemsAgent'
import { runMerchantAgent } from './merchantAgent'
import { normalizeOcrText } from './normalizeOcrText'
import { runCouncilAgent } from './councilAgent'
import { runQuorumAgent } from './quorumAgent'
import { runTeamHuddle } from './teamHuddle'
import {
  applyUserMarksToResult,
  diversifyImageForRetry,
  formatRejectionBrief,
  pickDiversifiedParse,
  similarityToRejected,
  type RejectedScanSnapshot,
} from './retryFeedback'
import { applySeekerToDraft, runSeekerAgent } from './seekerAgent'
import { runSieveAgent } from './sieveAgent'
import { runTotalsAgent } from './totalsAgent'
import { runLocalSmartPass } from './localSmartPass'
import { runConsensusPass } from './consensusPass'
import type { ReceiptMemory } from '../receiptMemory'

export type LocalAgentResult = ReceiptSuggestion & {
  source: 'on-device'
  confidence: number
  rawText: string
  agentReport?: string
  aisUsed?: AiId[]
}

export type AgentProgress = {
  stage: 'prepare' | 'ocr' | 'parse' | 'arbitrate' | 'done' | string
  progress: number
  message: string
  aiId?: AiId
  aiName?: string
}

function scoreOcrText(text: string): number {
  const lines = text.split(/\n/).filter((l) => l.trim()).length
  const money = (text.match(/\d+[.,]\d{2}/g) || []).length
  const letters = (text.match(/[A-Za-z]/g) || []).length
  return lines * 2 + money * 5 + Math.min(letters, 800) * 0.05
}

function parseFromText(
  rawText: string,
  label: string,
  ocrNote: string,
  extraAis: AiId[],
  enabled: (id: AiId) => boolean,
): LocalAgentResult {
  const text = normalizeOcrText(rawText)
  const ledgerOnly = runLineItemsAgent(text)
  const sieve = enabled('sieve')
    ? runSieveAgent(text)
    : {
        ...ledgerOnly,
        notes: [...ledgerOnly.notes, 'Sieve disabled — Ledger only'],
      }
  const totals = runTotalsAgent(text)
  const merchant = runMerchantAgent(text)

  const result = runArbiterAgent({
    rawText: text,
    lines: {
      ...sieve,
      notes: [...sieve.notes, `Ledger alone: ${ledgerOnly.items.length} items`],
    },
    totals,
    merchant,
  })

  const used: AiId[] = ['ledger', 'cashier', 'clerk', 'arbiter', ...extraAis]
  if (enabled('sieve')) used.push('sieve')
  result.aisUsed = Array.from(new Set<AiId>(used))
  result.activeAiLabel = label
  // Tag OCR contributor on field sources
  const ocrAi = extraAis.find((id) =>
    ['forge', 'lens', 'ruler', 'hammer', 'titan', 'scout', 'wedge', 'prism', 'bloom', 'mosaic'].includes(
      id,
    ),
  )
  if (ocrAi) {
    result.fieldSources = { ...(result.fieldSources ?? {}), ocr: ocrAi }
  }
  result.agentReport = [
    `Free parse path: ${label}`,
    ocrNote,
    `Ledger: ${ledgerOnly.items.length} · Sieve: ${enabled('sieve') ? sieve.items.length : 'off'}`,
    result.agentReport,
  ].join('\n')
  return result
}

export type PipelineOptions = {
  /** Default true — heavy-tier free AIs allowed (unless individually disabled) */
  maxPower?: boolean
  /** User-disabled free AIs (Settings toggles) */
  disabledAis?: AiId[]
  /**
   * User pressed Try again — previous answer was wrong.
   * Pipeline diversifies OCR + picks a different parse.
   */
  rejected?: RejectedScanSnapshot
  /** Reliability weights from user ✓/✗ history (boost trusted AIs) */
  reliability?: Partial<Record<AiId, number>>
  /**
   * On-device memory learned from saved receipts (local only).
   * When omitted, pipeline loads from IndexedDB if available.
   */
  memory?: ReceiptMemory | null
}

function scoreParseCandidate(
  c: LocalAgentResult,
  reliability?: Partial<Record<AiId, number>>,
): number {
  let s = (c.confidence ?? 0) * 40
  s += Math.min(12, (c.lineItems?.length ?? 0) * 2)
  if (c.amount != null) s += 15
  if (c.vendor) s += 8
  if (c.date) s += 6
  if (c.lineItems?.length && c.amount != null) {
    const sum = c.lineItems.reduce((a, i) => a + i.amount, 0)
    const tax = c.tax ?? 0
    // Strong reward when full arithmetic closes
    if (Math.abs(sum + tax - c.amount) < 0.2 || Math.abs(sum - c.amount) < 0.15) s += 18
    else if (Math.abs(sum - (c.subtotal ?? -1)) < 0.15) s += 12
    else if (Math.abs(sum - c.amount) < 1.5) s += 4
    else if (sum > c.amount * 1.2) s -= 10 // products overshoot total → likely dupes
  } else if (c.amount == null) {
    s -= 8
  }
  // Prefer non-misc categories and real vendors over card-brand junk
  if (c.categoryId && c.categoryId !== 'misc') s += 4
  if (c.vendor && !/^(visa|mastercard|amex|debit|chip|purchase)$/i.test(c.vendor.trim())) s += 3
  if (c.vendor && /^(visa|mastercard|amex|debit|chip)$/i.test(c.vendor.trim())) s -= 12
  s += Math.min(10, (c.description?.length ?? 0) / 20)
  // Weight by historical reliability of AIs on this path
  if (reliability && c.aisUsed?.length) {
    const weights = c.aisUsed.map((id) => reliability[id] ?? 1)
    const avg = weights.reduce((a, b) => a + b, 0) / weights.length
    s *= avg
  }
  return s
}

/**
 * Free keyless multi-agent pipeline with optional max-power engines.
 * Forge + Lens always; Hammer (parallel OCR) + Titan (neural) when maxPower.
 * Quorum votes across all successful OCR paths.
 * On retry, rejected snapshot steers AIs away from the same wrong answer.
 */
export async function runMultiAgentReceiptPipeline(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
  options: PipelineOptions = {},
): Promise<LocalAgentResult> {
  const rejected = options.rejected
  // Retries allow heavy tier unless user explicitly disabled those AIs
  const maxPower = rejected ? true : options.maxPower !== false
  const disabledAis = options.disabledAis ?? []
  const reliability = options.reliability
  const enabled = (id: AiId) => isAiEnabled(id, { disabledAis, maxPowerMode: maxPower })
  const attempt = rejected?.attempt ?? 0
  const scoreOf = (c: LocalAgentResult) => scoreParseCandidate(c, reliability)

  let workBlob = imageBlob
  if (rejected && attempt >= 1) {
    onProgress?.({
      stage: 'prepare',
      progress: 0.02,
      message: `Try again #${attempt}: AIs know the last answer was wrong — re-reading differently…`,
      aiId: 'arbiter',
      aiName: 'Arbiter',
    })
    try {
      workBlob = await diversifyImageForRetry(imageBlob, attempt)
    } catch {
      workBlob = imageBlob
    }
  } else {
    onProgress?.({
      stage: 'prepare',
      progress: 0.02,
      message: maxPower
        ? 'Starting free AI team (heavy engines allowed if enabled)…'
        : 'Starting free AI team (light mode — heavy AIs off)…',
      aiId: 'forge',
      aiName: 'Forge',
    })
  }

  // Local image prep (contrast + size) before any OCR — free, on-device
  try {
    workBlob = await prepareImageForOcr(workBlob, maxPower ? 1600 : 1400)
  } catch {
    /* keep original */
  }

  const ocrTexts: { label: string; text: string; note: string; ais: AiId[] }[] = []
  const skipped: string[] = []

  async function runOcrIfEnabled(
    id: AiId,
    label: string,
    runner: () => Promise<{ text: string; note: string }>,
  ) {
    if (!enabled(id)) {
      skipped.push(`${label} off`)
      return
    }
    try {
      const r = await runner()
      if (r.text.trim()) {
        ocrTexts.push({ label, text: r.text, note: r.note, ais: [id] })
      }
    } catch (e) {
      onProgress?.({
        stage: 'ocr',
        progress: 0.45,
        message: `${label} skipped: ${e instanceof Error ? e.message : 'error'}`,
        aiId: id,
        aiName: label.split(' ')[0],
      })
    }
  }

  const layoutish = (t: string) =>
    t.split(/\n/).filter((l) => /[A-Za-z]{3,}/.test(l) && /\d+[.,]\d{2}/.test(l)).length

  function bestOcrQuality(): number {
    if (!ocrTexts.length) return 0
    return Math.max(
      ...ocrTexts.map(
        (o) =>
          scoreOcrText(o.text) +
          layoutish(o.text) * 8 +
          (o.ais.includes('ruler') ? 12 : 0) +
          (o.ais.includes('wedge') ? 4 : 0),
      ),
    )
  }

  // ── Phase 1: layout-first free OCR (deskew → layout → solid general) ──
  // Order matters: crooked photos first, then row mapping, then multi-preprocess.
  await runOcrIfEnabled('wedge', 'Wedge deskew path', async () => {
    const { runWedgeOcr } = await import('./wedgeOcr')
    const wedge = await runWedgeOcr(workBlob, onProgress)
    return { text: wedge.text, note: `Wedge deskew ${wedge.angleDeg.toFixed(1)}° · ${wedge.bestPass}` }
  })

  await runOcrIfEnabled('ruler', 'Ruler layout path', async () => {
    const { runRulerOcr } = await import('./rulerOcr')
    const ruler = await runRulerOcr(workBlob, onProgress)
    return {
      text: ruler.text,
      note: `Ruler: ${ruler.lineCount} document lines · ${ruler.wordCount} words · ${ruler.bestPass}`,
    }
  })

  await runOcrIfEnabled('forge', 'Forge path', async () => {
    const forge = await runForgeOcr(workBlob, onProgress)
    return { text: forge.text, note: `Forge best: ${forge.bestPass}` }
  })

  // ── Phase 2: only if phase 1 is thin (saves time, less garbage votes) ──
  let q = bestOcrQuality()
  const bestPhase1Text = ocrTexts.length
    ? [...ocrTexts].sort((a, b) => scoreOcrText(b.text) - scoreOcrText(a.text))[0].text
    : ''
  const strongEnough = q >= 55 && layoutish(bestPhase1Text) >= 2
  const needMore = !strongEnough || Boolean(rejected)

  if (needMore) {
    await runOcrIfEnabled('lens', 'Lens path', async () => {
      const lens = await runLensOcr(workBlob, onProgress)
      return { text: lens.text, note: `Lens best: ${lens.bestPass}` }
    })
    await runOcrIfEnabled('prism', 'Prism multi-layout path', async () => {
      const { runPrismOcr } = await import('./prismOcr')
      const prism = await runPrismOcr(workBlob, onProgress)
      return { text: prism.text, note: `Prism ${prism.modesRun} modes · ${prism.bestPass}` }
    })
  } else {
    skipped.push('Lens/Prism skipped (layout OCR already strong)')
  }

  // ── Phase 3: heavy free engines only when still weak or max-power retry ──
  q = bestOcrQuality()
  const stillWeak = q < 70 || layoutish(ocrTexts[0]?.text || '') < 2
  if (stillWeak || (maxPower && rejected)) {
    await runOcrIfEnabled('bloom', 'Bloom upscale path', async () => {
      const { runBloomOcr } = await import('./bloomOcr')
      const bloom = await runBloomOcr(workBlob, onProgress)
      return { text: bloom.text, note: `Bloom ×${bloom.scale} · ${bloom.bestPass}` }
    })
    await runOcrIfEnabled('mosaic', 'Mosaic tile path', async () => {
      const { runMosaicOcr } = await import('./mosaicOcr')
      const mosaic = await runMosaicOcr(workBlob, onProgress)
      return { text: mosaic.text, note: `Mosaic ${mosaic.tiles} tiles · ${mosaic.bestPass}` }
    })
    await runOcrIfEnabled('hammer', 'Hammer path', async () => {
      const hammer = await runHammerOcr(workBlob, onProgress)
      return {
        text: hammer.text,
        note: `Hammer: ${hammer.workersUsed} workers × ${hammer.variantsRun} jobs · best ${hammer.bestPass}`,
      }
    })
    await runOcrIfEnabled('titan', 'Titan neural path', async () => {
      const { runTitanNeural } = await import('./titanNeural')
      const titan = await runTitanNeural(workBlob, onProgress)
      if (titan.unavailable || !titan.text.trim()) {
        skipped.push(
          titan.reason
            ? `Titan off (${titan.reason.slice(0, 80)})`
            : 'Titan produced no text',
        )
        return { text: '', note: `Titan unavailable · ${titan.device}` }
      }
      return {
        text: titan.text,
        note: `Titan ${titan.model} on ${titan.device} · ${titan.strips} strips`,
      }
    })
  } else {
    skipped.push('Heavy OCR (Hammer/Bloom/Mosaic/Titan) skipped — layout path was solid')
  }

  const usable = ocrTexts.filter((o) => o.text.trim().length > 10)
  if (!usable.length) {
    // last-ditch scout (core — always allowed)
    try {
      const Tesseract = await import('tesseract.js')
      onProgress?.({
        stage: 'ocr',
        progress: 0.6,
        message: 'Scout emergency fallback…',
        aiId: 'scout',
        aiName: 'Scout',
      })
      const worker = await Tesseract.createWorker('eng')
      const r = await worker.recognize(workBlob)
      await worker.terminate()
      usable.push({
        label: 'Scout fallback',
        text: r.data.text || '',
        note: 'Scout emergency',
        ais: ['scout'],
      })
    } catch (e) {
      throw new Error(
        e instanceof Error ? e.message : 'All free OCR engines failed on this device',
      )
    }
  }

  // Prefer Ruler / layout-rich OCR when ranking paths
  usable.sort((a, b) => {
    const la = (a.ais.includes('ruler') ? 4 : 0) + (a.ais.includes('wedge') ? 2 : 0) + layoutish(a.text) * 2 + scoreOcrText(a.text) * 0.01
    const lb = (b.ais.includes('ruler') ? 4 : 0) + (b.ais.includes('wedge') ? 2 : 0) + layoutish(b.text) * 2 + scoreOcrText(b.text) * 0.01
    return lb - la
  })

  onProgress?.({
    stage: 'parse',
    progress: 0.68,
    message: 'Team huddle — free AIs talking to each other on your phone…',
    aiId: 'council',
    aiName: 'Council',
  })

  // Individual parses (for diversify / reliability) + shared huddle
  const parses = usable.map((u) => parseFromText(u.text, u.label, u.note, u.ais, enabled))
  let merged = usable[0].text
  for (let i = 1; i < usable.length; i++) {
    merged = mergeOcrTexts(merged, usable[i].text)
  }
  if (usable.length > 1 && scoreOcrText(merged) > scoreOcrText(usable[0].text) * 0.85) {
    parses.push(
      parseFromText(
        merged,
        'Merged multi-OCR path',
        `Merged ${usable.length} OCR engines (layout-first)`,
        usable.flatMap((u) => u.ais),
        enabled,
      ),
    )
  }

  let councilText = usable[0].text
  for (let i = 1; i < usable.length; i++) {
    councilText = mergeOcrTexts(councilText, usable[i].text)
  }

  // ── On-device team huddle: OCR + parse agents post, challenge, agree ──
  let final: LocalAgentResult
  let diversifyReport = ''
  try {
    final = runTeamHuddle(
      usable.map((u) => ({ label: u.label, text: u.text, note: u.note, ais: u.ais })),
      {
        enabled,
        reliability,
        onTalk: (msg, aiId) => {
          onProgress?.({
            stage: 'arbitrate',
            progress: 0.78,
            message: msg.slice(0, 120),
            aiId: aiId ?? 'council',
            aiName: aiId ? getAiName(aiId) : 'Council',
          })
        },
      },
    )
  } catch {
    // Fallback: old path if huddle throws
    final = [...parses].sort((a, b) => scoreOf(b) - scoreOf(a))[0]
  }

  // Rejected-answer diversify still applies
  if (rejected && parses.length) {
    const picked = pickDiversifiedParse(parses, rejected, scoreOf)
    diversifyReport = picked.report
    if (similarityToRejected(final, rejected) >= 0.75) {
      final = picked.winner
      if (enabled('quorum')) {
        for (const p of parses) {
          if (p === final) continue
          if (similarityToRejected(p, rejected) < 0.7) {
            final = runQuorumAgent(final, p)
          }
        }
      }
    }
  }

  if (!final.rawText || councilText.length > (final.rawText?.length ?? 0)) {
    final = { ...final, rawText: councilText }
  }

  onProgress?.({
    stage: 'arbitrate',
    progress: 0.9,
    message: enabled('council')
      ? 'Council second pass — agents refining the huddle answer…'
      : 'Team huddle done (Council off)…',
    aiId: 'council',
    aiName: 'Council',
  })

  if (enabled('council')) {
    final = runCouncilAgent(
      final,
      councilText || final.rawText || '',
      (msg, aiId) => {
        onProgress?.({
          stage: 'arbitrate',
          progress: 0.92,
          message: msg.slice(0, 120),
          aiId: aiId ?? 'council',
          aiName: aiId ? getAiName(aiId) : 'Council',
        })
      },
      rejected,
    )
  } else {
    skipped.push('Council off')
  }

  if (enabled('council') && rejected && similarityToRejected(final, rejected) >= 0.82) {
    onProgress?.({
      stage: 'arbitrate',
      progress: 0.94,
      message: 'Still too similar to the rejected answer — forcing alternate debate…',
      aiId: 'arbiter',
      aiName: 'Arbiter',
    })
    const alt = pickDiversifiedParse(parses, rejected, (c) => scoreOf(c) * 0.5)
    final = runCouncilAgent(
      { ...alt.winner, rawText: councilText || alt.winner.rawText },
      councilText || final.rawText || '',
      (msg, aiId) => {
        onProgress?.({
          stage: 'arbitrate',
          progress: 0.945,
          message: msg.slice(0, 120),
          aiId: aiId ?? 'council',
          aiName: 'Council',
        })
      },
      {
        ...rejected,
        attempt: rejected.attempt + 1,
        userNote: (rejected.userNote || '') + ' Still too similar — push harder.',
      },
    )
    diversifyReport += `\nForced alternate draft. ${alt.report}`
  }

  // Seeker — optional free web (not required; all core AIs stay local)
  if (enabled('seeker') && typeof navigator !== 'undefined' && navigator.onLine !== false) {
    onProgress?.({
      stage: 'arbitrate',
      progress: 0.96,
      message: 'Seeker optional free web lookup (needs network)…',
      aiId: 'seeker',
      aiName: 'Seeker',
    })
    try {
      const seek = await runSeekerAgent(final, {
        onProgress: (msg, aiId) =>
          onProgress?.({
            stage: 'arbitrate',
            progress: 0.97,
            message: msg.slice(0, 120),
            aiId: aiId ?? 'seeker',
            aiName: 'Seeker',
          }),
      })
      final = applySeekerToDraft(final, seek)
      if (enabled('council')) {
        final = runCouncilAgent(
          final,
          councilText || final.rawText || '',
          (msg, aiId) => {
            onProgress?.({
              stage: 'arbitrate',
              progress: 0.98,
              message: msg.slice(0, 120),
              aiId: aiId ?? 'council',
              aiName: 'Council',
            })
          },
          rejected,
        )
      }
    } catch (e) {
      final.agentReport = [
        final.agentReport,
        `Seeker skipped (optional): ${e instanceof Error ? e.message : 'offline'}`,
      ].join('\n')
    }
  } else if (!enabled('seeker')) {
    skipped.push('Seeker off (optional web AI)')
  }

  const ranIds = new Set<AiId>([
    ...(final.aisUsed ?? []),
    ...usable.flatMap((u) => u.ais),
    'scout',
    'ledger',
    'cashier',
    'clerk',
    'arbiter',
  ])
  for (const id of [
    'forge',
    'lens',
    'ruler',
    'wedge',
    'prism',
    'bloom',
    'mosaic',
    'hammer',
    'titan',
    'sieve',
    'quorum',
    'council',
    'seeker',
  ] as AiId[]) {
    if (enabled(id)) ranIds.add(id)
  }
  final.aisUsed = Array.from(ranIds)
  // Ensure field attribution + human-readable “who answered”
  const ocrLead = usable[0]?.ais[0]
  final.fieldSources = {
    ...(final.fieldSources ?? {}),
    ocr: final.fieldSources?.ocr ?? ocrLead,
    total: final.fieldSources?.total ?? 'cashier',
    vendor: final.fieldSources?.vendor ?? 'clerk',
    category: final.fieldSources?.category ?? 'ledger',
    date: final.fieldSources?.date ?? 'clerk',
    shipping: final.fieldSources?.shipping ?? 'ledger',
    fees: final.fieldSources?.fees ?? 'ledger',
    primary:
      final.fieldSources?.primary ??
      (enabled('quorum') ? 'quorum' : enabled('council') ? 'council' : ocrLead ?? 'arbiter'),
  }
  {
    const src = final.fieldSources
    const primaryName = src.primary ? getAiName(src.primary) : 'Team'
    const ocrName = src.ocr ? getAiName(src.ocr) : null
    final.fieldSources.answerLabel = rejected
      ? `Retry #${attempt} · answer from ${primaryName}${ocrName ? ` (OCR: ${ocrName})` : ''}`
      : `Answer from ${primaryName}${ocrName ? ` · OCR ${ocrName}` : ''} · team huddle`
    final.activeAiLabel = final.fieldSources.answerLabel
  }

  final.agentReport = [
    'LOCAL: All OCR + parse AIs run on this phone. No paid API keys.',
    `WHO ANSWERED: ${final.fieldSources.answerLabel}`,
    final.fieldSources.primary
      ? `Primary: ${getAiName(final.fieldSources.primary)} · Total: ${getAiName(final.fieldSources.total ?? 'cashier')} · Vendor: ${getAiName(final.fieldSources.vendor ?? 'clerk')} · Lines: ${getAiName(final.fieldSources.category ?? 'ledger')}`
      : null,
    rejected ? formatRejectionBrief(rejected) : null,
    diversifyReport || null,
    skipped.length ? `Disabled/skipped: ${skipped.join(', ')}` : null,
    `On-device AIs this run: ${Array.from(ranIds).filter((id) => id !== 'seeker').join(', ')}`,
    enabled('seeker') ? 'Seeker: optional free web (not required for a scan)' : null,
    ...usable.map((u) => u.note),
    final.agentReport,
  ]
    .filter(Boolean)
    .join('\n')
  if (rejected?.marks) {
    final = applyUserMarksToResult(final, rejected)
  }

  // ── Local smart pass + on-device memory (never leaves the phone) ──
  onProgress?.({
    stage: 'arbitrate',
    progress: 0.985,
    message: 'Local smart pass — memory + fee/total repair on your phone…',
    aiId: 'arbiter',
    aiName: 'Arbiter',
  })
  let memory = options.memory
  if (memory === undefined) {
    try {
      const { getReceiptMemory } = await import('../db')
      memory = await getReceiptMemory()
    } catch {
      memory = null
    }
  }
  final = runLocalSmartPass(final, councilText || final.rawText || '', memory)

  // ── Consensus: multi-path vote for more consistent totals/vendor/lines ──
  onProgress?.({
    stage: 'arbitrate',
    progress: 0.992,
    message: 'Consensus pass — cross-checking OCR paths for a stable answer…',
    aiId: 'quorum',
    aiName: 'Quorum',
  })
  try {
    // Rank independent parses; keep top paths for voting (not just the huddle winner)
    const rankedPaths = [...parses].sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 5)
    if (final && !rankedPaths.includes(final)) rankedPaths.unshift(final)
    final = runConsensusPass(final, rankedPaths, councilText || final.rawText || '')
  } catch (e) {
    final.agentReport = [
      final.agentReport,
      `Consensus skipped: ${e instanceof Error ? e.message : 'error'}`,
    ].join('\n')
  }

  final.source = 'on-device'

  onProgress?.({
    stage: 'done',
    progress: 1,
    message: rejected?.marks
      ? 'Retry finished using your ✓/✗ marks…'
      : 'On-device team finished (layout + consensus + memory)',
    aiId: 'council',
    aiName: 'Council',
  })

  return final
}

export async function disposeOnDeviceAgent(): Promise<void> {
  try {
    const { disposeForgeWorker } = await import('./forgeOcr')
    await disposeForgeWorker()
  } catch {
    /* ignore */
  }
  try {
    const { disposeRulerWorker } = await import('./rulerOcr')
    await disposeRulerWorker()
  } catch {
    /* ignore */
  }
}

/**
 * Free local preprocess: resize + contrast so thermal / phone photos OCR more consistently.
 * Adaptive stretch lifts dim receipts without crushing already-sharp ones.
 */
export async function prepareImageForOcr(blob: Blob, maxEdge = 1400): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(bitmap, 0, 0, w, h)
    try {
      const img = ctx.getImageData(0, 0, w, h)
      const d = img.data
      // Sample luminance for adaptive contrast
      let sum = 0
      let count = 0
      for (let i = 0; i < d.length; i += 32) {
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        count++
      }
      const mean = count ? sum / count : 128
      // Dim / washed receipts get more punch; bright already-crisp photos stay mild
      const contrast = mean < 90 ? 1.32 : mean > 170 ? 1.12 : 1.22
      const intercept = 128 * (1 - contrast)
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i] * contrast + intercept
        let g = d[i + 1] * contrast + intercept
        let b = d[i + 2] * contrast + intercept
        // Soft grayscale mix helps Tesseract on tinted photos
        const y = 0.299 * r + 0.587 * g + 0.114 * b
        // Mild unsharp-style lift of midtones
        const mid = y < 128 ? y * 1.04 : y
        r = mid * 0.88 + r * 0.12
        g = mid * 0.88 + g * 0.12
        b = mid * 0.88 + b * 0.12
        d[i] = Math.max(0, Math.min(255, r))
        d[i + 1] = Math.max(0, Math.min(255, g))
        d[i + 2] = Math.max(0, Math.min(255, b))
      }
      ctx.putImageData(img, 0, 0)
    } catch {
      /* putImageData may fail on huge images — resized draw is still fine */
    }
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.9)
    })
  } finally {
    bitmap.close()
  }
}

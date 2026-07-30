import type { AiId } from '../aiRoster'
import { getAi, isAiEnabled } from '../aiRoster'
import type { ReceiptSuggestion } from '../types'
import type { ReceiptMemory } from '../receiptMemory'
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
import { scoreOcrText } from './ocrScore'
import { banFromRejected, runReceiptEngine } from './receiptEngine'

export { scoreOcrText } from './ocrScore'

function getAiName(id: AiId): string {
  return getAi(id).name
}

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

function parseFromText(
  rawText: string,
  label: string,
  ocrNote: string,
  extraAis: AiId[],
  enabled: (id: AiId) => boolean,
  ban?: import('./receiptEngine').EngineBan,
): LocalAgentResult {
  const text = normalizeOcrText(rawText)

  // Structured engine (primary) + classic agents as cross-check
  const engine = runReceiptEngine(text, { ban })

  const ledgerOnly = runLineItemsAgent(text)
  const sieve = enabled('sieve')
    ? runSieveAgent(text)
    : {
        ...ledgerOnly,
        notes: [...ledgerOnly.notes, 'Sieve disabled — Ledger only'],
      }
  const totals = runTotalsAgent(text)
  const merchant = runMerchantAgent(text)

  const classic = runArbiterAgent({
    rawText: text,
    lines: {
      ...sieve,
      notes: [...sieve.notes, `Ledger alone: ${ledgerOnly.items.length} items`],
    },
    totals,
    merchant,
  })

  // Prefer engine when it has total + decent conf, or when classic hits a banned total
  let result = engine
  const classicBanned =
    ban?.amounts?.length &&
    classic.amount != null &&
    ban.amounts.some((a) => Math.abs(a - classic.amount!) < 0.05)
  const engineScore =
    (engine.confidence ?? 0) * 50 +
    (engine.amount != null ? 25 : 0) +
    (engine.lineItems?.length ?? 0) * 2
  const classicScore =
    (classic.confidence ?? 0) * 50 +
    (classic.amount != null ? 22 : 0) +
    (classic.lineItems?.length ?? 0) * 2

  if (!classicBanned && classicScore > engineScore + 8) {
    result = {
      ...classic,
      source: 'on-device',
      confidence: classic.confidence,
      rawText: text,
      agentReport: classic.agentReport,
    }
  } else {
    // Fill gaps from classic
    result = {
      ...engine,
      vendor: engine.vendor || classic.vendor,
      date: engine.date || classic.date,
      amount: engine.amount ?? classic.amount,
    }
  }

  const used: AiId[] = ['ledger', 'cashier', 'clerk', 'arbiter', ...extraAis]
  if (enabled('sieve')) used.push('sieve')
  result.aisUsed = Array.from(new Set<AiId>(used))
  result.activeAiLabel = label
  const ocrAi = extraAis.find((id) =>
    [
      'forge',
      'lens',
      'ruler',
      'hammer',
      'titan',
      'oracle',
      'scout',
      'wedge',
      'prism',
      'bloom',
      'mosaic',
    ].includes(id),
  )
  if (ocrAi) {
    result.fieldSources = { ...(result.fieldSources ?? {}), ocr: ocrAi }
  }
  result.agentReport = [
    `Parse path: ${label}`,
    ocrNote,
    `Engine total ${engine.amount ?? '—'} conf ${Math.round((engine.confidence ?? 0) * 100)}%`,
    `Classic total ${classic.amount ?? '—'} conf ${Math.round((classic.confidence ?? 0) * 100)}%`,
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
  // Boost true vision-model paths over pure Tesseract dumps
  if (c.aisUsed?.includes('oracle')) s += 14
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

  // Local image prep: upscale small shots, stretch contrast, sharpen — free, on-device
  try {
    workBlob = await prepareImageForOcr(workBlob, {
      maxEdge: maxPower ? 2000 : 1600,
      minEdge: maxPower ? 1400 : 1200,
    })
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
  const hasTotalLabel =
    /\b(grand\s+)?t[o0]tal\b|\bamount\s+due\b/i.test(bestPhase1Text) &&
    (bestPhase1Text.match(/\d+[.,]\d{2}/g) || []).length >= 2
  // Require real receipt structure — not just "some letters"
  const strongEnough =
    q >= 72 && layoutish(bestPhase1Text) >= 3 && hasTotalLabel
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

  // ── Phase 3: heavy free engines when still weak, no total line, or max-power retry ──
  q = bestOcrQuality()
  const bestNow = ocrTexts.length
    ? [...ocrTexts].sort((a, b) => scoreOcrText(b.text) - scoreOcrText(a.text))[0].text
    : ''
  const stillWeak =
    q < 90 ||
    layoutish(bestNow) < 3 ||
    !(
      /\b(grand\s+)?t[o0]tal\b|\bamount\s+due\b/i.test(bestNow) &&
      (bestNow.match(/\d+[.,]\d{2}/g) || []).length >= 2
    )
  // ── Vision-language model (looks at the page — not Tesseract) ──
  // Prefer when OCR looks weak, on retry, or always in max-power mode.
  let oracleStructured: import('./oracleVlm').OracleResult | null = null
  const wantOracle =
    enabled('oracle') && (stillWeak || Boolean(rejected) || maxPower)
  if (wantOracle) {
    try {
      const { runOracleVlm } = await import('./oracleVlm')
      const oracle = await runOracleVlm(workBlob, onProgress)
      if (!oracle.unavailable && oracle.text.trim()) {
        oracleStructured = oracle
        ocrTexts.push({
          label: 'Oracle vision path',
          text: oracle.text,
          note: `Oracle DocVQA · ${oracle.answers.length} answers · conf ${Math.round(oracle.confidence * 100)}% · ${oracle.device}`,
          ais: ['oracle'],
        })
      } else {
        skipped.push(
          oracle.reason
            ? `Oracle off (${oracle.reason.slice(0, 80)})`
            : 'Oracle produced no answers',
        )
      }
    } catch (e) {
      skipped.push(
        `Oracle error: ${e instanceof Error ? e.message.slice(0, 60) : 'failed'}`,
      )
    }
  } else if (!enabled('oracle')) {
    skipped.push('Oracle off')
  }

  if (stillWeak || (maxPower && rejected) || Boolean(oracleStructured?.unavailable)) {
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
    skipped.push('Heavy OCR (Hammer/Bloom/Mosaic/Titan) skipped — layout/Oracle path was solid')
  }

  // Drop near-empty / garbage OCR paths before voting (they pollute merge + consensus)
  const usable = ocrTexts
    .filter((o) => o.text.trim().length > 10 && scoreOcrText(o.text) >= 8)
    .sort((a, b) => scoreOcrText(b.text) - scoreOcrText(a.text))
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
  // Only use top OCR paths — weak dumps pollute votes when merged.
  const topOcr = usable.slice(0, Math.min(4, usable.length))
  const ban = rejected ? banFromRejected(rejected) : undefined
  const parses = topOcr.map((u) =>
    parseFromText(u.text, u.label, u.note, u.ais, enabled, ban),
  )
  const bestScore = scoreOcrText(topOcr[0].text)
  // Merge only paths that are close in quality to the leader (not random garbage)
  const mergeable = topOcr.filter((u) => scoreOcrText(u.text) >= bestScore * 0.55)
  let merged = mergeable[0].text
  for (let i = 1; i < mergeable.length; i++) {
    merged = mergeOcrTexts(merged, mergeable[i].text)
  }
  if (mergeable.length > 1 && scoreOcrText(merged) > bestScore * 0.8) {
    parses.push(
      parseFromText(
        merged,
        'Merged multi-OCR path',
        `Merged ${mergeable.length} strong OCR engines (layout-first)`,
        mergeable.flatMap((u) => u.ais),
        enabled,
        ban,
      ),
    )
  }

  // Dedicated structured-engine pass on best OCR text
  parses.push(
    parseFromText(
      topOcr[0].text,
      'Receipt engine on best OCR',
      'Structured arithmetic-first engine',
      topOcr[0].ais,
      enabled,
      ban,
    ),
  )

  // Vision model structured answer (when Oracle actually read the page)
  if (oracleStructured && !oracleStructured.unavailable) {
    try {
      const { oracleToLocalResult } = await import('./oracleVlm')
      const or = oracleToLocalResult(oracleStructured)
      if (or) {
        // Engine polish on Oracle's synthetic dump can lock arithmetic
        const engOnOracle = runReceiptEngine(oracleStructured.text, { ban })
        if (
          engOnOracle.amount != null &&
          (engOnOracle.confidence ?? 0) >= (or.confidence ?? 0) - 0.1
        ) {
          parses.push({
            ...or,
            ...engOnOracle,
            vendor: engOnOracle.vendor || or.vendor,
            date: engOnOracle.date || or.date,
            amount: engOnOracle.amount ?? or.amount,
            lineItems:
              (engOnOracle.lineItems?.length ?? 0) >= (or.lineItems?.length ?? 0)
                ? engOnOracle.lineItems
                : or.lineItems,
            confidence: Math.max(or.confidence ?? 0, engOnOracle.confidence ?? 0) + 0.05,
            aisUsed: ['oracle', 'ledger', 'cashier', 'clerk', 'arbiter'],
            activeAiLabel: 'Oracle vision + receipt engine',
            agentReport: [
              or.agentReport,
              '---',
              engOnOracle.agentReport,
            ].join('\n'),
            fieldSources: {
              ...or.fieldSources,
              primary: 'oracle',
              ocr: 'oracle',
              answerLabel: 'Oracle vision + structured engine',
            },
          })
        } else {
          parses.push(or)
        }
      }
    } catch {
      /* oracle structured optional */
    }
  }

  // Council / smart-pass text: prefer best single path, enrich from near-peers only
  let councilText = topOcr[0].text
  for (let i = 1; i < mergeable.length; i++) {
    councilText = mergeOcrTexts(councilText, mergeable[i].text)
  }
  // If merge is worse than the best single dump, stick with best alone
  if (scoreOcrText(councilText) < bestScore * 0.9) {
    councilText = topOcr[0].text
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
    'oracle',
    'sieve',
    'quorum',
    'council',
    'seeker',
  ] as AiId[]) {
    if (enabled(id)) ranIds.add(id)
  }
  if (oracleStructured && !oracleStructured.unavailable) ranIds.add('oracle')
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

  // ── Structured engine final polish on best text (with ban on retry) ──
  try {
    const eng = runReceiptEngine(councilText || final.rawText || '', {
      ban,
      preferTotal:
        rejected?.marks?.total === 'right' ? rejected.amount : undefined,
      preferVendor:
        rejected?.marks?.vendor === 'right' ? rejected.vendor : undefined,
    })
    // If final still matches rejected total and eng has a different one, take eng
    if (
      rejected &&
      rejected.amount != null &&
      final.amount != null &&
      Math.abs(final.amount - rejected.amount) < 0.05 &&
      eng.amount != null &&
      Math.abs(eng.amount - rejected.amount) > 0.05
    ) {
      final = {
        ...final,
        ...eng,
        fieldSources: { ...final.fieldSources, ...eng.fieldSources },
        agentReport: [final.agentReport, '---', 'Engine overrode repeated rejected total', eng.agentReport].join(
          '\n',
        ),
      }
    } else if ((eng.confidence ?? 0) >= (final.confidence ?? 0) - 0.05 && eng.amount != null) {
      // Merge stronger engine fields
      final = {
        ...final,
        amount: final.amount ?? eng.amount,
        vendor: final.vendor || eng.vendor,
        subtotal: final.subtotal ?? eng.subtotal,
        tax: final.tax ?? eng.tax,
        lineItems:
          (eng.lineItems?.length ?? 0) >= (final.lineItems?.length ?? 0)
            ? eng.lineItems
            : final.lineItems,
        confidence: Math.max(final.confidence ?? 0, eng.confidence ?? 0),
        agentReport: [final.agentReport, '---', eng.agentReport].join('\n'),
      }
    }
  } catch {
    /* engine polish optional */
  }

  // Hard ban: never return the exact rejected total if we have any alternate
  if (
    rejected?.amount != null &&
    final.amount != null &&
    Math.abs(final.amount - rejected.amount) < 0.05 &&
    (rejected.marks?.total === 'wrong' || !rejected.marks)
  ) {
    const alt = parses.find(
      (p) =>
        p.amount != null && Math.abs(p.amount - rejected.amount!) > 0.08,
    )
    if (alt) {
      final = {
        ...alt,
        fieldSources: { ...final.fieldSources, ...alt.fieldSources },
        agentReport: [
          final.agentReport,
          'HARD BAN: previous total was marked wrong — switched to alternate parse',
          alt.agentReport,
        ].join('\n'),
      }
    }
  }

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
    // Re-apply hard ban after consensus (it can reintroduce a banned total)
    if (
      rejected?.amount != null &&
      final.amount != null &&
      Math.abs(final.amount - rejected.amount) < 0.05 &&
      (rejected.marks?.total === 'wrong' || !rejected.marks)
    ) {
      const alt = rankedPaths.find(
        (p) => p.amount != null && Math.abs(p.amount - rejected.amount!) > 0.08,
      )
      if (alt?.amount != null) {
        final = {
          ...final,
          amount: alt.amount,
          agentReport: [
            final.agentReport,
            `Post-consensus ban: total forced to $${alt.amount.toFixed(2)}`,
          ].join('\n'),
        }
      }
    }
  } catch (e) {
    final.agentReport = [
      final.agentReport,
      `Consensus skipped: ${e instanceof Error ? e.message : 'error'}`,
    ].join('\n')
  }

  // Prefer strong Oracle vision answer when classic OCR still looks thin
  if (oracleStructured && !oracleStructured.unavailable && oracleStructured.amount != null) {
    const oracleParse = parses.find((p) => p.aisUsed?.includes('oracle') && p.amount != null)
    const ocrLooksThin =
      scoreOcrText(councilText || final.rawText || '') < 70 ||
      !/\b(grand\s+)?t[o0]tal\b|\bamount\s+due\b/i.test(councilText || final.rawText || '')
    const oracleStrong =
      (oracleStructured.confidence ?? 0) >= 0.55 &&
      (oracleParse?.confidence ?? oracleStructured.confidence) >= (final.confidence ?? 0) - 0.08
    if (oracleParse && (ocrLooksThin || oracleStrong)) {
      final = {
        ...oracleParse,
        // Keep any better product names from prior if Oracle items empty
        lineItems:
          (oracleParse.lineItems?.length ?? 0) > 0
            ? oracleParse.lineItems
            : final.lineItems,
        agentReport: [
          final.agentReport,
          '---',
          'Preferred Oracle vision read (model looked at the page, not only OCR text)',
          oracleParse.agentReport,
        ].join('\n'),
        fieldSources: {
          ...final.fieldSources,
          ...oracleParse.fieldSources,
          primary: 'oracle',
          ocr: 'oracle',
          answerLabel: 'Oracle vision document reader',
        },
        activeAiLabel: 'Oracle · vision document reader',
        confidence: Math.max(final.confidence ?? 0, oracleParse.confidence ?? 0),
      }
    }
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

export type ImagePrepOptions = {
  /** Cap longest edge (downscale huge camera photos). Default 2000. */
  maxEdge?: number
  /** Upscale short edge up to this when the photo is small (phone crops). Default 1400. */
  minEdge?: number
}

/**
 * Receipt-oriented image prep for OCR (proper path, not a hack):
 * 1) Upscale small shots (Tesseract needs ~readable pixel height per character)
 * 2) Downscale huge shots to a workable size
 * 3) Grayscale + percentile contrast stretch (handles dim / glare thermal paper)
 * 4) Mild unsharp mask so thin digits stay crisp
 */
export async function prepareImageForOcr(
  blob: Blob,
  maxEdgeOrOpts: number | ImagePrepOptions = 1600,
): Promise<Blob> {
  const opts: ImagePrepOptions =
    typeof maxEdgeOrOpts === 'number'
      ? { maxEdge: maxEdgeOrOpts, minEdge: 1200 }
      : maxEdgeOrOpts
  const maxEdge = opts.maxEdge ?? 2000
  const minEdge = opts.minEdge ?? 1400

  const bitmap = await createImageBitmap(blob)
  try {
    const srcW = bitmap.width
    const srcH = bitmap.height
    const long = Math.max(srcW, srcH)
    const short = Math.min(srcW, srcH)
    // Upscale small / cropped photos; never exceed maxEdge on the long side
    let scale = 1
    if (short > 0 && short < minEdge) {
      scale = minEdge / short
    }
    if (long * scale > maxEdge) {
      scale = maxEdge / long
    }
    // Keep scale sane (avoid huge memory on weird inputs)
    scale = Math.min(3, Math.max(0.25, scale))
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas unavailable')
    // High-quality resample when upscaling
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)

    try {
      const img = ctx.getImageData(0, 0, w, h)
      const d = img.data
      const n = w * h
      // Build luminance histogram (downsample sample for speed on big images)
      const step = n > 800_000 ? 4 : n > 300_000 ? 2 : 1
      const samples: number[] = []
      for (let p = 0; p < n; p += step) {
        const i = p * 4
        samples.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
      }
      samples.sort((a, b) => a - b)
      const pct = (p: number) =>
        samples[Math.min(samples.length - 1, Math.max(0, Math.floor(p * (samples.length - 1))))] ??
        0
      // Clip extremes (glare / black borders) then stretch midtones
      let lo = pct(0.02)
      let hi = pct(0.98)
      if (hi - lo < 28) {
        // Almost flat image — force a wider window around the median
        const mid = pct(0.5)
        lo = Math.max(0, mid - 40)
        hi = Math.min(255, mid + 40)
      }
      const range = Math.max(1, hi - lo)

      // Pass 1: grayscale + contrast stretch into gray[]
      const gray = new Float32Array(n)
      for (let p = 0; p < n; p++) {
        const i = p * 4
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        gray[p] = ((y - lo) / range) * 255
      }

      // Pass 2: mild unsharp mask (gray - blur) to keep thin thermal digits
      const sharpened = new Float32Array(n)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x
          // 3×3 box blur sample
          let sum = 0
          let c = 0
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy
            if (yy < 0 || yy >= h) continue
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx
              if (xx < 0 || xx >= w) continue
              sum += gray[yy * w + xx]
              c++
            }
          }
          const blur = c ? sum / c : gray[p]
          const amount = 0.55
          sharpened[p] = gray[p] + amount * (gray[p] - blur)
        }
      }

      for (let p = 0; p < n; p++) {
        const v = Math.max(0, Math.min(255, sharpened[p]))
        const i = p * 4
        d[i] = d[i + 1] = d[i + 2] = v
        // alpha unchanged
      }
      ctx.putImageData(img, 0, 0)
    } catch {
      /* putImageData may fail on huge images — resized draw is still fine */
    }

    return await new Promise<Blob>((resolve, reject) => {
      // PNG avoids extra JPEG mosquito noise on fine text after prep
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('encode'))),
        'image/png',
      )
    })
  } finally {
    bitmap.close()
  }
}

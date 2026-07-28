/**
 * User rejected a scan (pressed Try again).
 * Free AIs use this so a retry does not blindly return the same answer.
 */
import type { CategoryId, ReceiptLineItem } from '../types'
import type { LocalAgentResult } from './pipeline'
import { roundMoney } from './moneyParse'

export type RejectedScanSnapshot = {
  amount: number | null
  vendor: string
  description: string
  categoryId?: CategoryId
  lineItems: Array<{ description: string; amount: number; categoryId?: CategoryId }>
  subtotal?: number | null
  tax?: number | null
  confidence?: number
  rawText?: string
  /** How many times the user has already rejected a result for this photo */
  attempt: number
  /** Optional free-text from the form (what looked wrong) */
  userNote?: string
}

export function snapshotFromSuggestion(input: {
  amount?: number | null
  vendor?: string
  description?: string
  categoryId?: CategoryId
  lineItems?: ReceiptLineItem[]
  subtotal?: number | null
  tax?: number | null
  confidence?: number
  rawText?: string
  attempt?: number
  userNote?: string
}): RejectedScanSnapshot {
  return {
    amount: input.amount ?? null,
    vendor: input.vendor ?? '',
    description: input.description ?? '',
    categoryId: input.categoryId,
    lineItems: (input.lineItems ?? []).map((li) => ({
      description: li.description,
      amount: li.amount,
      categoryId: li.categoryId,
    })),
    subtotal: input.subtotal ?? null,
    tax: input.tax ?? null,
    confidence: input.confidence,
    rawText: input.rawText,
    attempt: input.attempt ?? 1,
    userNote: input.userNote,
  }
}

function nearly(a: number, b: number, tol = 0.05): boolean {
  return Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.01)
}

function amountSet(items: Array<{ amount: number }>): string {
  return items
    .map((i) => roundMoney(i.amount).toFixed(2))
    .sort()
    .join('|')
}

function descKey(d: string): string {
  return d
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 48)
}

/**
 * 0 = totally different, 1 = essentially the same answer the user already rejected.
 */
export function similarityToRejected(
  result: Pick<LocalAgentResult, 'amount' | 'vendor' | 'description' | 'lineItems'>,
  rejected: RejectedScanSnapshot,
): number {
  let score = 0
  let weight = 0

  // Totals
  weight += 0.35
  if (result.amount != null && rejected.amount != null) {
    if (nearly(result.amount, rejected.amount)) score += 0.35
    else if (Math.abs(result.amount - rejected.amount) < rejected.amount * 0.05) score += 0.15
  } else if (result.amount == null && rejected.amount == null) {
    score += 0.1
  }

  // Line item amount multiset
  weight += 0.4
  const a = amountSet(result.lineItems ?? [])
  const b = amountSet(rejected.lineItems)
  if (a && b && a === b) score += 0.4
  else if (a && b) {
    const sa = new Set(a.split('|'))
    const sb = new Set(b.split('|'))
    let inter = 0
    for (const x of sa) if (sb.has(x)) inter++
    const union = new Set([...sa, ...sb]).size || 1
    score += 0.4 * (inter / union)
  }

  // Descriptions overlap
  weight += 0.15
  const da = new Set((result.lineItems ?? []).map((i) => descKey(i.description)).filter(Boolean))
  const db = new Set(rejected.lineItems.map((i) => descKey(i.description)).filter(Boolean))
  if (da.size && db.size) {
    let inter = 0
    for (const x of da) if (db.has(x)) inter++
    score += 0.15 * (inter / Math.max(da.size, db.size))
  } else if (
    result.description &&
    rejected.description &&
    descKey(result.description) === descKey(rejected.description)
  ) {
    score += 0.12
  }

  // Vendor
  weight += 0.1
  const va = (result.vendor || '').toLowerCase().trim()
  const vb = (rejected.vendor || '').toLowerCase().trim()
  if (va && vb && (va === vb || va.includes(vb) || vb.includes(va))) score += 0.1

  return Math.min(1, score / Math.max(0.5, weight) * weight)
}

/** Human-readable brief for agent reports */
export function formatRejectionBrief(rejected: RejectedScanSnapshot): string {
  const items =
    rejected.lineItems.length > 0
      ? rejected.lineItems
          .map((i) => `${i.description.slice(0, 40)} $${i.amount.toFixed(2)}`)
          .join('; ')
      : rejected.description || '(no items)'
  const total =
    rejected.amount != null ? `$${rejected.amount.toFixed(2)}` : 'unknown total'
  const note = rejected.userNote ? ` User note: ${rejected.userNote}` : ''
  return `USER REJECTED attempt #${rejected.attempt}: total ${total}, vendor “${rejected.vendor || '—'}”, lines: ${items}.${note} Do NOT return the same answer — find a better reading.`
}

/**
 * Pick the best parse that is not a near-clone of the rejected answer.
 * Falls back to least-similar among decent candidates.
 */
export function pickDiversifiedParse(
  candidates: LocalAgentResult[],
  rejected: RejectedScanSnapshot | undefined,
  baseScore: (c: LocalAgentResult) => number,
): { winner: LocalAgentResult; report: string } {
  if (!candidates.length) {
    throw new Error('No parse candidates')
  }
  if (!rejected) {
    let best = candidates[0]
    let bestS = baseScore(best)
    for (let i = 1; i < candidates.length; i++) {
      const s = baseScore(candidates[i])
      if (s > bestS) {
        best = candidates[i]
        bestS = s
      }
    }
    return { winner: best, report: `Picked best parse (score ${bestS.toFixed(1)})` }
  }

  const scored = candidates.map((c, i) => {
    const quality = baseScore(c)
    const sim = similarityToRejected(c, rejected)
    // Heavy penalty for cloning the rejected answer
    const penalty = sim * (45 + rejected.attempt * 10)
    return { c, i, quality, sim, adjusted: quality - penalty }
  })
  scored.sort((a, b) => b.adjusted - a.adjusted || b.quality - a.quality)

  // Prefer adjusted winner if not almost identical; else least-similar with ok quality
  let pick = scored[0]
  if (pick.sim >= 0.85) {
    const alt = scored
      .filter((s) => s.sim < 0.75 && s.quality >= pick.quality * 0.55)
      .sort((a, b) => b.adjusted - a.adjusted)[0]
    if (alt) pick = alt
    else {
      // take lowest similarity
      const least = [...scored].sort((a, b) => a.sim - b.sim || b.quality - a.quality)[0]
      if (least.sim < pick.sim) pick = least
    }
  }

  const report = [
    formatRejectionBrief(rejected),
    `Diversified pick: candidate #${pick.i + 1} quality ${pick.quality.toFixed(1)}, similarity-to-rejected ${(pick.sim * 100).toFixed(0)}%, adjusted ${pick.adjusted.toFixed(1)}`,
    `Other candidates: ${scored
      .slice(0, 4)
      .map(
        (s) =>
          `#${s.i + 1} q=${s.quality.toFixed(0)} sim=${(s.sim * 100).toFixed(0)}% adj=${s.adjusted.toFixed(0)}`,
      )
      .join(' · ')}`,
  ].join('\n')

  return { winner: pick.c, report }
}

/**
 * Mild image transforms so OCR on retry is not bit-identical.
 * attempt 1 = stronger contrast, 2 = slight scale+sharpen feel, 3 = invert-ish soft
 */
export async function diversifyImageForRetry(
  blob: Blob,
  attempt: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const maxEdge = 1900
    const base = Math.min(1.15 + attempt * 0.08, maxEdge / Math.max(bitmap.width, bitmap.height, 1))
    // tiny rotation alternate so layout bands shift a bit
    const rotDeg = attempt % 2 === 0 ? 0.4 : -0.35
    const rot = (rotDeg * Math.PI) / 180
    const w0 = Math.max(1, Math.round(bitmap.width * base))
    const h0 = Math.max(1, Math.round(bitmap.height * base))
    const pad = Math.ceil(Math.max(w0, h0) * 0.02)
    const w = w0 + pad * 2
    const h = h0 + pad * 2
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.translate(w / 2, h / 2)
    ctx.rotate(rot)
    ctx.drawImage(bitmap, -w0 / 2, -h0 / 2, w0, h0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    const imageData = ctx.getImageData(0, 0, w, h)
    const d = imageData.data
    const mode = attempt % 3
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      if (mode === 0) {
        g = Math.min(255, Math.max(0, (g - 128) * 1.55 + 128))
      } else if (mode === 1) {
        g = g > 145 ? 255 : g < 110 ? 0 : (g - 110) * (255 / 35)
      } else {
        const boosted = Math.min(255, Math.max(0, (g - 120) * 1.35 + 120))
        g = 255 - boosted * 0.15 + boosted * 0.85 // soft punch
      }
      d[i] = d[i + 1] = d[i + 2] = g
    }
    ctx.putImageData(imageData, 0, 0)

    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.92)
    })
  } finally {
    bitmap.close()
  }
}

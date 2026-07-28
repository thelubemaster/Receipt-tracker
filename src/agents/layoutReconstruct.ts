/**
 * Layout reconstruction — turn OCR word boxes into real document lines.
 * Groups words by vertical band (same receipt row), sorts left→right,
 * and keeps prices on the same visual line as product names.
 */

export type OcrWordBox = {
  text: string
  /** Bounding box in image pixels */
  x0: number
  y0: number
  x1: number
  y1: number
  confidence?: number
}

export type LayoutLine = {
  text: string
  yMid: number
  x0: number
  x1: number
  words: OcrWordBox[]
  /** True when a money amount sits on the right half of this band */
  hasRightPrice: boolean
  amount?: number | null
}

const MONEY_RE = /^\$?\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})$/

function isMoneyToken(t: string): boolean {
  const s = t.replace(/\s/g, '')
  return MONEY_RE.test(s) || /^\$?\d+[.,]\d{2}$/.test(s)
}

function wordMidY(w: OcrWordBox): number {
  return (w.y0 + w.y1) / 2
}

function wordH(w: OcrWordBox): number {
  return Math.max(1, w.y1 - w.y0)
}

/**
 * Cluster words into horizontal bands (receipt rows) by Y midpoints.
 * Tolerance scales with median word height so tall/small text both work.
 */
export function clusterWordsIntoRows(words: OcrWordBox[]): OcrWordBox[][] {
  const usable = words
    .filter((w) => {
      const t = (w.text || '').trim()
      if (!t) return false
      if ((w.confidence ?? 100) < 25 && !isMoneyToken(t)) return false
      return true
    })
    .slice()
    .sort((a, b) => wordMidY(a) - wordMidY(b) || a.x0 - b.x0)

  if (!usable.length) return []

  const heights = usable.map(wordH).sort((a, b) => a - b)
  const medianH = heights[Math.floor(heights.length / 2)] || 12
  const tol = Math.max(6, medianH * 0.55)

  const rows: OcrWordBox[][] = []
  let cur: OcrWordBox[] = [usable[0]]
  let curY = wordMidY(usable[0])

  for (let i = 1; i < usable.length; i++) {
    const w = usable[i]
    const y = wordMidY(w)
    if (Math.abs(y - curY) <= tol) {
      cur.push(w)
      // running average so a tall row doesn't drift forever
      curY = cur.reduce((s, x) => s + wordMidY(x), 0) / cur.length
    } else {
      rows.push(cur)
      cur = [w]
      curY = y
    }
  }
  rows.push(cur)
  return rows
}

function parseAmountFromText(s: string): number | null {
  const m = s.match(/\$?\s*(\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})/)
  if (!m) return null
  let raw = m[1]
  if (raw.includes(',') && raw.includes('.')) {
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
      raw = raw.replace(/\./g, '').replace(',', '.')
    } else {
      raw = raw.replace(/,/g, '')
    }
  } else if (/^\d+,\d{2}$/.test(raw)) {
    raw = raw.replace(',', '.')
  } else {
    raw = raw.replace(/,/g, '')
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || n >= 100000) return null
  return Math.round(n * 100) / 100
}

/**
 * Build one layout line from a row of words (left→right).
 * Inserts a space between tokens; keeps multi-price rows intact.
 */
export function rowToLayoutLine(row: OcrWordBox[], pageWidth: number): LayoutLine {
  const sorted = row.slice().sort((a, b) => a.x0 - b.x0)
  const tokens: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i].text.trim()
    if (!t) continue
    // glue "$" + "12.99" that OCR split
    if (tokens.length && tokens[tokens.length - 1] === '$' && /^\d/.test(t)) {
      tokens[tokens.length - 1] = `$${t}`
      continue
    }
    tokens.push(t)
  }
  const text = tokens.join(' ').replace(/\s{2,}/g, ' ').trim()

  const x0 = Math.min(...sorted.map((w) => w.x0))
  const x1 = Math.max(...sorted.map((w) => w.x1))
  const yMid = sorted.reduce((s, w) => s + wordMidY(w), 0) / sorted.length

  const rightEdge = pageWidth > 0 ? pageWidth * 0.55 : x0 + (x1 - x0) * 0.55
  const rightMoney = sorted.filter((w) => isMoneyToken(w.text) && w.x0 >= rightEdge)
  const amount =
    parseAmountFromText(rightMoney.map((w) => w.text).join(' ')) ??
    parseAmountFromText(text)

  return {
    text,
    yMid,
    x0,
    x1,
    words: sorted,
    hasRightPrice: rightMoney.length > 0,
    amount,
  }
}

/**
 * Pull orphan right-column prices onto nearby description rows.
 * OCR often puts "39.97" one band below the product name.
 */
export function attachOrphanPrices(lines: LayoutLine[], _pageWidth = 0): LayoutLine[] {
  void _pageWidth
  if (lines.length < 2) return lines
  const out: LayoutLine[] = lines.map((l) => ({ ...l, words: [...l.words] }))
  const medianH =
    out
      .map((l) => {
        const hs = l.words.map(wordH)
        return hs.reduce((a, b) => a + b, 0) / Math.max(1, hs.length)
      })
      .sort((a, b) => a - b)[Math.floor(out.length / 2)] || 14

  for (let i = 0; i < out.length; i++) {
    const line = out[i]
    const onlyPrice =
      isMoneyToken(line.text.replace(/\s/g, '')) ||
      (/^\$?\s*\d+[.,]\d{2}\s*$/.test(line.text) && !/[A-Za-z]{3,}/.test(line.text))
    const qtyPriceOnly = /^\d+\s+\$?\d+[.,]\d{2}(?:\s+\$?\d+[.,]\d{2})?$/.test(line.text.trim())

    if (!(onlyPrice || qtyPriceOnly) || !line.amount) continue

    // Prefer nearest previous line with product-ish words and no price
    let best = -1
    let bestDist = Infinity
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      const prev = out[j]
      if (!/[A-Za-z]{3,}/.test(prev.text)) continue
      if (prev.hasRightPrice && prev.amount != null) continue
      if (/\b(subtotal|total|tax|shipping|payment|invoice|grand)\b/i.test(prev.text)) continue
      const dist = Math.abs(line.yMid - prev.yMid)
      if (dist < bestDist && dist <= medianH * 4.5) {
        bestDist = dist
        best = j
      }
    }
    if (best < 0) continue

    const target = out[best]
    // Append price to description row
    const priceBit = line.text.trim()
    if (!target.text.includes(priceBit)) {
      target.text = `${target.text} ${priceBit}`.replace(/\s{2,}/g, ' ').trim()
    }
    target.hasRightPrice = true
    target.amount = line.amount
    target.x1 = Math.max(target.x1, line.x1)
    // mark orphan as absorbed
    out[i] = {
      ...line,
      text: '',
      amount: null,
      hasRightPrice: false,
      words: [],
    }
  }

  return out.filter((l) => l.text.trim().length > 0)
}

/**
 * Merge consecutive description-only rows that sit above a priced product row
 * into one line (multi-line product names on online order screenshots).
 */
export function foldDescriptionBlocks(lines: LayoutLine[]): LayoutLine[] {
  const out: LayoutLine[] = []
  let buffer: LayoutLine[] = []

  const flushInto = (priced: LayoutLine) => {
    if (!buffer.length) {
      out.push(priced)
      return
    }
    const desc = buffer
      .map((b) => b.text)
      .filter((t) => !/\b(shipped to|pennsylvania|bangor|cart items|sku|qty)\b/i.test(t))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    const mergedText = desc
      ? `${desc} ${priced.text}`.replace(/\s{2,}/g, ' ').trim()
      : priced.text
    out.push({
      ...priced,
      text: mergedText,
      yMid: buffer[0].yMid,
      x0: Math.min(buffer[0].x0, priced.x0),
      words: [...buffer.flatMap((b) => b.words), ...priced.words],
    })
    buffer = []
  }

  for (const line of lines) {
    const isMeta =
      /\b(subtotal|grand total|total|tax|shipping|payment|invoice|payer|cart items|item price|order contains|powered by)\b/i.test(
        line.text,
      )
    if (isMeta) {
      // drop buffer onto previous if any, then emit meta as-is
      if (buffer.length) {
        out.push({
          ...buffer[0],
          text: buffer
            .map((b) => b.text)
            .join(' ')
            .replace(/\s{2,}/g, ' ')
            .trim(),
          words: buffer.flatMap((b) => b.words),
        })
        buffer = []
      }
      out.push(line)
      continue
    }

    const hasPrice =
      line.hasRightPrice ||
      line.amount != null ||
      /\$?\d+[.,]\d{2}/.test(line.text)

    if (hasPrice && /[A-Za-z]{2,}/.test(line.text)) {
      flushInto(line)
    } else if (hasPrice && !/[A-Za-z]{3,}/.test(line.text)) {
      // price-only after buffer
      flushInto(line)
    } else if (/[A-Za-z]{2,}/.test(line.text) && line.text.length < 90) {
      if (buffer.length < 8) buffer.push(line)
      else {
        out.push(buffer.shift()!)
        buffer.push(line)
      }
    } else {
      if (buffer.length) {
        out.push({
          ...buffer[0],
          text: buffer
            .map((b) => b.text)
            .join(' ')
            .replace(/\s{2,}/g, ' ')
            .trim(),
          words: buffer.flatMap((b) => b.words),
        })
        buffer = []
      }
      out.push(line)
    }
  }

  if (buffer.length) {
    out.push({
      ...buffer[0],
      text: buffer
        .map((b) => b.text)
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim(),
      words: buffer.flatMap((b) => b.words),
    })
  }

  return out
}

/**
 * Full pipeline: words → document lines → orphan price attach → fold multi-line names.
 */
export function reconstructDocumentText(
  words: OcrWordBox[],
  pageWidth = 0,
  pageHeight = 0,
): { text: string; lines: LayoutLine[] } {
  void pageHeight
  const width =
    pageWidth ||
    (words.length ? Math.max(...words.map((w) => w.x1), 1) : 1)

  const rows = clusterWordsIntoRows(words)
  let layoutLines = rows.map((r) => rowToLayoutLine(r, width))
  layoutLines = attachOrphanPrices(layoutLines, width)
  layoutLines = foldDescriptionBlocks(layoutLines)

  const text = layoutLines.map((l) => l.text).join('\n')
  return { text, lines: layoutLines }
}

/**
 * Score how "receipt-like" reconstructed text is (more lines with money = better).
 */
export function scoreLayoutText(text: string): number {
  const lines = text.split(/\n/).filter((l) => l.trim())
  const moneyLines = lines.filter((l) => /\d+[.,]\d{2}/.test(l)).length
  const productish = lines.filter(
    (l) => /[A-Za-z]{3,}/.test(l) && /\d+[.,]\d{2}/.test(l),
  ).length
  const letters = (text.match(/[A-Za-z]/g) || []).length
  return lines.length * 1.5 + moneyLines * 8 + productish * 12 + Math.min(letters, 900) * 0.04
}

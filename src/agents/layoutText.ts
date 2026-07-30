/**
 * Reconstruct readable receipt/invoice lines from flat text or PDF glyph positions.
 * Digital invoices often come as a soup of tokens — we rebuild rows by Y then X.
 */

export type TextGlyph = {
  str: string
  x: number
  y: number
  w?: number
  h?: number
}

export type LayoutLine = {
  text: string
  y: number
  x0: number
  x1: number
}

/** Group PDF text items into visual lines (top→bottom, L→R). */
export function linesFromGlyphs(glyphs: TextGlyph[], yTol = 3.5): LayoutLine[] {
  const usable = glyphs
    .map((g) => ({
      str: (g.str || '').replace(/\s+/g, ' '),
      x: g.x,
      y: g.y,
      w: g.w ?? 0,
      h: g.h ?? 0,
    }))
    .filter((g) => g.str.trim().length > 0)

  if (!usable.length) return []

  // PDF Y often increases upward — sort by descending Y (top first), then X
  usable.sort((a, b) => b.y - a.y || a.x - b.x)

  const rows: { y: number; parts: { x: number; str: string; w: number }[] }[] = []
  for (const g of usable) {
    const row = rows.find((r) => Math.abs(r.y - g.y) <= yTol)
    if (row) {
      row.parts.push({ x: g.x, str: g.str, w: g.w })
      // keep average y for tolerance stability
      row.y = (row.y * (row.parts.length - 1) + g.y) / row.parts.length
    } else {
      rows.push({ y: g.y, parts: [{ x: g.x, str: g.str, w: g.w }] })
    }
  }

  // top to bottom: higher y first already; if coordinate system is flipped, still ok after sort
  rows.sort((a, b) => b.y - a.y)

  return rows.map((r) => {
    r.parts.sort((a, b) => a.x - b.x)
    // Join with space; collapse double spaces; keep money glued if adjacent
    let text = ''
    let prevEnd = -Infinity
    for (const p of r.parts) {
      const gap = p.x - prevEnd
      if (text && gap > 1.2) text += ' '
      text += p.str.trim()
      prevEnd = p.x + (p.w || p.str.length * 4)
    }
    text = text.replace(/\s{2,}/g, ' ').trim()
    const x0 = r.parts[0]?.x ?? 0
    const last = r.parts[r.parts.length - 1]
    const x1 = (last?.x ?? 0) + (last?.w ?? 0)
    return { text, y: r.y, x0, x1 }
  }).filter((l) => l.text.length > 0)
}

/**
 * Normalize messy OCR/PDF text into clean line array:
 * - split on newlines
 * - also split glued "LABEL$12.00" patterns
 * - merge orphan amount-only lines with previous label
 */
export function normalizeToLines(raw: string): string[] {
  if (!raw) return []
  let t = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Soft break before money if glued: TOTAL$12.00 → TOTAL $12.00
  t = t.replace(/([A-Za-z])(\$\d)/g, '$1 $2')
  t = t.replace(/([A-Za-z])(\d+[.,]\d{2})\b/g, '$1 $2')
  // Break after amount before capital word (common OCR glue)
  t = t.replace(/(\d+[.,]\d{2})([A-Z][A-Za-z]{2,})/g, '$1\n$2')

  const rough = t
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const out: string[] = []
  for (let i = 0; i < rough.length; i++) {
    const line = rough[i]
    const next = rough[i + 1]
    // Label alone + amount alone → join
    if (
      next &&
      !/\$?\s*\d+[.,]\d{2}/.test(line) &&
      /^(subtotal|total|tax|shipping|freight|amount due|balance due|invoice|qty|quantity|description|unit price|amount)$/i.test(
        line,
      ) &&
      /^\$?\s*[\d,]+(?:\.\d{2})?\s*$/.test(next)
    ) {
      out.push(`${line} ${next}`)
      i++
      continue
    }
    out.push(line)
  }
  return out
}

/** Prefer layout lines if available; else normalize raw text. */
export function materializeLines(
  rawText: string,
  layoutLines?: LayoutLine[] | null,
): string[] {
  if (layoutLines && layoutLines.length >= 3) {
    return layoutLines.map((l) => l.text).filter(Boolean)
  }
  return normalizeToLines(rawText)
}

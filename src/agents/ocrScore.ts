/**
 * Shared OCR quality scoring — rewards real receipt structure over noise dumps.
 */

export function scoreOcrText(text: string): number {
  if (!text) return 0
  const lines = text.split(/\n/).filter((l) => l.trim()).length
  const money = (text.match(/\d+[.,]\d{2}/g) || []).length
  const letters = (text.match(/[A-Za-z]/g) || []).length
  let s = lines * 2 + money * 8 + Math.min(letters, 1200) * 0.04
  // Strong signal: labeled total / tax / subtotal lines
  if (/\bamount\s+due\b|\bbalance\s+due\b/i.test(text)) s += 14
  if (/\bgrand\s+t[o0]tal\b/i.test(text)) s += 16
  // TOTAL without SUBTOTAL on the same short match window
  if (/\bt[o0]tal\b/i.test(text)) {
    // Count TOTAL lines that aren't subtotal
    const totalLines = text
      .split(/\n/)
      .filter((l) => /\bt[o0]tal\b/i.test(l) && !/\bsub[\s\-]*t[o0]tal\b/i.test(l)).length
    s += Math.min(20, totalLines * 10)
  }
  if (/\bsub[\s\-]*t[o0]tal\b/i.test(text)) s += 10
  if (/\b(sales\s*)?tax\b|\bvat\b|\bgst\b/i.test(text)) s += 8
  // Layout: product-like rows (words + money on same line)
  const productish = text
    .split(/\n/)
    .filter((l) => /[A-Za-z]{3,}/.test(l) && /\d+[.,]\d{2}/.test(l)).length
  s += Math.min(24, productish * 4)
  // Penalize pure garbage (almost no money tokens)
  if (money === 0) s *= 0.35
  if (money === 1 && lines > 15) s *= 0.7
  return s
}

/**
 * OCR confusable cleanup for thermal / phone-photo receipts.
 *
 * Common failures we saw on invented noisy dumps:
 * - T0TAL / SUBT0TAL → total never matched; subtotal+tax (72.01) beat real 74.00
 * - C0NVENIENCE FEE → fee section missed
 * - H0ME DEP0T → vendor fell through to "VISA CHIP"
 * - R0MEX / 0IL / F0AM → invented garbage categories like "r0mex"
 *
 * Rule of thumb: only rewrite 0→O (and O→0 in money) when next to letters,
 * never rewrite pure money amounts like 10.00 or part codes like 5W30.
 */

/** Whole-phrase brand / label fixes (case-insensitive). */
const PHRASE_FIXES: [RegExp, string][] = [
  [/\bH[O0]ME\s+DEP[O0]T\b/gi, 'HOME DEPOT'],
  [/\bSUB[\s\-]*T[O0]TAL\b/gi, 'SUBTOTAL'],
  [/\bGRAND\s+T[O0]TAL\b/gi, 'GRAND TOTAL'],
  [/\bT[O0]TAL\b/gi, 'TOTAL'],
  [/\bC[O0]NVENIENCE\b/gi, 'CONVENIENCE'],
  [/\bR[O0]MEX\b/gi, 'ROMEX'],
  [/\bAUT[O0]\b/gi, 'AUTO'],
  [/\bST[O0]RE\b/gi, 'STORE'],
  [/\b0IL\b/gi, 'OIL'],
  [/\bF[O0]AM\b/gi, 'FOAM'],
  [/\bB[O0]X\b/gi, 'BOX'],
  [/\bDEP[O0]T\b/gi, 'DEPOT'],
  [/\bL[O0]WE'?S\b/gi, "LOWE'S"],
  [/\bMENARDS?\b/gi, 'MENARDS'],
  [/\bHARB[O0]R\s+FREIGHT\b/gi, 'HARBOR FREIGHT'],
  [/\bPR[O0]CESSING\b/gi, 'PROCESSING'],
  [/\bSHIPP[I1]NG\b/gi, 'SHIPPING'],
  [/\bAM[O0]UNT\s+DUE\b/gi, 'AMOUNT DUE'],
  [/\bBALA[N]CE\s+DUE\b/gi, 'BALANCE DUE'],
  // Extra consistency fixes (common thermal OCR)
  [/\bS[A4]LES?\s+T[A4]X\b/gi, 'SALES TAX'],
  [/\bT[A4]X\b/gi, 'TAX'],
  [/\bCH[A4]NGE\b/gi, 'CHANGE'],
  [/\bC[A4]SH\b/gi, 'CASH'],
  [/\bCRED[I1]T\b/gi, 'CREDIT'],
  [/\bD[E3]B[I1]T\b/gi, 'DEBIT'],
  [/\b[I1]TEM\b/gi, 'ITEM'],
  [/\bQ[T1]Y\b/gi, 'QTY'],
  [/\bW[A4]LM[A4]RT\b/gi, 'WALMART'],
  [/\bT[A4]RGET\b/gi, 'TARGET'],
  [/\b[A4]M[A4]Z[O0]N\b/gi, 'AMAZON'],
  [/\b[A4]UT[O0]Z[O0]NE\b/gi, 'AUTOZONE'],
  [/\b[O0]['’]?RE[I1]LLY\b/gi, "O'REILLY"],
  [/\bN[A4]P[A4]\b/gi, 'NAPA'],
  [/\bSERV[I1]CE\s+FEE\b/gi, 'SERVICE FEE'],
  [/\bHANDL[I1]NG\b/gi, 'HANDLING'],
]

/**
 * Inside a single token that has letters: 0 next to a letter → O.
 * Leaves 5W30, #4821, 10.00 alone.
 */
function fixZeroAsLetterO(token: string): string {
  if (!/[A-Za-z]/.test(token) || !/0/.test(token)) return token
  // Pure-ish SKU/part codes with more digits than letters: leave zeros
  const letters = (token.match(/[A-Za-z]/g) || []).length
  const digits = (token.match(/\d/g) || []).length
  if (digits > letters + 1) return token
  // 0 adjacent to a letter (T0TAL, 0IL, AUT0, H0ME)
  return token.replace(/0(?=[A-Za-z])|(?<=[A-Za-z])0/g, 'O')
}

/**
 * Money-ish: letter O next to digits → 0 (e.g. $48.9O, 1O.99).
 */
function fixLetterOAsZeroInMoney(token: string): string {
  if (!/[Oo]/.test(token) || !/\d/.test(token)) return token
  // Only when token looks like money / amount, not words like "FOAM"
  if (!/^\$?[\d.,Oo]+$/.test(token)) return token
  return token.replace(/[Oo]/g, '0')
}

function fixToken(token: string): string {
  let t = fixZeroAsLetterO(token)
  t = fixLetterOAsZeroInMoney(t)
  return t
}

/**
 * Normalize OCR dump before any parse agent runs.
 * Safe to call multiple times (idempotent for our rules).
 */
export function normalizeOcrText(text: string): string {
  if (!text) return text

  let out = text

  // Phrase-level known receipt labels first
  for (const [re, rep] of PHRASE_FIXES) {
    out = out.replace(re, rep)
  }

  // Token-level confusable fix (preserves whitespace / newlines)
  out = out.replace(/[^\s]+/g, (tok) => fixToken(tok))

  // Second pass on phrases in case token pass created HOME + DEPOT separately already handled
  for (const [re, rep] of PHRASE_FIXES) {
    out = out.replace(re, rep)
  }

  return out
}

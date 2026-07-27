/**
 * Seeker — free internet lookup agent (no API key).
 * Uses the app host's /api/web-lookup proxy (DuckDuckGo + Wikipedia).
 * Enriches weak SKU-like line items and vendors for the Council.
 */
import type { AiId } from '../aiRoster'
import type { ReceiptLineItem } from '../types'
import { categorizeText } from './keywords'
import type { LocalAgentResult } from './pipeline'

export type WebLookupResult = {
  ok: boolean
  query?: string
  summary?: string
  title?: string
  url?: string
  results?: { source: string; title?: string; url?: string; snippets: string[] }[]
  error?: string
}

export type SeekerEnrichment = {
  items: ReceiptLineItem[]
  vendor: string
  notes: string[]
  lookups: WebLookupResult[]
  report: string
}

function needsLookup(desc: string): boolean {
  const d = desc.trim()
  if (d.length < 4) return true
  // SKU-heavy / thin descriptions
  if (/^[A-Z0-9][\w\-\/]{2,}\b/.test(d) && d.split(/\s+/).length <= 4) return true
  if (!/[a-z]{4,}/i.test(d)) return true
  // part numbers mixed with little English
  if (/\b[A-Z]{1,5}\d{3,}\b/.test(d) && d.length < 40) return true
  return false
}

function buildQueries(item: ReceiptLineItem, vendor: string): string[] {
  const q: string[] = []
  const desc = item.description.trim()
  // extract part-like tokens
  const parts = desc.match(/\b[A-Z0-9]{2,}[-/]?[A-Z0-9]{2,}\b/g) || []
  if (parts[0]) q.push(`${parts[0]} product`)
  if (parts[0] && /filter|fuel|kit|ford|diesel/i.test(desc)) {
    q.push(`${parts[0]} fuel filter`)
  }
  q.push(desc.slice(0, 80))
  if (vendor && vendor.length > 2) q.push(`${desc.slice(0, 50)} ${vendor}`)
  // unique, short list
  return [...new Set(q.map((s) => s.trim()).filter((s) => s.length >= 3))].slice(0, 2)
}

function improveDescription(original: string, summary: string): string {
  if (!summary || summary.length < 12) return original
  // Prefer a short, readable blend
  const first = summary.split(/[·.|]/)[0]?.trim() || summary
  const cleaned = first.replace(/\s+/g, ' ').slice(0, 100)
  if (cleaned.length < 8) return original
  // Keep original tokens that look like part numbers
  const sku = original.match(/\b[A-Z0-9]{2,}[-/]?[A-Z0-9]{2,}\b/)?.[0]
  if (sku && !cleaned.toUpperCase().includes(sku.toUpperCase())) {
    return `${cleaned} (${sku})`.slice(0, 100)
  }
  // If original already descriptive, only append if much better
  if (original.length > 35 && /[a-z]{4,}/i.test(original)) {
    return original
  }
  return cleaned
}

export async function webLookup(query: string): Promise<WebLookupResult> {
  try {
    const res = await fetch(`/api/web-lookup?q=${encodeURIComponent(query)}`, {
      cache: 'no-store',
    })
    const text = await res.text()
    // SPA hosts without proxy return index.html
    if (text.trimStart().startsWith('<!') || text.trimStart().startsWith('<html')) {
      return {
        ok: false,
        query,
        error: 'Web lookup proxy not available on this host (got HTML). Use project preview server.',
      }
    }
    if (!res.ok) {
      return { ok: false, error: `lookup HTTP ${res.status}`, query }
    }
    return JSON.parse(text) as WebLookupResult
  } catch (e) {
    return {
      ok: false,
      query,
      error: e instanceof Error ? e.message : 'network error',
    }
  }
}

export async function webLookupBatch(queries: string[]): Promise<WebLookupResult[]> {
  try {
    const res = await fetch('/api/web-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: queries.slice(0, 6) }),
    })
    if (!res.ok) {
      // fall back one-by-one GET
      const out: WebLookupResult[] = []
      for (const q of queries.slice(0, 4)) out.push(await webLookup(q))
      return out
    }
    const data = (await res.json()) as { lookups?: WebLookupResult[] }
    return data.lookups ?? []
  } catch {
    const out: WebLookupResult[] = []
    for (const q of queries.slice(0, 3)) out.push(await webLookup(q))
    return out
  }
}

/**
 * Seeker enriches a draft parse using free public web search (via host proxy).
 */
export async function runSeekerAgent(
  draft: LocalAgentResult,
  opts?: {
    onProgress?: (msg: string, aiId?: AiId) => void
  },
): Promise<SeekerEnrichment> {
  const notes: string[] = []
  const lookups: WebLookupResult[] = []
  const items = [...(draft.lineItems ?? [])]
  let vendor = draft.vendor || ''

  opts?.onProgress?.('Seeker is scanning the internet for product info…', 'seeker')

  // Probe availability
  const probe = await webLookup('receipt product lookup test')
  if (!probe.ok && probe.error) {
    // still try real queries — probe might fail oddly
    notes.push(`Seeker probe: ${probe.error}`)
  }

  const queryList: string[] = []
  const itemQueryMap: { index: number; queries: string[] }[] = []

  items.forEach((item, index) => {
    if (!needsLookup(item.description) && item.categoryId !== 'misc') return
    const qs = buildQueries(item, vendor)
    itemQueryMap.push({ index, queries: qs })
    queryList.push(...qs)
  })

  // Vendor enrichment
  if (!vendor || vendor.length < 4 || /[\[\]{}|\\]/.test(vendor)) {
    const domainish = (draft.rawText || '').match(
      /([a-z0-9][-a-z0-9]{2,})\.(com|net|org|shop)/i,
    )
    if (domainish) {
      queryList.push(`${domainish[1]} store`)
    }
  }

  const uniqueQueries = [...new Set(queryList)].slice(0, 6)
  if (!uniqueQueries.length) {
    notes.push('Seeker: nothing looked SKU-thin enough to look up')
    return {
      items,
      vendor,
      notes,
      lookups: [],
      report: 'Seeker: no web lookups needed',
    }
  }

  opts?.onProgress?.(
    `Seeker querying free web (${uniqueQueries.length})…`,
    'seeker',
  )
  const batch = await webLookupBatch(uniqueQueries)
  lookups.push(...batch)

  // Apply enrichments
  for (const map of itemQueryMap) {
    const related = batch.filter(
      (b) => b.query && map.queries.some((q) => b.query!.includes(q.slice(0, 12)) || q.includes(b.query!.slice(0, 12))),
    )
    // fallback: match by order
    const summary =
      related.map((r) => r.summary).filter(Boolean).join(' · ') ||
      batch
        .filter((b) => b.ok && b.summary)
        .map((b) => b.summary)
        .join(' · ')

    if (!summary) continue
    const item = items[map.index]
    const improved = improveDescription(item.description, summary)
    const { categoryId } = categorizeText(`${improved} ${summary}`)
    if (improved !== item.description || (categoryId !== 'misc' && categoryId !== item.categoryId)) {
      notes.push(
        `Seeker upgraded “${item.description.slice(0, 28)}” → “${improved.slice(0, 40)}” [${categoryId}]`,
      )
      items[map.index] = {
        ...item,
        description: improved,
        categoryId: categoryId !== 'misc' ? categoryId : item.categoryId,
      }
    }
  }

  // Vendor from web if still weak
  if (!vendor || vendor.length < 4) {
    for (const b of batch) {
      const hit = (b.summary || '').match(
        /\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\b/,
      )
      if (b.title && b.title.length > 3) {
        vendor = b.title.slice(0, 48)
        notes.push(`Seeker vendor hint: ${vendor}`)
        break
      }
      if (hit) {
        vendor = hit[1].slice(0, 48)
        notes.push(`Seeker vendor hint: ${vendor}`)
        break
      }
    }
  }

  const report = [
    '—— Seeker free web lookup ——',
    ...uniqueQueries.map((q) => `query: ${q}`),
    ...batch.map(
      (b) =>
        `${b.ok ? '✓' : '✗'} ${b.query || ''}: ${(b.summary || b.error || 'empty').slice(0, 160)}`,
    ),
    ...notes,
  ].join('\n')

  opts?.onProgress?.('Seeker finished web enrichment', 'seeker')

  return { items, vendor: vendor || draft.vendor, notes, lookups, report }
}

/** Apply Seeker result onto a LocalAgentResult. */
export function applySeekerToDraft(
  draft: LocalAgentResult,
  seek: SeekerEnrichment,
): LocalAgentResult {
  const description =
    seek.items.length > 0
      ? seek.items
          .map((i) => i.description)
          .slice(0, 8)
          .join('; ')
          .slice(0, 180)
      : draft.description

  return {
    ...draft,
    lineItems: seek.items,
    vendor: seek.vendor || draft.vendor,
    description,
    notes: [draft.notes, ...seek.notes].filter(Boolean).join(' · '),
    agentReport: [draft.agentReport, seek.report].filter(Boolean).join('\n'),
    aisUsed: Array.from(new Set([...(draft.aisUsed ?? []), 'seeker' as AiId])),
    activeAiLabel: 'Council + Seeker (web)',
    confidence: Math.min(0.97, (draft.confidence ?? 0.5) + (seek.notes.length ? 0.05 : 0)),
  }
}

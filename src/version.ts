/**
 * App version + changelog.
 * Bump APP_VERSION (and package.json) on every release users should notice.
 * Add a CHANGELOG entry for that version so the "What's new" sheet stays accurate.
 */

/** Keep in sync with package.json version (single source users see in the UI). */
export const APP_VERSION = '1.18.3'

export type ChangelogEntry = {
  version: string
  date: string
  title: string
  changes: string[]
}

/** Newest first */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.18.3',
    date: '2026-07-28',
    title: 'Permanent storage without “close other tabs”',
    changes: [
      'Opens the existing local database without version fights',
      'If IndexedDB fails, uses permanent localStorage on this device (not temporary memory)',
      'No more messages blaming other browser tabs',
    ],
  },
  {
    version: '1.18.2',
    date: '2026-07-28',
    title: 'App always opens even if the database is stuck',
    changes: [
      'Auto-repairs or rebuilds a blocked IndexedDB instead of showing an error',
      'Falls back to temporary in-memory storage so the home screen always loads',
      'No more “Database is taking too long to open” dead-end',
    ],
  },
  {
    version: '1.18.1',
    date: '2026-07-28',
    title: 'Fix hang on “Loading your schoolie log…”',
    changes: [
      'IndexedDB open no longer waits forever when another tab blocks it',
      'Retry load + Reset local data if startup fails',
      'Avoided unnecessary DB version bump that could freeze boot',
    ],
  },
  {
    version: '1.18.0',
    date: '2026-07-28',
    title: 'Smarter free AI — still 100% local',
    changes: [
      'On-device memory learns stores, fees, and categories when you save',
      'Local smart pass repairs totals, fees, and free-form categories after OCR',
      'Layout-first OCR: deskew + document rows first; heavy engines only if needed',
      'Better photo prep (contrast) + capture tips on the scan screen',
      'No cloud keys — everything stays on your phone',
    ],
  },
  {
    version: '1.17.3',
    date: '2026-07-28',
    title: 'Type cents with a period',
    changes: [
      'Price fields keep the decimal point while you type (e.g. 12.50)',
      'Line-item amounts and total amount both allow cents',
    ],
  },
  {
    version: '1.17.2',
    date: '2026-07-28',
    title: 'Towing is invented from the receipt, not hardcoded',
    changes: [
      'No schoolie preset for towing — free-form AI invents “Towing” when that word is on the receipt',
      'Same invent path as other free-form groups (filters, engine parts, …)',
      'Fee ✗ and category ✗ fixes from 1.17.1 still apply',
    ],
  },
  {
    version: '1.17.1',
    date: '2026-07-28',
    title: '✗ marks actually fix fees & categories',
    changes: [
      'Marking Fees ✗ when empty now hunts convenience/service fees hard (no more blank fee section)',
      'Also uses total − subtotal − tax when the fee line is hard to OCR',
      'Marking Category ✗ forces a new bucket (won’t stick on Misc)',
    ],
  },
  {
    version: '1.17.0',
    date: '2026-07-28',
    title: 'Category groups on the home screen',
    changes: [
      'Main screen groups receipts under the categories the free AIs invent',
      'Regroup button re-sorts all saved receipts and line items anytime',
      'Hero shows how many groups you have; expand/collapse each group',
    ],
  },
  {
    version: '1.16.1',
    date: '2026-07-28',
    title: 'Harder OCR — T0TAL, fees, store names',
    changes: [
      'Fixes OCR zeros that broke totals (T0TAL), fees (C0NVENIENCE), and vendors (H0ME DEP0T)',
      'No longer treats card lines (VISA CHIP) as the store name',
      'Convenience fees stay in their own Fees section through Council',
      'Subtotal + tax + fee used when total label is noisy',
    ],
  },
  {
    version: '1.16.0',
    date: '2026-07-28',
    title: 'Free-form categories (engine parts, etc.)',
    changes: [
      'Categories are no longer a fixed schoolie-only list',
      'AI invents groups like Engine & Powertrain or Fuel system from the receipt',
      'Type any category name; similar spends group together on the home chart',
    ],
  },
  {
    version: '1.15.2',
    date: '2026-07-28',
    title: 'Clear “who answered” after every scan/rescan',
    changes: [
      'Big Who answered card shows primary AI + OCR/total/vendor credits',
      'Each field and line shows which free AI produced it',
      'Rescan keeps AI credit on unmarked/kept fields',
    ],
  },
  {
    version: '1.15.1',
    date: '2026-07-28',
    title: 'Titan ONNX crash soft-fail',
    changes: [
      'Fixes Titan “Can’t create a session / graph.cc” killing the scan',
      'Titan prefers WASM, tries safer backends, then skips cleanly if ONNX fails',
      'Other free on-device AIs keep running when Titan is unavailable',
    ],
  },
  {
    version: '1.15.0',
    date: '2026-07-28',
    title: 'On-device team huddle — AIs talk to each other',
    changes: [
      'All OCR + parse AIs run locally on your phone (no paid keys)',
      'Team huddle: agents post findings, challenge gaps, and agree together',
      'Council still does a second debate pass; Seeker is optional free web only',
    ],
  },
  {
    version: '1.14.1',
    date: '2026-07-28',
    title: 'Stability test runs every free AI',
    changes: [
      'Test free AIs no longer skips half the roster',
      'Exercises Forge, Lens, Ruler, Wedge, Prism, Bloom, Mosaic, Hammer, Titan, Scout, parsers, Council, Seeker',
    ],
  },
  {
    version: '1.14.0',
    date: '2026-07-28',
    title: 'Unmarked = correct; Fees section; stronger wrong-fix',
    changes: [
      'If you don’t mark a field wrong, the rescan keeps it as correct',
      'Only ✗ parts are rewritten — banned from repeating the same answer',
      'Convenience / service / processing fees go in a Fees section',
    ],
  },
  {
    version: '1.13.0',
    date: '2026-07-28',
    title: 'Expand long sections + ✓/✗ weights AIs',
    changes: [
      'Long text sections expand / scroll so you can read everything',
      'Each mark shows which free AI produced that field or line',
      '✓ credits and ✗ dings that AI — future scans weight trusted AIs higher',
    ],
  },
  {
    version: '1.12.0',
    date: '2026-07-28',
    title: 'Mark parts ✓ right or ✗ wrong, then fix',
    changes: [
      'Mark total, vendor, category, date, shipping, missing products, or each line item',
      'Fix marked parts re-scans and keeps what you marked right',
      'Retry all still re-reads everything if you prefer',
    ],
  },
  {
    version: '1.11.0',
    date: '2026-07-28',
    title: 'More free AIs + per-AI on/off',
    changes: [
      'Added free no-key AIs: Mosaic (tile OCR), Wedge (deskew), Prism (multi-layout), Bloom (2× upscale)',
      'Settings: enable/disable any non-core AI if your phone can’t handle it',
      'Disable heavy / Enable all shortcuts; light mode still skips heavy tier',
    ],
  },
  {
    version: '1.10.2',
    date: '2026-07-28',
    title: 'Try again tells AIs the last answer was wrong',
    changes: [
      'Pressing Try again passes the rejected total/items to the free AI team',
      'Retry re-reads the photo differently and avoids cloning the same answer',
      'Council + Quorum diversify; optional note about what looked wrong helps',
    ],
  },
  {
    version: '1.10.1',
    date: '2026-07-28',
    title: 'Shipping as its own line section',
    changes: [
      'When a receipt has a shipping price, it becomes its own Shipping line (not dropped)',
      'Review screen groups Products and Shipping separately',
      'Manual “+ Shipping” on the form; products still drive the main category',
    ],
  },
  {
    version: '1.10.0',
    date: '2026-07-28',
    title: 'Ruler — reads receipt lines from the photo layout',
    changes: [
      'New free Ruler AI maps every word box on the receipt (not just a text dump)',
      'Keeps product names on the same visual row as their prices',
      'Folds multi-line item names into one product before splitting the list',
      'Sieve + Ledger prefer layout-aware rows so items split more cleanly',
    ],
  },
  {
    version: '1.9.1',
    date: '2026-07-28',
    title: 'Try again when a scan is wrong',
    changes: [
      'Big Try again button if the scan fails or the read looks incomplete',
      'Re-run free AIs on the same photo, or take a new shot',
      'Still can fix fields manually or report a bad scan for debugging',
    ],
  },
  {
    version: '1.9.0',
    date: '2026-07-27',
    title: 'UI polish + new logo',
    changes: [
      'Refined schoolie bus logo and app icons',
      'Cleaner home hero, empty states, category dots, glass bottom bar',
      'Verified tests/build; removed unused assets',
    ],
  },
  {
    version: '1.8.2',
    date: '2026-07-27',
    title: 'Category fixes from user debug notes',
    changes: [
      'Fuel filters / Racor / diesel parts → Fuel & Travel (not Tools)',
      'Towing / service invoices → Misc (services), not Fuel',
      'Optional convenience fee line kept as Misc on tow invoices',
    ],
  },
  {
    version: '1.8.1',
    date: '2026-07-27',
    title: 'Debug recheck: Swag dupes + Falzone towing',
    changes: [
      'Collapse duplicate product amounts when sum exceeds subtotal',
      'Ignore address/shipping chrome in product names',
      'Invoice layout: skip Subtotal/Total/Convenience Fee as products',
      'Towing invoices → Falzone vendor + correct service filing',
      'Seeker detects missing web proxy (HTML responses)',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-07-27',
    title: 'Seeker free web lookup for receipts',
    changes: [
      'Seeker agent looks up SKUs/products on DuckDuckGo + Wikipedia (no API key)',
      'Local free proxy /api/web-lookup on dev/preview server',
      'Council re-debates after Seeker enriches weak product names',
    ],
  },
  {
    version: '1.7.1',
    date: '2026-07-27',
    title: 'Council agent debate + debug receipt recheck',
    changes: [
      'Council blackboard: Cashier challenges gaps, Sieve hunts missing prices, Clerk fixes vendor',
      'Agents talk to each other in multi-round debate after Quorum',
      'Rechecked Swag Performance Parts debug scan — products + shipping math agreement',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-07-27',
    title: 'Max-power free AIs — Hammer + Titan',
    changes: [
      'Hammer: multi-worker parallel OCR swarm (heavy CPU, no key)',
      'Titan: free on-device neural OCR via Transformers.js / TrOCR (WebGPU or WASM)',
      'Max power mode ON by default — pushes the phone hard on every scan',
      'Still 100% free — no API keys, no cloud billing',
    ],
  },
  {
    version: '1.6.1',
    date: '2026-07-27',
    title: 'Fix real receipt parse (Swag Performance Parts)',
    changes: [
      'Multi-line product blocks: catch second items like Caterpillar fuel filter',
      'Do not treat Shipping as a product line item',
      'Vendor from domain/brand footer (not OCR garbage)',
      'Fuel filter / diesel parts map to Tools category',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-07-27',
    title: 'Keyless free AI team only',
    changes: [
      'Removed all AIs that need API keys (Grok, ChatGPT, Gemini)',
      'Added free high-power Lens (upscale OCR), Sieve (line-item ensemble), Quorum (final vote)',
      'Forge + Lens dual OCR paths voted by Quorum — all on-device, no keys',
      'Device scan + stability tests cover only free keyless AIs',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-07-27',
    title: 'Free high-power AIs + device & stability tests',
    changes: [
      'Free high-power Forge OCR (multi-preprocess on your phone)',
      'Settings → Scan this device for AI capability',
      'Settings → Test free AIs stability suite (synthetic receipt)',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-07-27',
    title: 'Report bad scans for debugging',
    changes: [
      '“Report bad scan” saves the receipt photo + AI outputs so the coding agent can inspect them',
      'Reports land in debug-scans/ when using the project’s dev/preview server',
      'Always can download a debug JSON bundle to share',
      'Settings shows remote debug reports when available',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-07-27',
    title: 'Named AIs + leaderboard',
    changes: [
      'See which AI is working by name (Scout, Grok, ChatGPT, …)',
      'Settings lists every AI in the roster with ready/needs-key status',
      'Optional ChatGPT (OpenAI) key alongside Grok (xAI)',
      'Leaderboard: crown who scanned best after each receipt',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-07-27',
    title: 'Multi-agent receipt team + line items',
    changes: [
      'OCR dual-pass + line-items, totals, merchant, and arbiter agents cross-check each other',
      'Full receipt line-item breakdown (edit each row, category per item)',
      'Agent team report on the review screen shows how they agreed or disagreed',
      'Optional cloud agent still cross-checks when local results look thin',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-07-27',
    title: 'Version badge & update scan',
    changes: [
      'Always show the app version so you know which build you’re on',
      'When the app updates, a “What’s new” sheet lists what changed',
      'Settings → Scan for updates checks the server for a newer build',
      'Settings includes full version history and a way to re-open release notes',
      'Banner when a newer install is ready (PWA) so you can reload into it',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-07-27',
    title: 'On-device agent & visual refresh',
    changes: [
      'Low-power on-device receipt agent (runs on your phone when you upload a photo)',
      'Optional cloud boost only if the local read looks weak',
      'New logo, icons, and polished mobile UI',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-07-27',
    title: 'First release',
    changes: [
      'Track schoolie conversion purchases for one bus',
      'Totals, category breakdown, receipt photos',
      'CSV / PDF export and home-screen install (PWA)',
    ],
  },
]

export function getChangelogEntry(version: string): ChangelogEntry | undefined {
  return CHANGELOG.find((e) => e.version === version)
}

/** Entries newer than `fromVersion` (exclusive), newest first. If fromVersion empty, only current. */
export function getUpdatesSince(fromVersion: string | null | undefined): ChangelogEntry[] {
  if (!fromVersion) {
    const current = getChangelogEntry(APP_VERSION)
    return current ? [current] : []
  }
  const out: ChangelogEntry[] = []
  for (const entry of CHANGELOG) {
    if (entry.version === fromVersion) break
    out.push(entry)
  }
  return out
}

export function formatVersionLabel(version: string = APP_VERSION): string {
  return `v${version}`
}

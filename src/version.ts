/**
 * App version + changelog.
 * Bump APP_VERSION (and package.json) on every release users should notice.
 * Add a CHANGELOG entry for that version so the "What's new" sheet stays accurate.
 */

/** Keep in sync with package.json version (single source users see in the UI). */
export const APP_VERSION = '1.9.1'

export type ChangelogEntry = {
  version: string
  date: string
  title: string
  changes: string[]
}

/** Newest first */
export const CHANGELOG: ChangelogEntry[] = [
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

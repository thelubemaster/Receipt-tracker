/**
 * App version + changelog.
 * Bump APP_VERSION (and package.json) on every release users should notice.
 * Add a CHANGELOG entry for that version so the "What's new" sheet stays accurate.
 */

/** Keep in sync with package.json version (single source users see in the UI). */
export const APP_VERSION = '1.2.0'

export type ChangelogEntry = {
  version: string
  date: string
  title: string
  changes: string[]
}

/** Newest first */
export const CHANGELOG: ChangelogEntry[] = [
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

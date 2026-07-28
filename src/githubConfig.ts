/**
 * GitHub home for Schoolie / Receipt Tracker.
 * OTA web updates and release assets are published from this repo.
 */
export const GITHUB_OWNER = 'thelubemaster'
export const GITHUB_REPO = 'Receipt-tracker'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`

/** GitHub Pages base (enable Pages → branch gh-pages or Actions deploy). */
export const GITHUB_PAGES_BASE = `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}`

/** Latest release API (public repos; used as OTA fallback). */
export const GITHUB_RELEASES_LATEST = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

/** Static update manifest path on Pages / any static host. */
export const UPDATE_MANIFEST_PATH = 'app-update.json'

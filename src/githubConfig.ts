/**
 * GitHub home for Schoolie / Receipt Tracker.
 * APK installs and OTA web updates are published from this repo.
 */
export const GITHUB_OWNER = 'thelubemaster'
export const GITHUB_REPO = 'Receipt-tracker'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`

/** GitHub Pages base (enable Pages → Source: GitHub Actions). */
export const GITHUB_PAGES_BASE = `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}`

/** Latest release page (human-friendly). */
export const GITHUB_RELEASES_PAGE = `${GITHUB_REPO_URL}/releases/latest`

/**
 * Direct APK download — always the newest release asset named schoolie.apk.
 * Works in any browser (no API token). GitHub redirects to the real file.
 */
export const GITHUB_APK_LATEST = `${GITHUB_REPO_URL}/releases/latest/download/schoolie.apk`

/** Latest release API (public repos; OTA + install metadata). */
export const GITHUB_RELEASES_LATEST = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

/** Static update manifest path on Pages / any static host. */
export const UPDATE_MANIFEST_PATH = 'app-update.json'

/**
 * GitHub home for Schoolie / Receipt Tracker.
 * APK installs and OTA web updates are published from this repo.
 */
export const GITHUB_OWNER = 'thelubemaster'
export const GITHUB_REPO = 'Receipt-tracker'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`

/** GitHub Pages base (enable Pages → Source: GitHub Actions). */
export const GITHUB_PAGES_BASE = `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}`

/**
 * One install link for Android and Apple.
 * Android gets the APK flow; iPhone/iPad get Add to Home Screen (Safari PWA).
 */
export const GITHUB_INSTALL_URL = `${GITHUB_PAGES_BASE}/?install=1`

/** Latest release page (human-friendly). */
export const GITHUB_RELEASES_PAGE = `${GITHUB_REPO_URL}/releases/latest`

/**
 * Direct APK download.
 * Prefer a versioned release URL from app-update.json when possible —
 * `releases/latest/download/schoolie.apk` 404s if the latest tag only has web assets.
 */
export const GITHUB_APK_LATEST = `${GITHUB_REPO_URL}/releases/latest/download/schoolie.apk`

/** Stable download for the current shell (tag always includes schoolie.apk). */
export function githubApkForTag(tag: string): string {
  const t = tag.startsWith('v') ? tag : `v${tag}`
  return `${GITHUB_REPO_URL}/releases/download/${t}/schoolie.apk`
}

/**
 * Install pack: zip with schoolie.apk + 00-OPEN-ME-TO-INSTALL.html
 * (extract → open the HTML → auto-runs Android installer).
 */
export const GITHUB_INSTALL_ZIP_LATEST = `${GITHUB_REPO_URL}/releases/latest/download/Schoolie-Install.zip`

/** Latest release API (public repos; OTA + install metadata). */
export const GITHUB_RELEASES_LATEST = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

/** Static update manifest path on Pages / any static host. */
export const UPDATE_MANIFEST_PATH = 'app-update.json'

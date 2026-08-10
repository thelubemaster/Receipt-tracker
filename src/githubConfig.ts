/**
 * GitHub home for Project Cost Tracker (Receipt-tracker repo).
 * APK installs and OTA web updates are published from this repo.
 */
import { APK_FILE_NAME, INSTALL_ZIP_FILE_NAME } from './brand'

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
 * Direct APK download (generic project name — not school-bus specific).
 */
export const GITHUB_APK_LATEST = `${GITHUB_REPO_URL}/releases/latest/download/${APK_FILE_NAME}`

/** Stable download for the current shell (tag always includes the APK when built). */
export function githubApkForTag(tag: string): string {
  const t = tag.startsWith('v') ? tag : `v${tag}`
  return `${GITHUB_REPO_URL}/releases/download/${t}/${APK_FILE_NAME}`
}

/**
 * Install pack: zip with APK + open-to-install helpers.
 */
export const GITHUB_INSTALL_ZIP_LATEST = `${GITHUB_REPO_URL}/releases/latest/download/${INSTALL_ZIP_FILE_NAME}`

/** Latest release API (public repos; OTA + install metadata). */
export const GITHUB_RELEASES_LATEST = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

/** Static update manifest path on Pages / any static host. */
export const UPDATE_MANIFEST_PATH = 'app-update.json'

export { APK_FILE_NAME, INSTALL_ZIP_FILE_NAME }

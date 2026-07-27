import { APP_VERSION } from './version'

export type UpdateCheckStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | {
      state: 'current'
      localVersion: string
      remoteVersion: string
      checkedAt: string
      message: string
    }
  | {
      state: 'available'
      localVersion: string
      remoteVersion: string
      checkedAt: string
      message: string
    }
  | {
      state: 'error'
      localVersion: string
      message: string
      checkedAt: string
    }

/** Simple semver-ish compare: 1 if a>b, -1 if a<b, 0 if equal/unknown. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

async function fetchRemoteVersion(): Promise<string> {
  const url = `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`Could not reach version file (${res.status})`)
  }
  const data = (await res.json()) as { version?: string }
  if (!data.version || typeof data.version !== 'string') {
    throw new Error('Version file missing a version field')
  }
  return data.version.replace(/^v/i, '')
}

/** Ask the service worker (if any) to check the network for a new app shell. */
export async function pingServiceWorkerUpdate(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  await reg.update()
  // waiting worker means a new version is installed but not active yet
  return Boolean(reg.waiting || reg.installing)
}

/**
 * Scan the host for a newer version.json and ping the service worker.
 * Works for installed PWA and normal browser loads of the built site.
 */
export async function checkForAppUpdates(): Promise<UpdateCheckStatus> {
  const localVersion = APP_VERSION
  const checkedAt = new Date().toISOString()

  try {
    const [remoteVersion, swHasWaiting] = await Promise.all([
      fetchRemoteVersion(),
      pingServiceWorkerUpdate().catch(() => false),
    ])

    const cmp = compareVersions(remoteVersion, localVersion)
    if (cmp > 0 || swHasWaiting) {
      return {
        state: 'available',
        localVersion,
        remoteVersion: cmp > 0 ? remoteVersion : localVersion,
        checkedAt,
        message:
          cmp > 0
            ? `Newer build on the server: v${remoteVersion}. You’re on v${localVersion}. Reload to update.`
            : `A new install is ready on this device. Reload to switch to the latest app shell (still listed as v${localVersion} until reload finishes).`,
      }
    }

    if (cmp < 0) {
      // Local ahead of server (dev or partial deploy)
      return {
        state: 'current',
        localVersion,
        remoteVersion,
        checkedAt,
        message: `You’re on v${localVersion}, which is newer than the server file (v${remoteVersion}). You’re fine.`,
      }
    }

    return {
      state: 'current',
      localVersion,
      remoteVersion,
      checkedAt,
      message: `You’re on the newest version (v${localVersion}).`,
    }
  } catch (e) {
    return {
      state: 'error',
      localVersion,
      checkedAt,
      message:
        e instanceof Error
          ? e.message
          : 'Could not check for updates. Check your network and try again.',
    }
  }
}

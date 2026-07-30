/**
 * Tiny version label for the top bar.
 * Optional red dot when content or Android package needs an update.
 */
import { useEffect, useState } from 'react'
import { isNativeCapacitorApp } from './installApp'
import { formatVersionLabel } from './version'
import { readVersionSnapshot } from './versionProbe'

export function VersionChip(props: {
  onClick?: () => void
  title?: string
  className?: string
}) {
  const [needsUpdate, setNeedsUpdate] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (!isNativeCapacitorApp()) {
          // Browser: only care about content if we ever wire that; keep quiet
          if (!cancelled) setNeedsUpdate(false)
          return
        }
        const s = await readVersionSnapshot()
        if (!cancelled) {
          setNeedsUpdate(s.contentUpdateAvailable || s.shellUpdateAvailable)
        }
      } catch {
        if (!cancelled) setNeedsUpdate(false)
      }
    })()
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      void readVersionSnapshot()
        .then((s) => {
          if (!cancelled) {
            setNeedsUpdate(s.contentUpdateAvailable || s.shellUpdateAvailable)
          }
        })
        .catch(() => {
          /* ignore */
        })
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return (
    <button
      type="button"
      className={`version-chip${needsUpdate ? ' version-chip-update' : ''}${
        props.className ? ` ${props.className}` : ''
      }`}
      onClick={props.onClick}
      title={
        props.title ||
        (needsUpdate ? 'Update available — open Settings' : 'App version')
      }
      aria-label={
        needsUpdate
          ? `${formatVersionLabel()}, update available`
          : formatVersionLabel()
      }
    >
      {formatVersionLabel()}
      {needsUpdate && <span className="version-chip-dot" aria-hidden />}
    </button>
  )
}

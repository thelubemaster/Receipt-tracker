import { useEffect, useRef, useState } from 'react'
import { APP_NAME, APP_TAGLINE } from './brand'
import { getImageUrl, listProjects, listPurchases } from './db'
import { revokePreviewUrl } from './imagePick'
import { SafeImage } from './SafeImage'
import { formatMoney } from './money'
import { BrandLockup, LogoMark } from './Logo'
import type { Project } from './types'
import { VersionChip } from './VersionChip'
import { getTheme, projectThemeId } from './themes'

type Row = Project & { total: number; count: number; coverUrl: string | null }

export function ProjectsHome(props: {
  onOpenProject: (id: string) => void
  onNewProject: () => void
  onSettings: () => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  /** Blob URLs we created — revoke only on unmount (not StrictMode mid-load). */
  const blobUrlsRef = useRef<string[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const projects = await listProjects()
      const enriched: Row[] = []
      const blobs: string[] = []
      for (const p of projects) {
        const purchases = await listPurchases(p.id)
        const total = purchases.reduce((s, x) => s + (Number(x.amount) || 0), 0)
        let coverUrl: string | null = null
        if (p.coverImageId) {
          coverUrl = (await getImageUrl(p.coverImageId)) ?? null
          if (coverUrl?.startsWith('blob:')) blobs.push(coverUrl)
        }
        enriched.push({ ...p, total, count: purchases.length, coverUrl })
      }
      if (cancelled) {
        for (const u of blobs) revokePreviewUrl(u)
        return
      }
      // Drop previous list blobs if reloading
      for (const u of blobUrlsRef.current) revokePreviewUrl(u)
      blobUrlsRef.current = blobs
      setRows(enriched)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      for (const u of blobUrlsRef.current) revokePreviewUrl(u)
      blobUrlsRef.current = []
    }
  }, [])

  return (
    <>
      <header className="topbar">
        <BrandLockup title={APP_NAME} subtitle={APP_TAGLINE} />
        <div className="topbar-actions">
          <VersionChip
            onClick={props.onSettings}
            title="Version — open Settings for updates"
          />
          <button type="button" className="icon-btn" aria-label="Settings" onClick={props.onSettings}>
            ⚙
          </button>
        </div>
      </header>

      <section className="hero-card">
        <div className="hero-inner">
          <div className="hero-label">Your projects</div>
          <div className="hero-total" style={{ fontSize: '1.6rem' }}>
            {rows == null ? '…' : rows.length === 0 ? 'None yet' : `${rows.length} project${rows.length === 1 ? '' : 's'}`}
          </div>
          <div className="hero-sub">Track receipts separately for each build, trip, or job</div>
        </div>
      </section>

      <button
        type="button"
        className="btn btn-primary"
        style={{ width: '100%', marginBottom: 16, minHeight: 48 }}
        onClick={props.onNewProject}
      >
        + New project
      </button>

      {rows == null ? (
        <div className="empty">
          <div className="spinner" />
        </div>
      ) : rows.length === 0 ? (
        <div className="empty empty-soft">
          <LogoMark size={56} />
          <p style={{ marginTop: 12 }}>
            Start a project — kitchen remodel, school bus, road trip — then scan receipts into it.
          </p>
        </div>
      ) : (
        <div className="project-list">
          {rows.map((p) => (
            <button
              key={p.id}
              type="button"
              className="card project-card"
              onClick={() => props.onOpenProject(p.id)}
            >
              <div className="project-card-media">
                {p.coverUrl ? (
                  <SafeImage
                    src={p.coverUrl}
                    alt=""
                    missingClassName="project-card-placeholder"
                    missingText=""
                  />
                ) : (
                  <div className="project-card-placeholder">
                    <LogoMark size={40} />
                  </div>
                )}
              </div>
              <div className="project-card-body">
                <strong>{p.name}</strong>
                {p.description ? (
                  <p className="muted project-card-desc">{p.description}</p>
                ) : (
                  <p className="muted project-card-desc">No description</p>
                )}
                <div className="project-card-meta">
                  <span>{formatMoney(p.total)}</span>
                  <span className="muted">
                    {p.count} receipt{p.count === 1 ? '' : 's'}
                  </span>
                  <span
                    className="project-theme-dot"
                    title={getTheme(projectThemeId(p.themeId)).name}
                    style={{
                      background: getTheme(projectThemeId(p.themeId)).preview[2],
                    }}
                    aria-label={`Project theme: ${getTheme(projectThemeId(p.themeId)).name}`}
                  />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

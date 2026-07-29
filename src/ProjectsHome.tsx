import { useEffect, useState } from 'react'
import { APP_NAME, APP_TAGLINE } from './brand'
import { getImage, listProjects, listPurchases } from './db'
import { formatMoney } from './money'
import { BrandLockup, LogoMark } from './Logo'
import type { Project } from './types'
import { formatVersionLabel } from './version'

type Row = Project & { total: number; count: number; coverUrl: string | null }

export function ProjectsHome(props: {
  onOpenProject: (id: string) => void
  onNewProject: () => void
  onSettings: () => void
  onShowVersion: () => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const projects = await listProjects()
      const enriched: Row[] = []
      for (const p of projects) {
        const purchases = await listPurchases(p.id)
        const total = purchases.reduce((s, x) => s + (Number(x.amount) || 0), 0)
        let coverUrl: string | null = null
        if (p.coverImageId) {
          const blob = await getImage(p.coverImageId)
          if (blob) coverUrl = URL.createObjectURL(blob)
        }
        enriched.push({ ...p, total, count: purchases.length, coverUrl })
      }
      if (!cancelled) setRows(enriched)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Revoke object URLs on unmount / refresh
  useEffect(() => {
    return () => {
      for (const r of rows || []) {
        if (r.coverUrl) URL.revokeObjectURL(r.coverUrl)
      }
    }
  }, [rows])

  return (
    <>
      <header className="topbar">
        <BrandLockup title={APP_NAME} subtitle={APP_TAGLINE} />
        <div className="topbar-actions">
          <button
            type="button"
            className="version-chip"
            onClick={props.onShowVersion}
            title="App version"
          >
            {formatVersionLabel()}
          </button>
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
                  <img src={p.coverUrl} alt="" />
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
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AiId } from './aiRoster'
import { AI_ROSTER, getAi } from './aiRoster'
import { CATEGORIES, getCategory } from './categories'
import {
  deletePurchase,
  getImage,
  getPurchase,
  getSettings,
  listPurchases,
  newId,
  saveImage,
  savePurchase,
  saveSettings,
  clearAllData,
  getLeaderboard,
} from './db'
import { downloadCsv, downloadPdfSummary } from './exportData'
import {
  defaultLeaderboard,
  normalizeLeaderboard,
  rankLeaderboard,
  recordAiWin,
  recordScanParticipation,
  type LeaderboardMap,
} from './leaderboard'
import { BrandLockup, LogoMark } from './Logo'
import { formatMoney, parseMoneyInput } from './money'
import { applyWaitingUpdate, notifyIfWaitingUpdate, setupPwaUpdates } from './pwa'
import { scanReceipt, type ScanResult } from './receiptAi'
import { categoryBreakdown, totalSpent } from './stats'
import type { AppSettings, CategoryId, Purchase, ReceiptLineItem, Screen } from './types'
import {
  checkForAppUpdates,
  type UpdateCheckStatus,
} from './updateCheck'
import {
  APP_VERSION,
  CHANGELOG,
  formatVersionLabel,
  getUpdatesSince,
  type ChangelogEntry,
} from './version'
import './index.css'

function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function emptyForm(
  partial?: Partial<Purchase> & { agentReport?: string; activeAiLabel?: string },
) {
  return {
    date: partial?.date ?? todayISO(),
    description: partial?.description ?? '',
    amount: partial?.amount != null ? String(partial.amount) : '',
    categoryId: (partial?.categoryId ?? 'misc') as CategoryId,
    vendor: partial?.vendor ?? '',
    notes: partial?.notes ?? '',
    lineItems: (partial?.lineItems ?? []) as ReceiptLineItem[],
    agentReport: partial?.agentReport ?? '',
    aisUsed: (partial?.aisUsed ?? []) as AiId[],
    activeAiLabel: partial?.activeAiLabel ?? '',
    bestAiId: (partial?.bestAiId ?? null) as AiId | null,
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [settings, setSettings] = useState<AppSettings>({
    apiKey: '',
    openaiApiKey: '',
    projectName: 'My Schoolie',
    lastSeenVersion: '',
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [whatsNew, setWhatsNew] = useState<ChangelogEntry[] | null>(null)
  const [whatsNewMode, setWhatsNewMode] = useState<'update' | 'history'>('update')
  const [pendingSwUpdate, setPendingSwUpdate] = useState<(() => void) | null>(null)

  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([listPurchases(), getSettings()])
    setPurchases(p)
    setSettings(s)
    return s
  }, [])

  useEffect(() => {
    refresh()
      .then((s) => {
        if (s.lastSeenVersion !== APP_VERSION) {
          const entries = getUpdatesSince(s.lastSeenVersion || null)
          if (entries.length) {
            setWhatsNewMode(s.lastSeenVersion ? 'update' : 'update')
            setWhatsNew(entries)
          }
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load data'))
      .finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    setupPwaUpdates({
      onNeedRefresh: (apply) => setPendingSwUpdate(() => apply),
    })
  }, [])

  async function acknowledgeVersion() {
    const next = { ...settings, lastSeenVersion: APP_VERSION }
    await saveSettings(next)
    setSettings(next)
    setWhatsNew(null)
  }

  const total = useMemo(() => totalSpent(purchases), [purchases])
  const breakdown = useMemo(() => categoryBreakdown(purchases), [purchases])

  async function handleSavePurchase(input: {
    id?: string
    date: string
    description: string
    amountRaw: string
    categoryId: CategoryId
    vendor: string
    notes: string
    lineItems?: ReceiptLineItem[]
    aisUsed?: AiId[]
    bestAiId?: AiId | null
    receiptBlob?: Blob | null
    existingReceiptImageId?: string | null
  }) {
    setError(null)
    const amount = parseMoneyInput(input.amountRaw)
    if (amount == null) {
      setError('Enter a valid amount.')
      return false
    }
    if (!input.description.trim() && !(input.lineItems && input.lineItems.length)) {
      setError('Add a short description of what you bought.')
      return false
    }
    if (!input.date) {
      setError('Pick a date.')
      return false
    }

    const now = new Date().toISOString()
    let receiptImageId = input.existingReceiptImageId ?? null
    if (input.receiptBlob) {
      receiptImageId = await saveImage(input.receiptBlob)
    }

    const lineItems = input.lineItems ?? []
    const description =
      input.description.trim() ||
      lineItems
        .map((l) => l.description)
        .slice(0, 6)
        .join('; ')

    const aisUsed = input.aisUsed ?? []
    const purchase: Purchase = {
      id: input.id ?? newId(),
      date: input.date,
      description,
      amount,
      categoryId: input.categoryId,
      vendor: input.vendor.trim(),
      notes: input.notes.trim(),
      receiptImageId,
      lineItems,
      aisUsed,
      bestAiId: input.bestAiId ?? null,
      createdAt: input.id
        ? (purchases.find((p) => p.id === input.id)?.createdAt ?? now)
        : now,
      updatedAt: now,
    }

    await savePurchase(purchase)
    if (input.bestAiId) {
      await recordAiWin(input.bestAiId, 5)
    }
    await refresh()
    setInfo(
      input.bestAiId
        ? `Purchase saved · ${getAi(input.bestAiId).name} got a win on the leaderboard`
        : 'Purchase saved.',
    )
    setScreen({ name: 'home' })
    return true
  }

  if (loading) {
    return (
      <div className="app-shell">
        <div className="empty">
          <div className="spinner" />
          Loading your schoolie log…
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {pendingSwUpdate && (
        <div className="banner banner-update" role="status">
          <strong>New version ready</strong>
          <div className="muted" style={{ margin: '6px 0 10px' }}>
            A newer build of Schoolie is available. Reload to switch to {formatVersionLabel()} and
            see what changed.
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setPendingSwUpdate(null)}>
              Later
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                pendingSwUpdate()
              }}
            >
              Reload update
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="banner banner-error" role="alert">
          {error}
          <button
            type="button"
            style={{ float: 'right', color: 'inherit', textDecoration: 'underline' }}
            onClick={() => setError(null)}
          >
            dismiss
          </button>
        </div>
      )}
      {info && (
        <div className="banner banner-success" role="status">
          {info}
          <button
            type="button"
            style={{ float: 'right', color: 'inherit', textDecoration: 'underline' }}
            onClick={() => setInfo(null)}
          >
            dismiss
          </button>
        </div>
      )}

      {whatsNew && (
        <WhatsNewModal
          entries={whatsNew}
          mode={whatsNewMode}
          previousVersion={settings.lastSeenVersion}
          onClose={() => void acknowledgeVersion()}
          onDismissOnly={() => setWhatsNew(null)}
        />
      )}

      {screen.name === 'home' && (
        <HomeScreen
          projectName={settings.projectName}
          total={total}
          purchaseCount={purchases.length}
          breakdown={breakdown}
          purchases={purchases}
          onScan={() => {
            setError(null)
            setInfo(null)
            setScreen({ name: 'scan' })
          }}
          onAdd={() => {
            setError(null)
            setInfo(null)
            setScreen({ name: 'add' })
          }}
          onOpen={(id) => setScreen({ name: 'detail', purchaseId: id })}
          onSettings={() => setScreen({ name: 'settings' })}
          onExportCsv={() => downloadCsv(purchases, settings.projectName)}
          onExportPdf={() => downloadPdfSummary(purchases, settings.projectName)}
          onShowVersion={() => {
            setWhatsNewMode('history')
            setWhatsNew(CHANGELOG)
          }}
        />
      )}

      {screen.name === 'scan' && (
        <ScanScreen
          apiKey={settings.apiKey}
          openaiApiKey={settings.openaiApiKey}
          onBack={() => setScreen({ name: 'home' })}
          onNeedSettings={() => setScreen({ name: 'settings' })}
          onParsed={(suggestion, blob, previewUrl) => {
            const aisUsed = (suggestion.aisUsed ?? []) as AiId[]
            void recordScanParticipation(aisUsed)
            setScreen({
              name: 'add',
              initial: {
                date: suggestion.date ?? todayISO(),
                description: suggestion.description,
                amount: suggestion.amount ?? undefined,
                categoryId: suggestion.categoryId,
                vendor: suggestion.vendor,
                notes: suggestion.notes,
                lineItems: suggestion.lineItems ?? [],
                agentReport: suggestion.agentReport,
                aisUsed,
                activeAiLabel: suggestion.activeAiLabel,
              },
              receiptBlob: blob,
              receiptPreviewUrl: previewUrl,
            })
          }}
          onManualWithPhoto={(blob, previewUrl) => {
            setScreen({
              name: 'add',
              receiptBlob: blob,
              receiptPreviewUrl: previewUrl,
            })
          }}
          onError={setError}
        />
      )}

      {screen.name === 'add' && (
        <PurchaseFormScreen
          title="Add purchase"
          initial={emptyForm(screen.initial)}
          receiptPreviewUrl={screen.receiptPreviewUrl}
          receiptBlob={screen.receiptBlob}
          onBack={() => setScreen({ name: 'home' })}
          onSave={async (form, receiptBlob) => {
            await handleSavePurchase({
              date: form.date,
              description: form.description,
              amountRaw: form.amount,
              categoryId: form.categoryId,
              vendor: form.vendor,
              notes: form.notes,
              lineItems: form.lineItems,
              aisUsed: form.aisUsed,
              bestAiId: form.bestAiId,
              receiptBlob,
            })
          }}
        />
      )}

      {screen.name === 'edit' && (
        <EditPurchaseScreen
          purchaseId={screen.purchaseId}
          onBack={() => setScreen({ name: 'detail', purchaseId: screen.purchaseId })}
          onSave={async (form, existingId) => {
            await handleSavePurchase({
              id: screen.purchaseId,
              date: form.date,
              description: form.description,
              amountRaw: form.amount,
              categoryId: form.categoryId,
              vendor: form.vendor,
              notes: form.notes,
              lineItems: form.lineItems,
              aisUsed: form.aisUsed,
              bestAiId: form.bestAiId,
              existingReceiptImageId: existingId,
            })
          }}
          onError={setError}
        />
      )}

      {screen.name === 'detail' && (
        <DetailScreen
          purchaseId={screen.purchaseId}
          onBack={() => setScreen({ name: 'home' })}
          onEdit={() => setScreen({ name: 'edit', purchaseId: screen.purchaseId })}
          onDelete={async () => {
            if (!confirm('Delete this purchase?')) return
            await deletePurchase(screen.purchaseId)
            await refresh()
            setInfo('Purchase deleted.')
            setScreen({ name: 'home' })
          }}
          onError={setError}
        />
      )}

      {screen.name === 'settings' && (
        <SettingsScreen
          settings={settings}
          onBack={() => setScreen({ name: 'home' })}
          onSave={async (next) => {
            await saveSettings(next)
            setSettings(next)
            setInfo('Settings saved.')
            setScreen({ name: 'home' })
          }}
          onClear={async () => {
            if (!confirm('Delete ALL purchases and receipt photos on this device?')) return
            await clearAllData()
            await refresh()
            setInfo('All purchase data cleared.')
            setScreen({ name: 'home' })
          }}
          onShowWhatsNew={() => {
            setWhatsNewMode('history')
            setWhatsNew(CHANGELOG)
          }}
          onUpdateAvailable={() => {
            setPendingSwUpdate(() => applyWaitingUpdate)
          }}
        />
      )}
    </div>
  )
}

function WhatsNewModal(props: {
  entries: ChangelogEntry[]
  mode: 'update' | 'history'
  previousVersion: string
  onClose: () => void
  onDismissOnly: () => void
}) {
  const isHistory = props.mode === 'history'
  const title = isHistory
    ? 'Version history'
    : props.previousVersion
      ? `Updated to ${formatVersionLabel()}`
      : `You're on ${formatVersionLabel()}`

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <div className="hero-label">{isHistory ? 'App versions' : 'What changed'}</div>
            <h2 id="whats-new-title">{title}</h2>
          </div>
          <span className="version-chip version-chip-lg">{formatVersionLabel()}</span>
        </div>

        {!isHistory && props.previousVersion && (
          <p className="muted" style={{ marginTop: 0 }}>
            Previous build you had: {formatVersionLabel(props.previousVersion)}
          </p>
        )}

        <div className="changelog-list">
          {props.entries.map((entry) => (
            <article key={entry.version} className="changelog-entry">
              <div className="changelog-meta">
                <strong>{formatVersionLabel(entry.version)}</strong>
                <span className="muted">{entry.date}</span>
              </div>
              <div className="changelog-title">{entry.title}</div>
              <ul>
                {entry.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="row-actions stack" style={{ marginTop: 16 }}>
          {isHistory ? (
            <button type="button" className="btn btn-primary" onClick={props.onDismissOnly}>
              Close
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={props.onClose}>
              Got it — I&apos;m on {formatVersionLabel()}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function HomeScreen(props: {
  projectName: string
  total: number
  purchaseCount: number
  breakdown: ReturnType<typeof categoryBreakdown>
  purchases: Purchase[]
  onScan: () => void
  onAdd: () => void
  onOpen: (id: string) => void
  onSettings: () => void
  onExportCsv: () => void
  onExportPdf: () => void
  onShowVersion: () => void
}) {
  return (
    <>
      <header className="topbar">
        <BrandLockup title={props.projectName} subtitle="Schoolie conversion costs" />
        <div className="topbar-actions">
          <button
            type="button"
            className="version-chip"
            onClick={props.onShowVersion}
            title="App version and release notes"
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
          <div className="hero-label">Total spent</div>
          <div className="hero-total">{formatMoney(props.total)}</div>
          <div className="hero-sub">
            {props.purchaseCount === 0
              ? 'No purchases yet — scan a receipt to start'
              : `${props.purchaseCount} purchase${props.purchaseCount === 1 ? '' : 's'} logged`}
          </div>
          <div className="hero-pills">
            <span className="pill pill-accent">⚡ Multi-agent team</span>
            <span className="pill">Cross-checked</span>
          </div>
        </div>
      </section>

      <div className="section-title">
        <span>By category</span>
      </div>
      {props.breakdown.length === 0 ? (
        <div className="empty">Category breakdown shows up after your first purchase.</div>
      ) : (
        <div className="card category-list">
          {props.breakdown.map((c) => (
            <div key={c.categoryId} className="category-row">
              <span className="category-name">{c.label}</span>
              <span className="category-amount">
                {formatMoney(c.amount)} · {c.percent}%
              </span>
              <div className="category-bar">
                <span
                  style={{
                    width: `${Math.max(c.percent, 2)}%`,
                    background: c.color,
                    color: c.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">
        <span>Recent</span>
        <span className="export-links">
          <button type="button" onClick={props.onExportCsv}>
            CSV
          </button>
          <button type="button" onClick={props.onExportPdf}>
            PDF
          </button>
        </span>
      </div>

      {props.purchases.length === 0 ? (
        <div className="empty">
          Tap <strong>Scan receipt</strong> — your phone reads the photo with a low-power on-device
          agent, then you confirm before saving.
        </div>
      ) : (
        <div className="purchase-list">
          {props.purchases.map((p) => (
            <button
              key={p.id}
              type="button"
              className="purchase-item"
              onClick={() => props.onOpen(p.id)}
            >
              <span className="purchase-title">{p.description || 'Purchase'}</span>
              <span className="purchase-amount">{formatMoney(p.amount)}</span>
              <span className="purchase-cat">{getCategory(p.categoryId).label}</span>
              <span className="purchase-meta">
                {p.date}
                {p.vendor ? ` · ${p.vendor}` : ''}
                {p.receiptImageId ? ' · 📷' : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="app-version-foot">
        Schoolie Cost Tracker{' '}
        <button type="button" className="version-link" onClick={props.onShowVersion}>
          {formatVersionLabel()}
        </button>
      </p>

      <div className="fab-bar">
        <button type="button" className="btn btn-secondary" onClick={props.onAdd}>
          Add
        </button>
        <button type="button" className="btn btn-primary" onClick={props.onScan}>
          📷 Scan receipt
        </button>
      </div>
    </>
  )
}

function ScanScreen(props: {
  apiKey: string
  openaiApiKey: string
  onBack: () => void
  onNeedSettings: () => void
  onParsed: (suggestion: ScanResult, blob: Blob, previewUrl: string) => void
  onManualWithPhoto: (blob: Blob, previewUrl: string) => void
  onError: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [activeAi, setActiveAi] = useState<{ name: string; id?: AiId } | null>(null)

  const whoWillScan = useMemo(() => {
    const names = ['Scout', 'Ledger', 'Cashier', 'Clerk', 'Arbiter']
    if (props.apiKey.trim()) names.push('Grok')
    if (props.openaiApiKey.trim()) names.push('ChatGPT')
    return names
  }, [props.apiKey, props.openaiApiKey])

  async function handleFile(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      props.onError('Please choose a photo of the receipt.')
      return
    }

    const blob = file
    const previewUrl = URL.createObjectURL(blob)

    setBusy(true)
    setProgress(0.02)
    setActiveAi({ name: 'Scout', id: 'scout' })
    setStatus('Scout is scanning the photo…')
    try {
      const suggestion = await scanReceipt(blob, {
        apiKey: props.apiKey,
        openaiApiKey: props.openaiApiKey,
        onProgress: (p) => {
          setProgress(p.progress)
          setStatus(p.message)
          if (p.aiName) setActiveAi({ name: p.aiName, id: p.aiId })
        },
      })
      props.onParsed(suggestion, blob, previewUrl)
    } catch (e) {
      props.onError(e instanceof Error ? e.message : 'Scan failed — enter details manually.')
      props.onManualWithPhoto(blob, previewUrl)
    } finally {
      setBusy(false)
      setStatus(null)
      setProgress(0)
      setActiveAi(null)
    }
  }

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={props.onBack} aria-label="Back">
          ←
        </button>
        <h1>Scan receipt</h1>
        <LogoMark size={36} />
      </header>

      <div className="banner banner-info">
        You&apos;ll see <strong>which AI is working by name</strong> (e.g. “Grok is scanning the
        photo…” or “ChatGPT is scanning the photo…”). On-device: Scout → Ledger → Cashier → Clerk →
        Arbiter.
        {props.apiKey.trim() || props.openaiApiKey.trim()
          ? ` Cloud: ${[props.apiKey.trim() && 'Grok', props.openaiApiKey.trim() && 'ChatGPT'].filter(Boolean).join(' + ')}.`
          : ' Add Grok / ChatGPT keys in Settings to include them.'}
      </div>

      {busy ? (
        <div className="card agent-status">
          <div className="spinner" />
          <div className="status-title">{status}</div>
          {activeAi && (
            <div
              className="ai-live-chip"
              style={{
                borderColor: activeAi.id ? getAi(activeAi.id).color : undefined,
              }}
            >
              <span className="ai-live-dot" />
              {activeAi.name} is working now
            </div>
          )}
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="muted">{Math.round(progress * 100)}%</div>
        </div>
      ) : (
        <div className="scan-drop">
          <div className="scan-icon">📷</div>
          <strong>Photograph or choose a receipt</strong>
          <p className="muted">AIs that will run this scan:</p>
          <div className="ai-chip-row">
            {whoWillScan.map((n) => (
              <span key={n} className="ai-chip">
                {n}
              </span>
            ))}
          </div>
          <div className="row-actions" style={{ marginTop: 16 }}>
            <label className="btn btn-primary">
              Take photo
              <input
                className="hidden-input"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <label className="btn btn-secondary">
              Gallery
              <input
                className="hidden-input"
                type="file"
                accept="image/*"
                onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <p className="muted" style={{ marginTop: 16 }}>
            Enable Grok or ChatGPT?{' '}
            <button type="button" style={{ textDecoration: 'underline' }} onClick={props.onNeedSettings}>
              Open Settings
            </button>
          </p>
        </div>
      )}
    </>
  )
}

type FormState = ReturnType<typeof emptyForm>

function PurchaseFormScreen(props: {
  title: string
  initial: FormState
  receiptPreviewUrl?: string
  receiptBlob?: Blob
  existingReceiptImageId?: string | null
  onBack: () => void
  onSave: (form: FormState, receiptBlob?: Blob | null) => Promise<void>
}) {
  const [form, setForm] = useState(props.initial)
  const [saving, setSaving] = useState(false)
  const [showAgentReport, setShowAgentReport] = useState(Boolean(props.initial.agentReport))

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function updateLine(id: string, patch: Partial<ReceiptLineItem>) {
    setForm((f) => ({
      ...f,
      lineItems: f.lineItems.map((li) => (li.id === id ? { ...li, ...patch } : li)),
    }))
  }

  function removeLine(id: string) {
    setForm((f) => {
      const lineItems = f.lineItems.filter((li) => li.id !== id)
      return {
        ...f,
        lineItems,
        description: lineItems.map((l) => l.description).join('; '),
      }
    })
  }

  function addLine() {
    setForm((f) => ({
      ...f,
      lineItems: [
        ...f.lineItems,
        {
          id: `manual-${crypto.randomUUID()}`,
          description: '',
          amount: 0,
          categoryId: f.categoryId,
        },
      ],
    }))
  }

  const itemsSum = form.lineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0)

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={props.onBack} aria-label="Back">
          ←
        </button>
        <h1>{props.title}</h1>
        <span style={{ width: 44 }} />
      </header>

      {props.receiptPreviewUrl && (
        <img className="receipt-preview" src={props.receiptPreviewUrl} alt="Receipt preview" />
      )}

      {(form.activeAiLabel || form.aisUsed.length > 0) && (
        <div className="banner banner-info">
          <strong>AIs on this scan:</strong>{' '}
          {form.activeAiLabel || form.aisUsed.map((id) => getAi(id).name).join(', ')}
        </div>
      )}

      {form.agentReport && (
        <div className="card agent-report-card">
          <button
            type="button"
            className="agent-report-toggle"
            onClick={() => setShowAgentReport((v) => !v)}
          >
            {showAgentReport ? '▼' : '▶'} Who scanned · full report
          </button>
          {showAgentReport && (
            <pre className="agent-report-body">{form.agentReport}</pre>
          )}
        </div>
      )}

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          setSaving(true)
          void props
            .onSave(form, props.receiptBlob)
            .finally(() => setSaving(false))
        }}
      >
        {form.aisUsed.length > 0 && (
          <div className="field">
            <label>Who scanned best? (leaderboard)</label>
            <p className="muted" style={{ margin: '0 0 8px' }}>
              Pick the AI that got closest — they get a win on the leaderboard.
            </p>
            <div className="ai-pick-grid">
              {form.aisUsed.map((id) => {
                const ai = getAi(id)
                const selected = form.bestAiId === id
                return (
                  <button
                    key={id}
                    type="button"
                    className={`ai-pick ${selected ? 'ai-pick-selected' : ''}`}
                    style={{ borderColor: selected ? ai.color : undefined }}
                    onClick={() => update('bestAiId', selected ? null : id)}
                  >
                    <span className="ai-pick-emoji">{ai.emoji}</span>
                    <span className="ai-pick-name">{ai.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {form.lineItems.length > 0 && (
          <div className="field">
            <label>Line items ({form.lineItems.length})</label>
            <div className="line-items-list">
              {form.lineItems.map((li) => (
                <div key={li.id} className="line-item-row">
                  <input
                    className="line-item-desc"
                    value={li.description}
                    placeholder="Item"
                    onChange={(e) => updateLine(li.id, { description: e.target.value })}
                  />
                  <input
                    className="line-item-amt"
                    inputMode="decimal"
                    value={li.amount === 0 ? '' : String(li.amount)}
                    placeholder="0.00"
                    onChange={(e) => {
                      const n = parseMoneyInput(e.target.value)
                      updateLine(li.id, { amount: n ?? 0 })
                    }}
                  />
                  <select
                    className="line-item-cat"
                    value={li.categoryId}
                    onChange={(e) =>
                      updateLine(li.id, { categoryId: e.target.value as CategoryId })
                    }
                    aria-label="Item category"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="line-item-remove"
                    aria-label="Remove line"
                    onClick={() => removeLine(li.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="line-items-foot">
              <span className="muted">Items sum {formatMoney(itemsSum)}</span>
              <button type="button" className="version-link" onClick={addLine}>
                + Add line
              </button>
            </div>
          </div>
        )}

        {form.lineItems.length === 0 && (
          <button type="button" className="btn btn-secondary" onClick={addLine}>
            + Add line items
          </button>
        )}

        <div className="field">
          <label htmlFor="amount">Amount (total paid)</label>
          <input
            id="amount"
            inputMode="decimal"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => update('amount', e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="description">Summary</label>
          <input
            id="description"
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            placeholder="e.g. Rigid foam insulation"
          />
        </div>
        <div className="field">
          <label htmlFor="category">Category</label>
          <select
            id="category"
            value={form.categoryId}
            onChange={(e) => update('categoryId', e.target.value as CategoryId)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="vendor">Store / vendor</label>
          <input
            id="vendor"
            value={form.vendor}
            onChange={(e) => update('vendor', e.target.value)}
            placeholder="Home Depot, Amazon…"
          />
        </div>
        <div className="field">
          <label htmlFor="date">Date</label>
          <input
            id="date"
            type="date"
            value={form.date}
            onChange={(e) => update('date', e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="row-actions">
          <button type="button" className="btn btn-secondary" onClick={props.onBack}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </>
  )
}

function EditPurchaseScreen(props: {
  purchaseId: string
  onBack: () => void
  onSave: (form: FormState, existingReceiptImageId: string | null) => Promise<void>
  onError: (msg: string) => void
}) {
  const [form, setForm] = useState<FormState | null>(null)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | undefined>()

  useEffect(() => {
    void (async () => {
      const p = await getPurchase(props.purchaseId)
      if (!p) {
        props.onError('Purchase not found.')
        props.onBack()
        return
      }
      setForm(emptyForm(p))
      setReceiptId(p.receiptImageId)
      if (p.receiptImageId) {
        const blob = await getImage(p.receiptImageId)
        if (blob) setPreviewUrl(URL.createObjectURL(blob))
      }
    })()
  }, [props.purchaseId])

  if (!form) {
    return (
      <div className="empty">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <PurchaseFormScreen
      title="Edit purchase"
      initial={form}
      receiptPreviewUrl={previewUrl}
      existingReceiptImageId={receiptId}
      onBack={props.onBack}
      onSave={async (f) => {
        await props.onSave(f, receiptId)
      }}
    />
  )
}

function DetailScreen(props: {
  purchaseId: string
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
  onError: (msg: string) => void
}) {
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | undefined>()

  useEffect(() => {
    void (async () => {
      const p = await getPurchase(props.purchaseId)
      if (!p) {
        props.onError('Purchase not found.')
        props.onBack()
        return
      }
      setPurchase(p)
      if (p.receiptImageId) {
        const blob = await getImage(p.receiptImageId)
        if (blob) setPreviewUrl(URL.createObjectURL(blob))
      }
    })()
  }, [props.purchaseId])

  if (!purchase) {
    return (
      <div className="empty">
        <div className="spinner" />
      </div>
    )
  }

  const cat = getCategory(purchase.categoryId)

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={props.onBack} aria-label="Back">
          ←
        </button>
        <h1>Purchase</h1>
        <span style={{ width: 44 }} />
      </header>

      {previewUrl && <img className="receipt-preview" src={previewUrl} alt="Receipt" />}

      <div className="card detail-grid">
        <div className="detail-row">
          <span className="detail-label">Amount</span>
          <span className="detail-value" style={{ color: 'var(--accent)' }}>
            {formatMoney(purchase.amount)}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">What</span>
          <span className="detail-value">{purchase.description}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Category</span>
          <span className="detail-value">{cat.label}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Store</span>
          <span className="detail-value">{purchase.vendor || '—'}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Date</span>
          <span className="detail-value">{purchase.date}</span>
        </div>
        {purchase.notes && (
          <div className="detail-row">
            <span className="detail-label">Notes</span>
            <span className="detail-value">{purchase.notes}</span>
          </div>
        )}
        {purchase.aisUsed.length > 0 && (
          <div className="detail-row">
            <span className="detail-label">AIs</span>
            <span className="detail-value">
              {purchase.aisUsed.map((id) => getAi(id).name).join(', ')}
              {purchase.bestAiId ? ` · best: ${getAi(purchase.bestAiId).name}` : ''}
            </span>
          </div>
        )}
      </div>

      {purchase.lineItems.length > 0 && (
        <>
          <div className="section-title">
            <span>Line items</span>
          </div>
          <div className="card">
            {purchase.lineItems.map((li) => (
              <div key={li.id} className="detail-row">
                <span className="detail-label">
                  {li.description}
                  <span className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                    {getCategory(li.categoryId).label}
                  </span>
                </span>
                <span className="detail-value">{formatMoney(li.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="row-actions" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-secondary" onClick={props.onEdit}>
          Edit
        </button>
        <button type="button" className="btn btn-danger" onClick={props.onDelete}>
          Delete
        </button>
      </div>
    </>
  )
}

function SettingsScreen(props: {
  settings: AppSettings
  onBack: () => void
  onSave: (s: AppSettings) => Promise<void>
  onClear: () => Promise<void>
  onShowWhatsNew: () => void
  onUpdateAvailable: () => void
}) {
  const [projectName, setProjectName] = useState(props.settings.projectName)
  const [apiKey, setApiKey] = useState(props.settings.apiKey)
  const [openaiApiKey, setOpenaiApiKey] = useState(props.settings.openaiApiKey)
  const [saving, setSaving] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckStatus>({ state: 'idle' })
  const [board, setBoard] = useState<LeaderboardMap>(defaultLeaderboard())

  useEffect(() => {
    void getLeaderboard().then((b) => setBoard(normalizeLeaderboard(b)))
  }, [])

  const ranked = useMemo(() => rankLeaderboard(board), [board])

  async function handleCheckUpdates() {
    setUpdateStatus({ state: 'checking' })
    const result = await checkForAppUpdates()
    setUpdateStatus(result)
    if (result.state === 'available') {
      notifyIfWaitingUpdate()
      props.onUpdateAvailable()
    }
  }

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={props.onBack} aria-label="Back">
          ←
        </button>
        <h1>Settings</h1>
        <span className="version-chip">{formatVersionLabel()}</span>
      </header>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          setSaving(true)
          void props
            .onSave({
              projectName: projectName.trim() || 'My Schoolie',
              apiKey: apiKey.trim(),
              openaiApiKey: openaiApiKey.trim(),
              lastSeenVersion: props.settings.lastSeenVersion,
            })
            .finally(() => setSaving(false))
        }}
      >
        <div className="card settings-card">
          <strong>App version</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            You are running <strong style={{ color: 'var(--text)' }}>{formatVersionLabel()}</strong>
            {props.settings.lastSeenVersion
              ? ` · last acknowledged ${formatVersionLabel(props.settings.lastSeenVersion)}`
              : ' · release notes not acknowledged yet'}
          </p>
          <button type="button" className="btn btn-secondary" onClick={props.onShowWhatsNew}>
            What&apos;s new / version history
          </button>
        </div>

        <div className="card settings-card">
          <strong>AI roster</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Every AI that can work a receipt. On-device AIs always run; cloud AIs need a key.
          </p>
          <div className="ai-roster-list">
            {AI_ROSTER.map((ai) => {
              const enabled =
                ai.kind === 'on-device' ||
                (ai.needsKey === 'xai' && Boolean(apiKey.trim())) ||
                (ai.needsKey === 'openai' && Boolean(openaiApiKey.trim()))
              return (
                <div key={ai.id} className="ai-roster-row">
                  <div className="ai-roster-icon" style={{ background: `${ai.color}22`, color: ai.color }}>
                    {ai.emoji}
                  </div>
                  <div className="ai-roster-body">
                    <div className="ai-roster-title">
                      {ai.name}
                      <span className={`ai-status-dot ${enabled ? 'on' : 'off'}`}>
                        {enabled ? 'ready' : 'needs key'}
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: '0.82rem' }}>
                      {ai.fullName} · {ai.kind === 'on-device' ? 'On your phone' : 'Cloud'}
                    </div>
                    <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
                      {ai.role}
                    </div>
                    <div className="muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                      Engine: {ai.engine}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card settings-card">
          <strong>AI leaderboard</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Ranked by your “who scanned best?” wins, ratings, and how often each AI runs.
          </p>
          <div className="leaderboard-list">
            {ranked.map((row) => (
              <div key={row.profile.id} className="leaderboard-row">
                <span className="lb-rank">#{row.rank}</span>
                <span className="lb-emoji">{row.profile.emoji}</span>
                <div className="lb-body">
                  <strong>{row.profile.name}</strong>
                  <div className="muted" style={{ fontSize: '0.78rem' }}>
                    {row.stats.wins} win{row.stats.wins === 1 ? '' : 's'} · {row.stats.scans} scan
                    {row.stats.scans === 1 ? '' : 's'}
                    {row.avgRating != null ? ` · ★ ${row.avgRating}` : ''}
                  </div>
                </div>
                <span className="lb-score">{Math.round(row.score)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card settings-card update-scan-card">
          <strong>Scan for updates</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Checks the server for a newer Schoolie build and asks this device for a waiting install.
            Use this when you want to confirm you&apos;re on the latest version.
          </p>

          {updateStatus.state === 'idle' && (
            <p className="update-status update-status-idle">
              Installed build: <strong>{formatVersionLabel()}</strong> · not checked yet this
              session
            </p>
          )}
          {updateStatus.state === 'checking' && (
            <div className="update-status update-status-checking">
              <div className="spinner spinner-inline" />
              Scanning for a newer version…
            </div>
          )}
          {updateStatus.state === 'current' && (
            <div className="update-status update-status-ok" role="status">
              <div className="update-status-title">✓ You&apos;re up to date</div>
              <p>{updateStatus.message}</p>
              <p className="muted update-checked-at">
                Checked {new Date(updateStatus.checkedAt).toLocaleString()} · server v
                {updateStatus.remoteVersion}
              </p>
            </div>
          )}
          {updateStatus.state === 'available' && (
            <div className="update-status update-status-new" role="status">
              <div className="update-status-title">↑ Update available</div>
              <p>{updateStatus.message}</p>
              <p className="muted update-checked-at">
                You: v{updateStatus.localVersion} · Server: v{updateStatus.remoteVersion}
              </p>
            </div>
          )}
          {updateStatus.state === 'error' && (
            <div className="update-status update-status-err" role="alert">
              <div className="update-status-title">Couldn&apos;t check</div>
              <p>{updateStatus.message}</p>
            </div>
          )}

          <div className="row-actions stack" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={updateStatus.state === 'checking'}
              onClick={() => void handleCheckUpdates()}
            >
              {updateStatus.state === 'checking' ? 'Scanning…' : 'Scan for updates'}
            </button>
            {updateStatus.state === 'available' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => applyWaitingUpdate()}
              >
                Reload to update now
              </button>
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor="projectName">Project name</label>
          <input
            id="projectName"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="My Schoolie"
          />
        </div>

        <div className="field">
          <label htmlFor="apiKey">Grok API key (xAI)</label>
          <input
            id="apiKey"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="xai-…"
          />
          <p className="muted" style={{ marginTop: 8 }}>
            When set, you&apos;ll see <strong>Grok is scanning the photo…</strong> after the on-device
            team. Key stays on this phone.{' '}
            <a href="https://console.x.ai" target="_blank" rel="noreferrer">
              console.x.ai
            </a>
          </p>
        </div>

        <div className="field">
          <label htmlFor="openaiApiKey">ChatGPT API key (OpenAI)</label>
          <input
            id="openaiApiKey"
            type="password"
            autoComplete="off"
            value={openaiApiKey}
            onChange={(e) => setOpenaiApiKey(e.target.value)}
            placeholder="sk-…"
          />
          <p className="muted" style={{ marginTop: 8 }}>
            When set, you&apos;ll see <strong>ChatGPT is scanning the photo…</strong> as a second
            cloud opinion. Key stays on this phone.{' '}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
              platform.openai.com
            </a>
          </p>
        </div>

        <div className="card settings-card">
          <strong>Install on your phone</strong>
          <ul className="help-list">
            <li>
              <strong>iPhone:</strong> Safari → Share → Add to Home Screen
            </li>
            <li>
              <strong>Android:</strong> Chrome → menu → Install app / Add to Home screen
            </li>
          </ul>
        </div>

        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>

        <button type="button" className="btn btn-danger" onClick={() => void props.onClear()}>
          Clear all purchase data
        </button>
      </form>
    </>
  )
}

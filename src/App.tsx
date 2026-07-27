import { useCallback, useEffect, useMemo, useState } from 'react'
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
} from './db'
import { downloadCsv, downloadPdfSummary } from './exportData'
import { formatMoney, parseMoneyInput } from './money'
import { parseReceiptImage } from './receiptAi'
import { categoryBreakdown, totalSpent } from './stats'
import type { AppSettings, CategoryId, Purchase, Screen } from './types'
import './index.css'

function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function emptyForm(partial?: Partial<Purchase>) {
  return {
    date: partial?.date ?? todayISO(),
    description: partial?.description ?? '',
    amount: partial?.amount != null ? String(partial.amount) : '',
    categoryId: (partial?.categoryId ?? 'misc') as CategoryId,
    vendor: partial?.vendor ?? '',
    notes: partial?.notes ?? '',
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [settings, setSettings] = useState<AppSettings>({
    apiKey: '',
    projectName: 'My Schoolie',
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([listPurchases(), getSettings()])
    setPurchases(p)
    setSettings(s)
  }, [])

  useEffect(() => {
    refresh()
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load data'))
      .finally(() => setLoading(false))
  }, [refresh])

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
    receiptBlob?: Blob | null
    existingReceiptImageId?: string | null
  }) {
    setError(null)
    const amount = parseMoneyInput(input.amountRaw)
    if (amount == null) {
      setError('Enter a valid amount.')
      return false
    }
    if (!input.description.trim()) {
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

    const purchase: Purchase = {
      id: input.id ?? newId(),
      date: input.date,
      description: input.description.trim(),
      amount,
      categoryId: input.categoryId,
      vendor: input.vendor.trim(),
      notes: input.notes.trim(),
      receiptImageId,
      createdAt: input.id
        ? (purchases.find((p) => p.id === input.id)?.createdAt ?? now)
        : now,
      updatedAt: now,
    }

    await savePurchase(purchase)
    await refresh()
    setInfo('Purchase saved.')
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
        />
      )}

      {screen.name === 'scan' && (
        <ScanScreen
          apiKey={settings.apiKey}
          onBack={() => setScreen({ name: 'home' })}
          onNeedSettings={() => setScreen({ name: 'settings' })}
          onParsed={(suggestion, blob, previewUrl) => {
            setScreen({
              name: 'add',
              initial: {
                date: suggestion.date ?? todayISO(),
                description: suggestion.description,
                amount: suggestion.amount ?? undefined,
                categoryId: suggestion.categoryId,
                vendor: suggestion.vendor,
                notes: suggestion.notes,
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
        />
      )}
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
}) {
  return (
    <>
      <header className="topbar">
        <div>
          <h1>{props.projectName}</h1>
          <div className="muted">Schoolie conversion costs</div>
        </div>
        <button type="button" className="icon-btn" aria-label="Settings" onClick={props.onSettings}>
          ⚙
        </button>
      </header>

      <section className="hero-card">
        <div className="hero-label">Total spent</div>
        <div className="hero-total">{formatMoney(props.total)}</div>
        <div className="hero-sub">
          {props.purchaseCount === 0
            ? 'No purchases yet — scan a receipt to start'
            : `${props.purchaseCount} purchase${props.purchaseCount === 1 ? '' : 's'} logged`}
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
                <span style={{ width: `${Math.max(c.percent, 2)}%`, background: c.color }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">
        <span>Recent</span>
        <span>
          <button type="button" className="muted" onClick={props.onExportCsv}>
            CSV
          </button>
          {' · '}
          <button type="button" className="muted" onClick={props.onExportPdf}>
            PDF
          </button>
        </span>
      </div>

      {props.purchases.length === 0 ? (
        <div className="empty">
          Tap <strong>Scan receipt</strong> to photograph a store receipt, or add one manually.
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
  onBack: () => void
  onNeedSettings: () => void
  onParsed: (
    suggestion: Awaited<ReturnType<typeof parseReceiptImage>>,
    blob: Blob,
    previewUrl: string,
  ) => void
  onManualWithPhoto: (blob: Blob, previewUrl: string) => void
  onError: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function handleFile(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      props.onError('Please choose a photo of the receipt.')
      return
    }

    const blob = file
    const previewUrl = URL.createObjectURL(blob)

    if (!props.apiKey.trim()) {
      props.onError('Add your xAI API key in Settings to auto-read receipts — or fill the form manually.')
      props.onManualWithPhoto(blob, previewUrl)
      return
    }

    setBusy(true)
    setStatus('Reading receipt… this can take a few seconds.')
    try {
      const suggestion = await parseReceiptImage(props.apiKey, blob)
      props.onParsed(suggestion, blob, previewUrl)
    } catch (e) {
      props.onError(e instanceof Error ? e.message : 'Scan failed')
      props.onManualWithPhoto(blob, previewUrl)
    } finally {
      setBusy(false)
      setStatus(null)
    }
  }

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={props.onBack} aria-label="Back">
          ←
        </button>
        <h1>Scan receipt</h1>
        <span style={{ width: 44 }} />
      </header>

      <div className="banner banner-info">
        Take a clear photo of the whole receipt. The app reads the text and suggests store, total,
        description, and schoolie category — you confirm before saving.
      </div>

      {busy ? (
        <div className="card" style={{ textAlign: 'center', padding: 28 }}>
          <div className="spinner" />
          <div>{status}</div>
        </div>
      ) : (
        <div className="scan-drop">
          <strong>Photograph or choose a receipt</strong>
          <p className="muted">Works best in good light, flat, and fully in frame.</p>
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
          {!props.apiKey.trim() && (
            <p className="muted" style={{ marginTop: 16 }}>
              No API key yet —{' '}
              <button type="button" style={{ textDecoration: 'underline' }} onClick={props.onNeedSettings}>
                open Settings
              </button>{' '}
              to enable auto-fill, or continue and enter details yourself.
            </p>
          )}
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

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

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
        <div className="field">
          <label htmlFor="amount">Amount</label>
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
          <label htmlFor="description">What did you buy?</label>
          <input
            id="description"
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            placeholder="e.g. Rigid foam insulation"
            required
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
      </div>

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
}) {
  const [projectName, setProjectName] = useState(props.settings.projectName)
  const [apiKey, setApiKey] = useState(props.settings.apiKey)
  const [saving, setSaving] = useState(false)

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={props.onBack} aria-label="Back">
          ←
        </button>
        <h1>Settings</h1>
        <span style={{ width: 44 }} />
      </header>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          setSaving(true)
          void props
            .onSave({ projectName: projectName.trim() || 'My Schoolie', apiKey: apiKey.trim() })
            .finally(() => setSaving(false))
        }}
      >
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
          <label htmlFor="apiKey">xAI API key (for receipt scanning)</label>
          <input
            id="apiKey"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="xai-…"
          />
          <p className="muted" style={{ marginTop: 8 }}>
            Stored only on this phone. Used to send receipt photos to xAI so the app can read totals
            and suggest categories. Get a key at{' '}
            <a href="https://console.x.ai" target="_blank" rel="noreferrer">
              console.x.ai
            </a>
            .
          </p>
        </div>

        <div className="card">
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

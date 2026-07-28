import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AiId } from './aiRoster'
import {
  AI_ROSTER,
  getAi,
  isAiEnabled,
  isCoreAi,
  isHeavyAi,
  sanitizeDisabledAis,
} from './aiRoster'
import { runAiStabilitySuite, type StabilitySuiteResult } from './aiStability'
import { probeDevice, type DeviceProbeResult } from './deviceProbe'
import {
  absorbCategoryLabels,
  allCategories,
  getCategory,
  type Category,
} from './categories'
import { normalizeCategoryInput } from './agents/keywords'
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
  getReceiptMemory,
  saveReceiptMemory,
  clearReceiptMemory,
  resetDatabase,
  getStorageNotice,
  clearStorageNotice,
} from './db'
import { learnFromPurchase, memoryStats } from './receiptMemory'
import { downloadCsv, downloadPdfSummary } from './exportData'
import {
  defaultLeaderboard,
  normalizeLeaderboard,
  rankLeaderboard,
  recordAiWin,
  recordFieldMarks,
  recordScanParticipation,
  reliabilityWeights,
  type LeaderboardMap,
} from './leaderboard'
import { isShippingLineItem, partitionLineItems } from './agents/lineItemsAgent'
import {
  emptyPartMarks,
  hasAnyWrongMark,
  snapshotFromSuggestion,
  type FieldMark,
  type RejectedScanSnapshot,
  type ScanPartMarks,
} from './agents/retryFeedback'
import { BrandLockup, LogoMark } from './Logo'
import {
  formatAmountForInput,
  formatMoney,
  parseMoneyInput,
  parseMoneyInputLoose,
  sanitizeMoneyTyping,
} from './money'
import { applyWaitingUpdate, notifyIfWaitingUpdate, setupPwaUpdates } from './pwa'
import { scanReceipt, type ScanResult } from './receiptAi'
import { regroupAllPurchases } from './regroup'
import { categoryBreakdown, groupPurchasesByCategory, totalSpent } from './stats'
import type {
  AppSettings,
  CategoryId,
  FieldSources,
  Purchase,
  ReceiptLineItem,
  Screen,
} from './types'
import {
  checkForAppUpdates,
  type UpdateCheckStatus,
} from './updateCheck'
import {
  blobToDataUrl,
  buildReportShell,
  listRemoteDebugReports,
  submitDebugReport,
  type RemoteDebugSummary,
} from './debugReport'
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
  partial?: Partial<Purchase> & {
    agentReport?: string
    activeAiLabel?: string
    rawText?: string
    confidence?: number
    source?: string
    subtotal?: number | null
    tax?: number | null
    fieldSources?: FieldSources
  },
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
    rawText: partial?.rawText ?? '',
    confidence: partial?.confidence,
    source: partial?.source ?? '',
    subtotal: partial?.subtotal ?? null,
    tax: partial?.tax ?? null,
    fieldSources: (partial?.fieldSources ?? {}) as FieldSources,
  }
}

/** Expand / scroll long text blocks so nothing is permanently clipped. */
function ExpandableBlock(props: {
  title?: string
  children: ReactNode
  collapsedMax?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const max = props.collapsedMax ?? 140
  return (
    <div className={`expandable-block${open ? ' expandable-open' : ''} ${props.className ?? ''}`}>
      {props.title ? <div className="expandable-title">{props.title}</div> : null}
      <div
        className="expandable-body"
        style={open ? undefined : { maxHeight: max }}
      >
        {props.children}
      </div>
      <button
        type="button"
        className="expandable-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Show less' : 'Show more · scroll / expand'}
      </button>
    </div>
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [settings, setSettings] = useState<AppSettings>({
    projectName: 'My Schoolie',
    lastSeenVersion: '',
    maxPowerMode: true,
    disabledAis: [],
    customCategories: [],
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
    let cancelled = false
    const boot = async () => {
      try {
        const s = await refresh()
        if (cancelled) return
        const notice = getStorageNotice()
        if (notice) {
          setInfo(notice)
          clearStorageNotice()
        }
        // localStorage path is permanent on this device — no scary "tabs" message
        if (s.lastSeenVersion !== APP_VERSION) {
          const entries = getUpdatesSince(s.lastSeenVersion || null)
          if (entries.length) {
            setWhatsNewMode(s.lastSeenVersion ? 'update' : 'update')
            setWhatsNew(entries)
          }
        }
      } catch (e) {
        if (!cancelled) {
          // Last-ditch: reset DB and try once more so user is never stuck on spinner
          try {
            await resetDatabase()
            const s = await refresh()
            if (cancelled) return
            setInfo(
              'Local database was rebuilt automatically so the app can open. Re-scan any receipts you need.',
            )
            if (s.lastSeenVersion !== APP_VERSION) {
              const entries = getUpdatesSince(s.lastSeenVersion || null)
              if (entries.length) setWhatsNew(entries)
            }
          } catch (e2) {
            setError(
              e2 instanceof Error
                ? e2.message
                : e instanceof Error
                  ? e.message
                  : 'Failed to load data.',
            )
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
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
  const customCats = settings.customCategories ?? []
  const categoryList = useMemo(() => allCategories(customCats), [customCats])
  const breakdown = useMemo(
    () => categoryBreakdown(purchases, customCats),
    [purchases, customCats],
  )
  const purchaseGroups = useMemo(
    () => groupPurchasesByCategory(purchases, customCats),
    [purchases, customCats],
  )

  async function handleRegroup() {
    if (!purchases.length) {
      setInfo('Scan a receipt first — then Regroup can sort it into categories.')
      return
    }
    setError(null)
    const { purchases: next, changed, labels } = regroupAllPurchases(purchases)
    const groupCount = new Set(next.map((p) => p.categoryId || 'misc')).size
    const nextCustom = absorbCategoryLabels(settings.customCategories ?? [], labels)
    if (
      nextCustom.length !== (settings.customCategories ?? []).length ||
      nextCustom.some((c, i) => c.id !== (settings.customCategories ?? [])[i]?.id)
    ) {
      const nextSettings = { ...settings, customCategories: nextCustom }
      await saveSettings(nextSettings)
      setSettings(nextSettings)
    }
    // Only rewrite receipts that actually moved
    const byId = new Map(purchases.map((p) => [p.id, p]))
    let saved = 0
    for (const p of next) {
      const prev = byId.get(p.id)
      if (
        !prev ||
        prev.categoryId !== p.categoryId ||
        JSON.stringify(prev.lineItems) !== JSON.stringify(p.lineItems)
      ) {
        await savePurchase(p)
        saved++
      }
    }
    await refresh()
    setInfo(
      changed === 0
        ? `Groups already match the AI categories — ${groupCount} group${groupCount === 1 ? '' : 's'} on the home screen.`
        : `Regrouped ${changed} receipt${changed === 1 ? '' : 's'} into ${groupCount} group${groupCount === 1 ? '' : 's'}.`,
    )
  }

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
    const amount = parseMoneyInputLoose(input.amountRaw)
    if (amount == null) {
      setError('Enter a valid amount (use a period for cents, e.g. 12.50).')
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

    // Free-form category: accept id or typed label
    const catNorm = normalizeCategoryInput(input.categoryId)
    const normalizedLines = lineItems.map((li) => {
      const n = normalizeCategoryInput(li.categoryId || catNorm.id)
      return { ...li, categoryId: n.id }
    })

    const aisUsed = input.aisUsed ?? []
    const purchase: Purchase = {
      id: input.id ?? newId(),
      date: input.date,
      description,
      amount,
      categoryId: catNorm.id,
      vendor: input.vendor.trim(),
      notes: input.notes.trim(),
      receiptImageId,
      lineItems: normalizedLines,
      aisUsed,
      bestAiId: input.bestAiId ?? null,
      createdAt: input.id
        ? (purchases.find((p) => p.id === input.id)?.createdAt ?? now)
        : now,
      updatedAt: now,
    }

    // Absorb AI/user categories so they group on home next time
    const labels = [
      catNorm.label,
      catNorm.id,
      ...normalizedLines.map((l) => l.categoryId),
    ]
    const nextCustom = absorbCategoryLabels(settings.customCategories ?? [], labels)
    if (nextCustom.length !== (settings.customCategories ?? []).length) {
      const nextSettings = { ...settings, customCategories: nextCustom }
      await saveSettings(nextSettings)
      setSettings(nextSettings)
    }

    await savePurchase(purchase)
    // On-device memory: learn vendor / fee habits / categories from what you confirmed
    try {
      const mem = await getReceiptMemory()
      await saveReceiptMemory(learnFromPurchase(mem, purchase))
    } catch {
      /* memory is best-effort */
    }
    if (input.bestAiId) {
      await recordAiWin(input.bestAiId, 5)
    }
    await refresh()
    setInfo(
      input.bestAiId
        ? `Purchase saved · ${getAi(input.bestAiId).name} got a win · phone memory updated`
        : 'Purchase saved · on-device memory updated for next scan.',
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
          <p className="muted" style={{ marginTop: 12, fontSize: '0.85rem' }}>
            If this never finishes, close other Schoolie tabs and hard-refresh.
          </p>
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
          <div style={{ marginBottom: 10 }}>{error}</div>
          <div className="row-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setError(null)
                setLoading(true)
                void refresh()
                  .then((s) => {
                    if (s.lastSeenVersion !== APP_VERSION) {
                      const entries = getUpdatesSince(s.lastSeenVersion || null)
                      if (entries.length) setWhatsNew(entries)
                    }
                  })
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : 'Still failed to load'),
                  )
                  .finally(() => setLoading(false))
              }}
            >
              Retry load
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                if (
                  !confirm(
                    'Reset local Schoolie data on this device? Purchases and receipt photos stored here will be deleted. Nothing is in the cloud.',
                  )
                ) {
                  return
                }
                setError(null)
                setLoading(true)
                void resetDatabase()
                  .then(() => refresh())
                  .then(() => setInfo('Local data reset — you can scan again.'))
                  .catch((e) =>
                    setError(
                      e instanceof Error
                        ? e.message
                        : 'Reset failed — clear site data in the browser for this page.',
                    ),
                  )
                  .finally(() => setLoading(false))
              }}
            >
              Reset local data
            </button>
            <button
              type="button"
              style={{ color: 'inherit', textDecoration: 'underline', background: 'none', border: 0 }}
              onClick={() => setError(null)}
            >
              dismiss
            </button>
          </div>
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
          groups={purchaseGroups}
          purchases={purchases}
          customCategories={customCats}
          onRegroup={handleRegroup}
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
          maxPowerMode={settings.maxPowerMode}
          disabledAis={settings.disabledAis ?? []}
          retryBlob={screen.retryBlob}
          retryPreviewUrl={screen.retryPreviewUrl}
          rejected={screen.rejected}
          onBack={() => setScreen({ name: 'home' })}
          onNeedSettings={() => setScreen({ name: 'settings' })}
          onParsed={(suggestion, blob, previewUrl) => {
            const aisUsed = (suggestion.aisUsed ?? []) as AiId[]
            void recordScanParticipation(aisUsed)
            setError(null)
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
                rawText: suggestion.rawText,
                confidence: suggestion.confidence,
                source: suggestion.source,
                subtotal: suggestion.subtotal,
                tax: suggestion.tax,
                fieldSources: suggestion.fieldSources,
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
          categories={categoryList}
          onBack={() => setScreen({ name: 'home' })}
          onTryAgain={
            screen.receiptBlob
              ? (formSnapshot) => {
                  setError(null)
                  setInfo(null)
                  const prev =
                    typeof formSnapshot.confidence === 'number' &&
                    /Retry #(\d+)/i.test(formSnapshot.activeAiLabel || '')
                      ? Number(RegExp.$1)
                      : 0
                  const fromLabel = /Retry #(\d+)/i.exec(formSnapshot.activeAiLabel || '')
                  const attempt = (fromLabel ? Number(fromLabel[1]) : prev) + 1 || 1
                  const amountNum = parseMoneyInputLoose(formSnapshot.amount)
                  const rejected = snapshotFromSuggestion({
                    amount: amountNum,
                    vendor: formSnapshot.vendor,
                    description: formSnapshot.description,
                    categoryId: formSnapshot.categoryId,
                    date: formSnapshot.date,
                    lineItems: formSnapshot.lineItems,
                    subtotal: formSnapshot.subtotal,
                    tax: formSnapshot.tax,
                    confidence: formSnapshot.confidence,
                    rawText: formSnapshot.rawText,
                    attempt: Math.max(1, attempt),
                    userNote: formSnapshot.reportNote || undefined,
                    marks: formSnapshot.partMarks,
                    fieldSources: formSnapshot.fieldSources,
                  })
                  // Weight AIs from ✓/✗ marks immediately
                  void (async () => {
                    const sources = formSnapshot.fieldSources ?? {}
                    const marks = formSnapshot.partMarks
                    if (!marks) return
                    const entries: { aiId: AiId; mark: 'right' | 'wrong' }[] = []
                    const push = (ai: AiId | undefined, m: FieldMark) => {
                      if (!ai || m === 'unset') return
                      if (m === 'right' || m === 'wrong') entries.push({ aiId: ai, mark: m })
                    }
                    push(sources.total, marks.total)
                    push(sources.vendor, marks.vendor)
                    push(sources.category, marks.category)
                    push(sources.date, marks.date)
                    push(sources.shipping, marks.shipping)
                    if (marks.missingItems === 'wrong' && sources.ocr) {
                      entries.push({ aiId: sources.ocr, mark: 'wrong' })
                      if (sources.lines) {
                        // lightly ding line agents too when list incomplete
                      }
                    }
                    for (const li of formSnapshot.lineItems) {
                      const m = marks.lines[li.id] ?? 'unset'
                      const ai = sources.lines?.[li.id]
                      push(ai, m)
                    }
                    if (entries.length) await recordFieldMarks(entries)
                  })()
                  setScreen({
                    name: 'scan',
                    retryBlob: screen.receiptBlob,
                    retryPreviewUrl: screen.receiptPreviewUrl,
                    rejected,
                  })
                }
              : undefined
          }
          onDebugMessage={(msg) => setInfo(msg)}
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
          categories={categoryList}
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
          customCategories={customCats}
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
  groups: ReturnType<typeof groupPurchasesByCategory>
  purchases: Purchase[]
  customCategories: Category[]
  onRegroup: () => void | Promise<void>
  onScan: () => void
  onAdd: () => void
  onOpen: (id: string) => void
  onSettings: () => void
  onExportCsv: () => void
  onExportPdf: () => void
  onShowVersion: () => void
}) {
  // Groups start expanded so the main screen shows receipts under each category
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [regroupBusy, setRegroupBusy] = useState(false)

  const isOpen = (id: string) => openGroups[id] !== false

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const currentlyOpen = prev[id] !== false
      return { ...prev, [id]: !currentlyOpen }
    })
  }

  async function runRegroup() {
    setRegroupBusy(true)
    try {
      await Promise.resolve(props.onRegroup())
    } finally {
      setRegroupBusy(false)
    }
  }

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
              : `${props.purchaseCount} purchase${props.purchaseCount === 1 ? '' : 's'} · ${props.groups.length} group${props.groups.length === 1 ? '' : 's'}`}
          </div>
          <div className="hero-pills">
            <span className="pill pill-accent">Free · local only</span>
            <span className="pill">Scan · remember · group</span>
          </div>
        </div>
      </section>

      <div className="section-title">
        <span>By category</span>
        <button
          type="button"
          className="regroup-btn"
          disabled={regroupBusy || props.purchases.length === 0}
          onClick={() => void runRegroup()}
          title="Re-run free AI categories on saved receipts and rebuild groups"
        >
          {regroupBusy ? 'Regrouping…' : 'Regroup'}
        </button>
      </div>
      {props.breakdown.length === 0 ? (
        <div className="empty empty-soft">
          <div className="empty-icon">📊</div>
          <p>
            After you scan, receipts land in groups the AI invents (engine parts, electrical, etc.).
            Tap <strong>Regroup</strong> anytime to re-sort.
          </p>
        </div>
      ) : (
        <div className="card category-list">
          {props.breakdown.map((c) => (
            <div key={c.categoryId} className="category-row">
              <span className="category-name">
                <span className="cat-dot" style={{ background: c.color }} />
                {c.label}
              </span>
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
          <p className="group-hint">
            Groups use the categories the free AIs assign when you scan. Press{' '}
            <strong>Regroup</strong> to re-apply that logic to everything already saved.
          </p>
        </div>
      )}

      <div className="section-title">
        <span>Groups</span>
        <span className="export-links">
          <button type="button" onClick={props.onExportCsv}>
            CSV
          </button>
          <button type="button" onClick={props.onExportPdf}>
            PDF
          </button>
        </span>
      </div>

      {props.groups.length === 0 ? (
        <div className="empty empty-soft">
          <div className="empty-icon">📷</div>
          <p>
            Tap <strong>Scan receipt</strong> to photograph a purchase. Free on-device AIs read it,
            pick a category, and it shows up in a group here.
          </p>
        </div>
      ) : (
        <div className="group-list">
          {props.groups.map((g) => {
            const open = isOpen(g.categoryId)
            return (
              <section key={g.categoryId} className="group-card">
                <button
                  type="button"
                  className="group-header"
                  onClick={() => toggleGroup(g.categoryId)}
                  aria-expanded={open}
                >
                  <span className="group-header-left">
                    <span className="group-chevron" aria-hidden>
                      {open ? '▼' : '▶'}
                    </span>
                    <span className="cat-dot" style={{ background: g.color }} />
                    <span className="group-title">{g.label}</span>
                  </span>
                  <span className="group-header-right">
                    <span className="group-total">{formatMoney(g.amount)}</span>
                    <span className="group-count">
                      {g.count} receipt{g.count === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
                {open && (
                  <div className="group-purchases">
                    {g.purchases.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="purchase-item purchase-item-in-group"
                        onClick={() => props.onOpen(p.id)}
                      >
                        <span className="purchase-title">{p.description || 'Purchase'}</span>
                        <span className="purchase-amount">{formatMoney(p.amount)}</span>
                        <span className="purchase-meta">
                          {p.date}
                          {p.vendor ? ` · ${p.vendor}` : ''}
                          {p.lineItems?.length
                            ? ` · ${p.lineItems.length} item${p.lineItems.length === 1 ? '' : 's'}`
                            : ''}
                          {p.receiptImageId ? ' · 📷' : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
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
          Scan receipt
        </button>
      </div>
    </>
  )
}

function ScanScreen(props: {
  maxPowerMode: boolean
  disabledAis: AiId[]
  retryBlob?: Blob
  retryPreviewUrl?: string
  rejected?: RejectedScanSnapshot
  onBack: () => void
  onNeedSettings: () => void
  onParsed: (suggestion: ScanResult, blob: Blob, previewUrl: string) => void
  onManualWithPhoto: (blob: Blob, previewUrl: string) => void
  onError: (msg: string) => void
}) {
  const [busy, setBusy] = useState(Boolean(props.retryBlob && props.rejected))
  const [status, setStatus] = useState<string | null>(
    props.rejected
      ? `Try again #${props.rejected.attempt}: telling the AIs the last answer was wrong…`
      : null,
  )
  const [progress, setProgress] = useState(0)
  const [activeAi, setActiveAi] = useState<{ name: string; id?: AiId } | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [heldBlob, setHeldBlob] = useState<Blob | null>(props.retryBlob ?? null)
  const [heldPreview, setHeldPreview] = useState<string | null>(props.retryPreviewUrl ?? null)
  const autoStarted = useRef(false)

  const whoWillScan = useMemo(() => {
    return AI_ROSTER.filter((a) =>
      isAiEnabled(a.id, {
        disabledAis: props.disabledAis,
        maxPowerMode: props.rejected ? true : props.maxPowerMode,
      }),
    ).map((a) => a.name)
  }, [props.maxPowerMode, props.disabledAis, props.rejected])

  async function runScan(
    blob: Blob,
    previewUrl: string,
    rejected?: RejectedScanSnapshot,
  ) {
    setScanError(null)
    setHeldBlob(blob)
    setHeldPreview(previewUrl)
    setBusy(true)
    setProgress(0.02)
    const isRetry = Boolean(rejected)
    setActiveAi({
      name: isRetry ? 'Arbiter' : props.maxPowerMode ? 'Hammer' : 'Forge',
      id: isRetry ? 'arbiter' : props.maxPowerMode ? 'hammer' : 'forge',
    })
    setStatus(
      isRetry
        ? `Try again #${rejected!.attempt}: telling the AIs the last answer was wrong…`
        : props.maxPowerMode
          ? 'Hammer is spinning up parallel OCR workers…'
          : 'Forge is deep-scanning the photo…',
    )
    try {
      const board = normalizeLeaderboard(await getLeaderboard())
      const suggestion = await scanReceipt(blob, {
        maxPower: isRetry ? true : props.maxPowerMode,
        disabledAis: props.disabledAis,
        rejected,
        reliability: reliabilityWeights(board),
        onProgress: (p) => {
          setProgress(p.progress)
          setStatus(p.message)
          if (p.aiName) setActiveAi({ name: p.aiName, id: p.aiId })
        },
      })
      props.onParsed(suggestion, blob, previewUrl)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed — try again or enter details manually.'
      setScanError(msg)
      props.onError(msg)
    } finally {
      setBusy(false)
      setStatus(null)
      setProgress(0)
      setActiveAi(null)
    }
  }

  // Auto-start when arriving from the form's Try again (with rejected snapshot)
  useEffect(() => {
    if (autoStarted.current) return
    if (props.retryBlob && props.rejected) {
      autoStarted.current = true
      const url = props.retryPreviewUrl ?? URL.createObjectURL(props.retryBlob)
      void runScan(props.retryBlob, url, props.rejected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount for this retry session
  }, [])

  async function handleFile(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setScanError('Please choose a photo of the receipt.')
      props.onError('Please choose a photo of the receipt.')
      return
    }
    const previewUrl = URL.createObjectURL(file)
    await runScan(file, previewUrl)
  }

  function clearHeldPhoto() {
    setHeldBlob(null)
    setHeldPreview(null)
    setScanError(null)
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
        {props.rejected ? (
          <>
            <strong>Retry #{props.rejected.attempt} — AIs know the last answer was wrong.</strong>{' '}
            They re-read the photo differently and avoid cloning total{' '}
            {props.rejected.amount != null
              ? `$${props.rejected.amount.toFixed(2)}`
              : 'and those line items'}
            . Still 100% on your phone.
          </>
        ) : (
          <>
            <strong>Free · local only · max power {props.maxPowerMode ? 'ON' : 'OFF'}.</strong>{' '}
            Layout-first OCR + on-device memory. No cloud keys. Photo never leaves this device for the
            free team.
          </>
        )}
      </div>

      {!busy && !props.rejected && (
        <div className="card capture-tips">
          <strong>Better photo = better read</strong>
          <ul className="tips-list">
            <li>Fill the frame with the receipt; crop out the table/hand</li>
            <li>Flatten the paper; avoid glare and shadows</li>
            <li>Include the total and any fee lines at the bottom</li>
            <li>After you save a fix, the phone remembers that store for next time</li>
          </ul>
        </div>
      )}

      {busy ? (
        <div className="card agent-status">
          {heldPreview && (
            <img className="receipt-preview receipt-preview-sm" src={heldPreview} alt="Scanning" />
          )}
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
      ) : scanError && heldBlob ? (
        <div className="card scan-retry-card">
          {heldPreview && (
            <img className="receipt-preview" src={heldPreview} alt="Receipt preview" />
          )}
          <div className="banner banner-error" role="alert" style={{ margin: 0 }}>
            {scanError}
          </div>
          <strong className="scan-retry-title">Scan didn&apos;t work</strong>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Try the same photo again, take a clearer shot, or type the purchase in.
          </p>
          <div className="row-actions stack" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                void runScan(
                  heldBlob,
                  heldPreview ?? URL.createObjectURL(heldBlob),
                  props.rejected
                    ? { ...props.rejected, attempt: props.rejected.attempt + 1 }
                    : undefined,
                )
              }
            >
              Try again
            </button>
            <label className="btn btn-secondary">
              New photo
              <input
                className="hidden-input"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  clearHeldPhoto()
                  void handleFile(e.target.files?.[0] ?? null)
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setScanError(null)
                props.onManualWithPhoto(heldBlob, heldPreview ?? URL.createObjectURL(heldBlob))
              }}
            >
              Enter manually
            </button>
          </div>
        </div>
      ) : heldBlob && heldPreview && !props.rejected ? (
        <div className="card scan-retry-card">
          <img className="receipt-preview" src={heldPreview} alt="Receipt preview" />
          <strong className="scan-retry-title">Ready to scan again</strong>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Re-run the free AIs on this photo, or pick a better shot.
          </p>
          <div className="row-actions stack" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void runScan(heldBlob, heldPreview)}
            >
              Try again
            </button>
            <label className="btn btn-secondary">
              New photo
              <input
                className="hidden-input"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  clearHeldPhoto()
                  void handleFile(e.target.files?.[0] ?? null)
                }}
              />
            </label>
            <button type="button" className="btn btn-secondary" onClick={clearHeldPhoto}>
              Cancel
            </button>
          </div>
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
            Check device strength?{' '}
            <button type="button" style={{ textDecoration: 'underline' }} onClick={props.onNeedSettings}>
              Settings → Scan this device
            </button>
          </p>
        </div>
      )}
    </>
  )
}

type FormState = ReturnType<typeof emptyForm>

/** Small “from AI” badge always visible after a scan */
function FromAiBadge(props: { aiId?: AiId; fallback?: string }) {
  if (!props.aiId && !props.fallback) return null
  if (!props.aiId) {
    return <span className="from-ai-badge from-ai-muted">{props.fallback}</span>
  }
  const ai = getAi(props.aiId)
  return (
    <span className="from-ai-badge" title={`This value came from ${ai.fullName}`}>
      {ai.emoji} <strong>{ai.name}</strong>
    </span>
  )
}

/** ✓ / ✗ mark control for a field or line; shows which AI produced it */
function MarkPair(props: {
  value: FieldMark
  onChange: (m: FieldMark) => void
  label?: string
  /** AI that produced this field/line — used for weighting */
  sourceAi?: AiId
  showAi?: boolean
}) {
  const aiName = props.sourceAi ? getAi(props.sourceAi).name : null
  return (
    <div className="mark-pair-wrap">
      {(props.showAi !== false) && props.sourceAi ? (
        <span className="mark-ai-chip" title={`Produced by ${aiName}`}>
          {getAi(props.sourceAi).emoji} {aiName}
        </span>
      ) : null}
      <div className="mark-pair" role="group" aria-label={props.label || 'Mark right or wrong'}>
        <button
          type="button"
          className={`mark-btn mark-right${props.value === 'right' ? ' mark-active' : ''}`}
          aria-pressed={props.value === 'right'}
          title={aiName ? `Looks right — credit ${aiName}` : 'Looks right'}
          onClick={() => props.onChange(props.value === 'right' ? 'unset' : 'right')}
        >
          ✓
        </button>
        <button
          type="button"
          className={`mark-btn mark-wrong${props.value === 'wrong' ? ' mark-active' : ''}`}
          aria-pressed={props.value === 'wrong'}
          title={aiName ? `Looks wrong — ding ${aiName}` : 'Looks wrong'}
          onClick={() => props.onChange(props.value === 'wrong' ? 'unset' : 'wrong')}
        >
          ✗
        </button>
      </div>
    </div>
  )
}

function CategoryField(props: {
  id: string
  value: string
  categories: Category[]
  onChange: (id: string) => void
  label?: string
}) {
  const listId = `${props.id}-list`
  const display =
    props.categories.find((c) => c.id === props.value)?.label ?? props.value
  return (
    <>
      {props.label ? <label htmlFor={props.id}>{props.label}</label> : null}
      <input
        id={props.id}
        list={listId}
        value={display === props.value ? props.value : display}
        onChange={(e) => {
          const raw = e.target.value
          const match = props.categories.find(
            (c) => c.label === raw || c.id === raw,
          )
          if (match) props.onChange(match.id)
          else props.onChange(raw)
        }}
        onBlur={(e) => {
          const n = normalizeCategoryInput(e.target.value)
          props.onChange(n.id)
        }}
        placeholder="Type a category (e.g. Engine parts)"
        autoComplete="off"
      />
      <datalist id={listId}>
        {props.categories.map((c) => (
          <option key={c.id} value={c.label} />
        ))}
      </datalist>
      <p className="muted mark-hint" style={{ marginTop: 4 }}>
        Free-form — pick a suggestion or type a new one. Similar spends group under the same name.
      </p>
    </>
  )
}

function PurchaseFormScreen(props: {
  title: string
  initial: FormState
  receiptPreviewUrl?: string
  receiptBlob?: Blob
  existingReceiptImageId?: string | null
  categories: Category[]
  onBack: () => void
  /** Re-run scan; passes form + ✓/✗ marks so AIs fix only wrong parts */
  onTryAgain?: (
    snapshot: FormState & { reportNote?: string; partMarks?: ScanPartMarks },
  ) => void
  onSave: (form: FormState, receiptBlob?: Blob | null) => Promise<void>
  onDebugMessage?: (msg: string) => void
}) {
  const [form, setForm] = useState(props.initial)
  const [saving, setSaving] = useState(false)
  const [showAgentReport, setShowAgentReport] = useState(Boolean(props.initial.agentReport))
  const [reporting, setReporting] = useState(false)
  const [reportNote, setReportNote] = useState('')
  const [partMarks, setPartMarks] = useState<ScanPartMarks>(() => emptyPartMarks())
  /** Draft strings so typing "12." keeps the period (line amounts are numbers in state). */
  const [lineAmountDrafts, setLineAmountDrafts] = useState<Record<string, string>>({})

  function setMark(key: keyof Omit<ScanPartMarks, 'lines'>, m: FieldMark) {
    setPartMarks((prev) => ({ ...prev, [key]: m }))
  }

  function setLineMark(id: string, m: FieldMark) {
    setPartMarks((prev) => ({
      ...prev,
      lines: { ...prev.lines, [id]: m },
    }))
  }

  function requestTryAgain() {
    props.onTryAgain?.({
      ...form,
      reportNote: reportNote.trim() || undefined,
      partMarks,
    })
  }

  const wrongCount =
    (partMarks.total === 'wrong' ? 1 : 0) +
    (partMarks.vendor === 'wrong' ? 1 : 0) +
    (partMarks.category === 'wrong' ? 1 : 0) +
    (partMarks.date === 'wrong' ? 1 : 0) +
    (partMarks.missingItems === 'wrong' ? 1 : 0) +
    (partMarks.shipping === 'wrong' ? 1 : 0) +
    (partMarks.fees === 'wrong' ? 1 : 0) +
    Object.values(partMarks.lines).filter((m) => m === 'wrong').length

  const fromScan = Boolean(props.receiptBlob || props.receiptPreviewUrl)
  const lowConfidence =
    typeof form.confidence === 'number' && form.confidence > 0 && form.confidence < 0.55
  const looksThin =
    fromScan &&
    (!form.amount ||
      !form.description.trim() ||
      (form.lineItems.length === 0 && (form.confidence ?? 0) < 0.7))

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleReportBadScan() {
    if (!props.receiptBlob && !props.receiptPreviewUrl) {
      props.onDebugMessage?.('No receipt image to attach — scan again first.')
      return
    }
    setReporting(true)
    try {
      let dataUrl = ''
      let mime = 'image/jpeg'
      if (props.receiptBlob) {
        dataUrl = await blobToDataUrl(props.receiptBlob)
        mime = props.receiptBlob.type || 'image/jpeg'
      } else if (props.receiptPreviewUrl?.startsWith('data:')) {
        dataUrl = props.receiptPreviewUrl
      } else if (props.receiptPreviewUrl) {
        const res = await fetch(props.receiptPreviewUrl)
        const b = await res.blob()
        dataUrl = await blobToDataUrl(b)
        mime = b.type || 'image/jpeg'
      }

      const amountNum = parseMoneyInputLoose(form.amount)
      const report = buildReportShell({
        userNote: reportNote,
        receiptDataUrl: dataUrl,
        receiptMime: mime,
        suggestion: {
          date: form.date || null,
          vendor: form.vendor,
          amount: amountNum,
          description: form.description,
          categoryId: form.categoryId,
          notes: form.notes,
          lineItems: form.lineItems,
          agentReport: form.agentReport,
          aisUsed: form.aisUsed,
          activeAiLabel: form.activeAiLabel,
          confidence: form.confidence,
          rawText: form.rawText,
          source: form.source,
          subtotal: form.subtotal,
          tax: form.tax,
        },
        formSnapshot: {
          date: form.date,
          vendor: form.vendor,
          amount: form.amount,
          description: form.description,
          categoryId: form.categoryId,
          notes: form.notes,
          lineItems: form.lineItems,
        },
      })

      const result = await submitDebugReport(report)
      if (result.ok && result.mode === 'server') {
        props.onDebugMessage?.(
          `Bad scan reported. Saved as ${result.id} — the coding agent can open debug-scans/${result.id}/`,
        )
      } else if (result.ok && result.mode === 'download') {
        props.onDebugMessage?.(
          'Downloaded debug JSON (server not reachable). Share that file in chat so the agent can inspect the scan.',
        )
      } else {
        props.onDebugMessage?.('Could not save debug report.')
      }
    } catch (e) {
      props.onDebugMessage?.(e instanceof Error ? e.message : 'Report failed')
    } finally {
      setReporting(false)
    }
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
  const {
    products: productLines,
    shipping: shippingLines,
    fees: feeLines,
  } = partitionLineItems(form.lineItems)
  const productSum = productLines.reduce((s, li) => s + (Number(li.amount) || 0), 0)
  const shippingSum = shippingLines.reduce((s, li) => s + (Number(li.amount) || 0), 0)
  const feeSum = feeLines.reduce((s, li) => s + (Number(li.amount) || 0), 0)

  function renderLineRow(li: (typeof form.lineItems)[0], tone?: 'shipping' | 'fee') {
    const mark = partMarks.lines[li.id] ?? 'unset'
    const sourceAi =
      tone === 'shipping'
        ? form.fieldSources?.shipping ?? form.fieldSources?.lines?.[li.id]
        : form.fieldSources?.lines?.[li.id]
    const longDesc = (li.description || '').length > 48
    return (
      <div
        key={li.id}
        className={`line-item-row${tone === 'shipping' ? ' line-item-row-shipping' : ''}${tone === 'fee' ? ' line-item-row-fee' : ''}${mark === 'wrong' ? ' line-item-marked-wrong' : ''}${mark === 'right' ? ' line-item-marked-right' : ''}`}
      >
        <div className="line-item-meta-row">
          <FromAiBadge aiId={sourceAi} fallback={fromScan ? 'Team' : undefined} />
          {props.onTryAgain && (
            <MarkPair
              label={`Mark ${li.description || 'line'}`}
              value={mark}
              sourceAi={sourceAi}
              showAi={false}
              onChange={(m) => setLineMark(li.id, m)}
            />
          )}
        </div>
        {longDesc ? (
          <div className="line-item-desc-wrap">
            <ExpandableBlock collapsedMax={56} className="line-expand">
              <textarea
                className="line-item-desc line-item-desc-tall"
                value={li.description}
                placeholder="Item"
                rows={3}
                onChange={(e) => updateLine(li.id, { description: e.target.value })}
              />
            </ExpandableBlock>
          </div>
        ) : (
          <input
            className="line-item-desc"
            value={li.description}
            placeholder="Item"
            onChange={(e) => updateLine(li.id, { description: e.target.value })}
          />
        )}
        <input
          className="line-item-amt"
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          value={
            lineAmountDrafts[li.id] !== undefined
              ? lineAmountDrafts[li.id]
              : formatAmountForInput(li.amount)
          }
          placeholder="0.00"
          onChange={(e) => {
            const typed = sanitizeMoneyTyping(e.target.value)
            setLineAmountDrafts((d) => ({ ...d, [li.id]: typed }))
            const n = parseMoneyInput(typed)
            // Keep number in sync when complete; leave last good value while typing "12."
            if (n != null) updateLine(li.id, { amount: n })
            else if (typed === '' || typed === '.') updateLine(li.id, { amount: 0 })
          }}
          onBlur={() => {
            const draft = lineAmountDrafts[li.id]
            if (draft !== undefined) {
              const n = parseMoneyInputLoose(draft)
              updateLine(li.id, { amount: n ?? 0 })
              setLineAmountDrafts((d) => {
                const next = { ...d }
                delete next[li.id]
                return next
              })
            }
          }}
        />
        <input
          className="line-item-cat"
          list={`line-cat-${li.id}`}
          value={
            props.categories.find((c) => c.id === li.categoryId)?.label ?? li.categoryId
          }
          onChange={(e) => {
            const raw = e.target.value
            const match = props.categories.find((c) => c.label === raw || c.id === raw)
            updateLine(li.id, { categoryId: match ? match.id : raw })
          }}
          onBlur={(e) => {
            const n = normalizeCategoryInput(e.target.value)
            updateLine(li.id, { categoryId: n.id })
          }}
          aria-label="Item category"
          placeholder="Category"
        />
        <datalist id={`line-cat-${li.id}`}>
          {props.categories.map((c) => (
            <option key={c.id} value={c.label} />
          ))}
        </datalist>
        <button
          type="button"
          className="line-item-remove"
          aria-label="Remove line"
          onClick={() => removeLine(li.id)}
        >
          ×
        </button>
      </div>
    )
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

      {props.onTryAgain && fromScan && (
        <div
          className={`card scan-retry-card ${lowConfidence || looksThin || wrongCount > 0 ? 'scan-retry-card-warn' : ''}`}
        >
          <strong className="scan-retry-title">
            {wrongCount > 0
              ? `${wrongCount} part${wrongCount === 1 ? '' : 's'} marked wrong`
              : lowConfidence || looksThin
                ? 'Scan looks incomplete'
                : 'Mark what’s right or wrong'}
          </strong>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Tap <strong>✗</strong> only on what’s wrong. Anything you leave unmarked is treated as{' '}
            <strong>correct</strong> and kept. Optional <strong>✓</strong> also locks a field.
            {typeof form.confidence === 'number' ? (
              <>
                {' '}
                Confidence: <strong>{Math.round(form.confidence * 100)}%</strong>
              </>
            ) : null}
          </p>
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={requestTryAgain}
              disabled={wrongCount === 0 && !hasAnyWrongMark(partMarks) && !reportNote.trim()}
              title={
                wrongCount === 0
                  ? 'Mark at least one ✗ (or write a note) before re-scanning'
                  : 'Re-scan focusing on marked-wrong parts'
              }
            >
              {wrongCount > 0 ? 'Fix marked parts' : 'Mark ✗ then fix'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={requestTryAgain}
            >
              Retry all
            </button>
          </div>
        </div>
      )}

      {(form.activeAiLabel || form.aisUsed.length > 0 || form.fieldSources?.primary) && (
        <div className="card answer-credit-card">
          <div className="answer-credit-head">
            <span className="answer-credit-kicker">Who answered this scan</span>
            {form.fieldSources?.primary ? (
              <div className="answer-credit-primary">
                <span className="answer-credit-emoji">{getAi(form.fieldSources.primary).emoji}</span>
                <div>
                  <strong>{getAi(form.fieldSources.primary).name}</strong>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    Primary credit · {getAi(form.fieldSources.primary).role}
                  </div>
                </div>
              </div>
            ) : (
              <strong>{form.activeAiLabel || 'On-device team'}</strong>
            )}
          </div>
          <p className="muted answer-credit-label">
            {form.fieldSources?.answerLabel || form.activeAiLabel || 'Team huddle result'}
          </p>
          <div className="answer-credit-grid">
            {form.fieldSources?.ocr && (
              <div className="answer-credit-cell">
                <span className="muted">OCR</span>
                <FromAiBadge aiId={form.fieldSources.ocr} />
              </div>
            )}
            {form.fieldSources?.total && (
              <div className="answer-credit-cell">
                <span className="muted">Total</span>
                <FromAiBadge aiId={form.fieldSources.total} />
              </div>
            )}
            {form.fieldSources?.vendor && (
              <div className="answer-credit-cell">
                <span className="muted">Vendor</span>
                <FromAiBadge aiId={form.fieldSources.vendor} />
              </div>
            )}
            {form.fieldSources?.category && (
              <div className="answer-credit-cell">
                <span className="muted">Category</span>
                <FromAiBadge aiId={form.fieldSources.category} />
              </div>
            )}
            {form.fieldSources?.shipping && (
              <div className="answer-credit-cell">
                <span className="muted">Shipping</span>
                <FromAiBadge aiId={form.fieldSources.shipping} />
              </div>
            )}
            {form.fieldSources?.fees && (
              <div className="answer-credit-cell">
                <span className="muted">Fees</span>
                <FromAiBadge aiId={form.fieldSources.fees} />
              </div>
            )}
          </div>
          {form.aisUsed.length > 0 && (
            <ExpandableBlock collapsedMax={52} className="answer-credit-team">
              <div className="muted" style={{ fontSize: '0.78rem' }}>
                Full team: {form.aisUsed.map((id) => `${getAi(id).emoji} ${getAi(id).name}`).join(' · ')}
              </div>
            </ExpandableBlock>
          )}
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
            <ExpandableBlock collapsedMax={160} className="agent-report-expand">
              <pre className="agent-report-body agent-report-body-in-expand">{form.agentReport}</pre>
            </ExpandableBlock>
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
            <div className="field-label-row">
              <label>Line items ({form.lineItems.length})</label>
              {props.onTryAgain && (
                <MarkPair
                  label="Missing products"
                  value={partMarks.missingItems}
                  onChange={(m) => setMark('missingItems', m)}
                />
              )}
            </div>
            {props.onTryAgain && (
              <p className="muted mark-hint">
                ✗ on “missing products” = list is incomplete. ✗ on a row = that line is wrong.
              </p>
            )}

            {productLines.length > 0 && (
              <div className="line-section">
                <div className="line-section-head">
                  <span>Products</span>
                  <span className="muted">{formatMoney(productSum)}</span>
                </div>
                <div className="line-items-list">{productLines.map((li) => renderLineRow(li))}</div>
              </div>
            )}

            <div className="line-section line-section-shipping">
              <div className="line-section-head">
                <span>Shipping</span>
                <div className="line-section-head-right">
                  <span className="muted">{formatMoney(shippingSum)}</span>
                  {props.onTryAgain && (
                    <MarkPair
                      label="Shipping section"
                      value={partMarks.shipping}
                      sourceAi={form.fieldSources?.shipping}
                      onChange={(m) => setMark('shipping', m)}
                    />
                  )}
                </div>
              </div>
              {shippingLines.length > 0 ? (
                <div className="line-items-list">
                  {shippingLines.map((li) => renderLineRow(li, 'shipping'))}
                </div>
              ) : props.onTryAgain ? (
                <p className="muted mark-hint">
                  No shipping line yet — mark ✗ if shipping should be on the receipt.
                </p>
              ) : null}
            </div>

            <div className="line-section line-section-fees">
              <div className="line-section-head">
                <span>Fees</span>
                <div className="line-section-head-right">
                  <span className="muted">{formatMoney(feeSum)}</span>
                  {props.onTryAgain && (
                    <MarkPair
                      label="Fees section"
                      value={partMarks.fees}
                      onChange={(m) => setMark('fees', m)}
                    />
                  )}
                </div>
              </div>
              {feeLines.length > 0 ? (
                <div className="line-items-list">
                  {feeLines.map((li) => renderLineRow(li, 'fee'))}
                </div>
              ) : props.onTryAgain ? (
                <p className="muted mark-hint">
                  No fee line yet (convenience / service / processing). Mark ✗ if one is missing.
                </p>
              ) : null}
            </div>

            {/* Fallback if partitions empty but items exist (manual edge cases) */}
            {productLines.length === 0 &&
              shippingLines.length === 0 &&
              feeLines.length === 0 && (
                <div className="line-items-list">
                  {form.lineItems.map((li) => renderLineRow(li))}
                </div>
              )}

            <div className="line-items-foot">
              <span className="muted">
                All lines {formatMoney(itemsSum)}
                {shippingSum > 0 ? ` · ship ${formatMoney(shippingSum)}` : ''}
                {feeSum > 0 ? ` · fees ${formatMoney(feeSum)}` : ''}
              </span>
              <div className="line-items-foot-actions">
                <button
                  type="button"
                  className="version-link"
                  onClick={() => {
                    setForm((f) => {
                      if (f.lineItems.some((li) => isShippingLineItem(li.description))) return f
                      return {
                        ...f,
                        lineItems: [
                          ...f.lineItems,
                          {
                            id: `ship-${crypto.randomUUID()}`,
                            description: 'Shipping',
                            amount: 0,
                            categoryId: 'misc' as CategoryId,
                          },
                        ],
                      }
                    })
                  }}
                >
                  + Shipping
                </button>
                <button
                  type="button"
                  className="version-link"
                  onClick={() => {
                    setForm((f) => {
                      if (
                        f.lineItems.some((li) =>
                          /\b(convenience|service fee|processing fee)\b/i.test(li.description),
                        )
                      ) {
                        return f
                      }
                      return {
                        ...f,
                        lineItems: [
                          ...f.lineItems,
                          {
                            id: `fee-${crypto.randomUUID()}`,
                            description: 'Convenience fee',
                            amount: 0,
                            categoryId: 'misc' as CategoryId,
                          },
                        ],
                      }
                    })
                  }}
                >
                  + Fee
                </button>
                <button type="button" className="version-link" onClick={addLine}>
                  + Add line
                </button>
              </div>
            </div>
          </div>
        )}

        {form.lineItems.length === 0 && (
          <div className="field">
            <div className="field-label-row">
              <button type="button" className="btn btn-secondary" onClick={addLine}>
                + Add line items
              </button>
              {props.onTryAgain && (
                <MarkPair
                  label="Missing products"
                  value={partMarks.missingItems}
                  onChange={(m) => setMark('missingItems', m)}
                />
              )}
            </div>
            {props.onTryAgain && partMarks.missingItems === 'wrong' && (
              <p className="muted mark-hint">Marked missing — Fix marked parts will hunt for items.</p>
            )}
          </div>
        )}

        <div className={`field${partMarks.total === 'wrong' ? ' field-marked-wrong' : ''}${partMarks.total === 'right' ? ' field-marked-right' : ''}`}>
          <div className="field-label-row">
            <label htmlFor="amount">Amount (total paid)</label>
            <div className="field-label-right">
              <FromAiBadge aiId={form.fieldSources?.total} fallback={fromScan ? 'Cashier' : undefined} />
              {props.onTryAgain && (
                <MarkPair
                  label="Total"
                  value={partMarks.total}
                  sourceAi={form.fieldSources?.total}
                  showAi={false}
                  onChange={(m) => setMark('total', m)}
                />
              )}
            </div>
          </div>
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => update('amount', sanitizeMoneyTyping(e.target.value))}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="description">Summary</label>
          {(form.description || '').length > 60 ? (
            <ExpandableBlock collapsedMax={64}>
              <textarea
                id="description"
                className="expandable-textarea"
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                placeholder="e.g. Rigid foam insulation"
                rows={3}
              />
            </ExpandableBlock>
          ) : (
            <input
              id="description"
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="e.g. Rigid foam insulation"
            />
          )}
        </div>
        <div className={`field${partMarks.category === 'wrong' ? ' field-marked-wrong' : ''}${partMarks.category === 'right' ? ' field-marked-right' : ''}`}>
          <div className="field-label-row">
            <label htmlFor="category">Category</label>
            <div className="field-label-right">
              <FromAiBadge aiId={form.fieldSources?.category} fallback={fromScan ? 'Ledger' : undefined} />
              {props.onTryAgain && (
                <MarkPair
                  label="Category"
                  value={partMarks.category}
                  sourceAi={form.fieldSources?.category}
                  showAi={false}
                  onChange={(m) => setMark('category', m)}
                />
              )}
            </div>
          </div>
          <CategoryField
            id="category"
            value={form.categoryId}
            categories={props.categories}
            onChange={(id) => update('categoryId', id)}
          />
        </div>
        <div className={`field${partMarks.vendor === 'wrong' ? ' field-marked-wrong' : ''}${partMarks.vendor === 'right' ? ' field-marked-right' : ''}`}>
          <div className="field-label-row">
            <label htmlFor="vendor">Store / vendor</label>
            <div className="field-label-right">
              <FromAiBadge aiId={form.fieldSources?.vendor} fallback={fromScan ? 'Clerk' : undefined} />
              {props.onTryAgain && (
                <MarkPair
                  label="Vendor"
                  value={partMarks.vendor}
                  sourceAi={form.fieldSources?.vendor}
                  showAi={false}
                  onChange={(m) => setMark('vendor', m)}
                />
              )}
            </div>
          </div>
          {(form.vendor || '').length > 40 ? (
            <ExpandableBlock collapsedMax={56}>
              <textarea
                id="vendor"
                className="expandable-textarea"
                value={form.vendor}
                onChange={(e) => update('vendor', e.target.value)}
                placeholder="Home Depot, Amazon…"
                rows={2}
              />
            </ExpandableBlock>
          ) : (
            <input
              id="vendor"
              value={form.vendor}
              onChange={(e) => update('vendor', e.target.value)}
              placeholder="Home Depot, Amazon…"
            />
          )}
        </div>
        <div className={`field${partMarks.date === 'wrong' ? ' field-marked-wrong' : ''}${partMarks.date === 'right' ? ' field-marked-right' : ''}`}>
          <div className="field-label-row">
            <label htmlFor="date">Date</label>
            <div className="field-label-right">
              <FromAiBadge aiId={form.fieldSources?.date} fallback={fromScan ? 'Clerk' : undefined} />
              {props.onTryAgain && (
                <MarkPair
                  label="Date"
                  value={partMarks.date}
                  sourceAi={form.fieldSources?.date}
                  showAi={false}
                  onChange={(m) => setMark('date', m)}
                />
              )}
            </div>
          </div>
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
          <ExpandableBlock collapsedMax={88}>
            <textarea
              id="notes"
              className="expandable-textarea"
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Optional"
              rows={4}
            />
          </ExpandableBlock>
        </div>
        <div className="row-actions">
          <button type="button" className="btn btn-secondary" onClick={props.onBack}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {(props.receiptBlob || props.receiptPreviewUrl) && (
          <div className="card settings-card debug-report-card">
            <strong>Still wrong after a retry?</strong>
            <p className="muted" style={{ margin: '6px 0 10px' }}>
              Report this scan so the coding agent can see the receipt photo, OCR text, and what each
              AI produced.
            </p>
            {props.onTryAgain && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', marginBottom: 12 }}
                onClick={requestTryAgain}
              >
                {wrongCount > 0
                  ? `Fix ${wrongCount} marked part${wrongCount === 1 ? '' : 's'}`
                  : 'Retry scan (or mark ✗ above first)'}
              </button>
            )}
            <div className="field">
              <label htmlFor="debugNote">What went wrong? (optional note)</label>
              <textarea
                id="debugNote"
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
                placeholder="e.g. Missed the $26.75 filter, shipping should be $9.95…"
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={reporting}
              onClick={() => void handleReportBadScan()}
            >
              {reporting ? 'Reporting…' : 'Report bad scan for debugging'}
            </button>
          </div>
        )}
      </form>
    </>
  )
}

function EditPurchaseScreen(props: {
  purchaseId: string
  categories: Category[]
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
      categories={props.categories}
      onBack={props.onBack}
      onSave={async (f) => {
        await props.onSave(f, receiptId)
      }}
    />
  )
}

function DetailScreen(props: {
  purchaseId: string
  customCategories: Category[]
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

  const cat = getCategory(purchase.categoryId, props.customCategories)

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
            {(() => {
              const parts = partitionLineItems(purchase.lineItems)
              const ordered = [
                ...parts.products,
                ...parts.shipping,
                ...parts.fees,
              ]
              // if partition missed any (edge cases), fall back to original order
              const shown =
                ordered.length === purchase.lineItems.length
                  ? ordered
                  : purchase.lineItems
              return shown.map((li) => (
                <div
                  key={li.id}
                  className={`detail-row${isShippingLineItem(li.description) ? ' detail-row-shipping' : ''}`}
                >
                  <span className="detail-label">
                    {isShippingLineItem(li.description) ? `🚚 ${li.description}` : li.description}
                    <span className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                      {getCategory(li.categoryId, props.customCategories).label}
                    </span>
                  </span>
                  <span className="detail-value">{formatMoney(li.amount)}</span>
                </div>
              ))
            })()}
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

/** On-device learnings from saved receipts — never uploaded */
function OnDeviceMemoryCard() {
  const [stats, setStats] = useState<{ vendors: number; hints: number } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getReceiptMemory()
      .then((m) => setStats(memoryStats(m)))
      .catch(() => setStats({ vendors: 0, hints: 0 }))
  }, [])

  async function clearMem() {
    if (!confirm('Clear on-device receipt memory? The free AIs will forget store habits you taught them.')) {
      return
    }
    setBusy(true)
    try {
      await clearReceiptMemory()
      setStats({ vendors: 0, hints: 0 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card settings-card">
      <strong>On-device memory</strong>
      <p className="muted" style={{ margin: '6px 0 12px' }}>
        When you save a receipt (or fix fees / category), this phone remembers that store and
        product words for the next scan. <strong>Nothing is uploaded</strong> — free and local only.
      </p>
      <p style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>
        {stats == null
          ? 'Loading…'
          : stats.vendors === 0 && stats.hints === 0
            ? 'No memories yet — save a few receipts to teach the phone.'
            : `${stats.vendors} store${stats.vendors === 1 ? '' : 's'} · ${stats.hints} category hint${stats.hints === 1 ? '' : 's'}`}
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy || (stats != null && stats.vendors === 0 && stats.hints === 0)}
        onClick={() => void clearMem()}
      >
        {busy ? 'Clearing…' : 'Clear memory'}
      </button>
    </div>
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
  const [maxPowerMode, setMaxPowerMode] = useState(props.settings.maxPowerMode !== false)
  const [disabledAis, setDisabledAis] = useState<AiId[]>(
    () => sanitizeDisabledAis(props.settings.disabledAis ?? []),
  )
  const [saving, setSaving] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckStatus>({ state: 'idle' })
  const [board, setBoard] = useState<LeaderboardMap>(defaultLeaderboard())
  const [debugReports, setDebugReports] = useState<RemoteDebugSummary[]>([])
  const [debugLoading, setDebugLoading] = useState(false)
  const [deviceProbe, setDeviceProbe] = useState<DeviceProbeResult | null>(null)
  const [probing, setProbing] = useState(false)
  const [stability, setStability] = useState<StabilitySuiteResult | null>(null)
  const [stabilityRunning, setStabilityRunning] = useState(false)
  const [stabilityStatus, setStabilityStatus] = useState('')

  useEffect(() => {
    void getLeaderboard().then((b) => setBoard(normalizeLeaderboard(b)))
    void listRemoteDebugReports().then(setDebugReports)
  }, [])

  const ranked = useMemo(() => rankLeaderboard(board), [board])

  async function refreshDebugReports() {
    setDebugLoading(true)
    try {
      setDebugReports(await listRemoteDebugReports())
    } finally {
      setDebugLoading(false)
    }
  }

  async function handleDeviceScan() {
    setProbing(true)
    try {
      setDeviceProbe(await probeDevice())
    } finally {
      setProbing(false)
    }
  }

  async function handleStabilityTest() {
    setStabilityRunning(true)
    setStabilityStatus('Starting free AI stability suite…')
    try {
      const result = await runAiStabilitySuite({}, (msg) => setStabilityStatus(msg))
      setStability(result)
      setStabilityStatus(result.summary)
    } catch (e) {
      setStabilityStatus(e instanceof Error ? e.message : 'Stability test failed')
    } finally {
      setStabilityRunning(false)
    }
  }

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
              lastSeenVersion: props.settings.lastSeenVersion,
              maxPowerMode,
              disabledAis: sanitizeDisabledAis(disabledAis),
              customCategories: props.settings.customCategories ?? [],
            })
            .finally(() => setSaving(false))
        }}
      >
        <div className="card settings-card">
          <strong>Max power mode</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Quick switch: when off, all <strong>heavy</strong> free AIs are skipped (Hammer, Titan,
            Mosaic, Bloom, Prism, Council, …). Everything stays on this phone — no API keys.
          </p>
          <label className="power-toggle">
            <input
              type="checkbox"
              checked={maxPowerMode}
              onChange={(e) => setMaxPowerMode(e.target.checked)}
            />
            <span>{maxPowerMode ? 'ON — heavy free AIs allowed' : 'OFF — light free team only'}</span>
          </label>
        </div>

        <OnDeviceMemoryCard />

        <div className="card settings-card">
          <strong>Free AIs — enable / disable</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Every AI here is free and needs no API key. Heavy ones may not run well on older phones —
            just turn them off. Core AIs (needed for a basic scan) stay on.
          </p>
          <div className="ai-toggle-list">
            {AI_ROSTER.map((ai) => {
              const core = isCoreAi(ai.id)
              const on = isAiEnabled(ai.id, { disabledAis, maxPowerMode })
              const forcedOffByLight = !maxPowerMode && isHeavyAi(ai.id) && !core
              return (
                <label
                  key={ai.id}
                  className={`ai-toggle-row${core ? ' ai-toggle-core' : ''}${!on ? ' ai-toggle-off' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={core || forcedOffByLight}
                    onChange={(e) => {
                      if (core || forcedOffByLight) return
                      setDisabledAis((prev) => {
                        if (e.target.checked) return prev.filter((id) => id !== ai.id)
                        return sanitizeDisabledAis([...prev, ai.id])
                      })
                    }}
                  />
                  <span className="ai-toggle-emoji" style={{ color: ai.color }}>
                    {ai.emoji}
                  </span>
                  <span className="ai-toggle-meta">
                    <strong>
                      {ai.name}
                      {core ? ' · core' : isHeavyAi(ai.id) ? ' · heavy' : ''}
                    </strong>
                    <span className="muted">
                      Load {ai.power}/10 · {ai.role}
                      {forcedOffByLight ? ' · off in light mode' : ''}
                      {ai.phoneWarning ? ` · ${ai.phoneWarning}` : ''}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setDisabledAis(
                  sanitizeDisabledAis(
                    AI_ROSTER.filter((a) => isHeavyAi(a.id)).map((a) => a.id),
                  ),
                )
              }
            >
              Disable heavy
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDisabledAis([])}
            >
              Enable all
            </button>
          </div>
        </div>

        <div className="card settings-card">
          <strong>Device AI scan</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Checks whether this phone can run free on-device AIs (WASM, workers, storage, network…).
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={probing}
            onClick={() => void handleDeviceScan()}
          >
            {probing ? 'Scanning device…' : 'Scan this device'}
          </button>
          {deviceProbe && (
            <div className="device-probe-results">
              <div className={`probe-grade probe-grade-${deviceProbe.grade}`}>
                Grade: {deviceProbe.grade} · {deviceProbe.score}/{deviceProbe.maxScore}
              </div>
              <p className="muted">{deviceProbe.summary}</p>
              <div className="muted" style={{ fontSize: '0.82rem', marginBottom: 8 }}>
                Recommended: {deviceProbe.recommended.join(' · ')}
              </div>
              <div className="cap-list">
                {deviceProbe.checks.map((c) => (
                  <div key={c.id} className={`cap-row cap-${c.level}`}>
                    <span className="cap-level">{c.level}</span>
                    <div>
                      <strong>{c.name}</strong>
                      <div className="muted" style={{ fontSize: '0.78rem' }}>
                        {c.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card settings-card">
          <strong>Free AI stability test</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Runs <strong>every</strong> free AI in the roster — OCR engines (Forge, Lens, Ruler, Wedge,
            Prism, Bloom, Mosaic, Hammer, Titan, Scout), parsers (Ledger, Sieve, Cashier, Clerk,
            Arbiter, Quorum, Council), and Seeker. Heavy ones can take a while; none are skipped on
            purpose.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={stabilityRunning}
            onClick={() => void handleStabilityTest()}
          >
            {stabilityRunning ? 'Testing free AIs…' : 'Test free AIs'}
          </button>
          {stabilityStatus && (
            <p className="muted" style={{ marginTop: 10 }}>
              {stabilityStatus}
            </p>
          )}
          {stability && (
            <div className="stability-list">
              {stability.results.map((r) => (
                <div key={r.aiId} className={`stability-row st-${r.status}`}>
                  <span className="st-badge">{r.status}</span>
                  <div>
                    <strong>
                      {r.name}
                      {' · free'}
                    </strong>
                    <div className="muted" style={{ fontSize: '0.78rem' }}>
                      {r.detail}
                      {r.latencyMs > 0 ? ` · ${r.latencyMs} ms` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
          <strong>AI roster (all free · no keys)</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            On-device free AIs plus <strong>Seeker</strong>, which searches the free public web for
            product/SKU info (needs network + this app&apos;s preview/dev server). No paid APIs.
          </p>
          <div className="ai-roster-list">
            {AI_ROSTER.map((ai) => (
              <div key={ai.id} className="ai-roster-row">
                <div className="ai-roster-icon" style={{ background: `${ai.color}22`, color: ai.color }}>
                  {ai.emoji}
                </div>
                <div className="ai-roster-body">
                  <div className="ai-roster-title">
                    {ai.name}
                    <span className="ai-cost-pill cost-free">free</span>
                    <span className="ai-status-dot on">ready</span>
                  </div>
                  <div className="muted" style={{ fontSize: '0.82rem' }}>
                    {ai.fullName} · power {ai.power}/5
                  </div>
                  <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
                    {ai.role}
                  </div>
                  <div className="muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                    Engine: {ai.engine}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card settings-card">
          <strong>Debug scans (for the coding agent)</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            When a scan is wrong, use <strong>Report bad scan</strong> on the review screen. If
            you&apos;re on this project&apos;s preview/dev server, reports land in{' '}
            <code>debug-scans/</code> so the agent can open the photo and AI outputs.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={debugLoading}
            onClick={() => void refreshDebugReports()}
          >
            {debugLoading ? 'Refreshing…' : 'Refresh debug list'}
          </button>
          {debugReports.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>
              No remote reports yet (or this host can&apos;t receive them — use download fallback).
            </p>
          ) : (
            <div className="debug-list" style={{ marginTop: 12 }}>
              {debugReports.map((r) => (
                <div key={r.id} className="debug-list-row">
                  <div>
                    <strong className="muted" style={{ color: 'var(--text)', fontSize: '0.85rem' }}>
                      {r.id}
                    </strong>
                    <div className="muted" style={{ fontSize: '0.8rem' }}>
                      {r.vendor || '—'} · {r.amount != null ? `$${r.amount}` : 'no total'} ·{' '}
                      {r.aisUsed?.join(', ') || 'AIs n/a'}
                    </div>
                    <div className="muted" style={{ fontSize: '0.78rem' }}>{r.userNote}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card settings-card">
          <strong>AI leaderboard</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Ranked by best-scan wins, ✓/✗ field marks (weights future scans), and how often each
            free AI runs.
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
                    {(row.stats.rights ?? 0) + (row.stats.wrongs ?? 0) > 0
                      ? ` · ✓${row.stats.rights ?? 0} ✗${row.stats.wrongs ?? 0}`
                      : ''}
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

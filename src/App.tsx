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
  deleteProject,
  getImageUrl,
  getProject,
  getPurchase,
  getSettings,
  listProjects,
  listPurchases,
  newId,
  saveImage,
  saveProject,
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
import { APP_NAME_SHORT } from './brand'
import { normalizePickedImage, revokePreviewUrl } from './imagePick'
import { normalizePickedDocument } from './documentPick'
import { ProjectsHome } from './ProjectsHome'
import { SafeImage } from './SafeImage'
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
import {
  hasNativeInstallPrompt,
  isAndroid,
  isIos,
  isStandaloneApp,
  promptInstall,
  subscribeInstallPrompt,
} from './installApp'
import {
  AndroidInstaller,
  rememberSkipInstaller,
  shouldShowAndroidInstaller,
} from './AndroidInstaller'
import {
  setAutoUpdate,
  useGitHubUpdates,
} from './appUpdate'
import { isNativeCapacitorApp } from './installApp'
import { UpdateCenter } from './UpdateCenter'
import { VersionChip } from './VersionChip'
import {
  applyTheme,
  homeThemeId,
  normalizeThemeId,
  projectThemeId,
  type ThemeId,
} from './themes'
import { ThemePicker } from './ThemePicker'
import { applyWaitingUpdate, notifyIfWaitingUpdate, setupPwaUpdates } from './pwa'
import { scanInvoiceFromText, scanReceipt, type ScanResult } from './receiptAi'
import { regroupAllPurchases } from './regroup'
import { categoryBreakdown, groupPurchasesByCategory, totalSpent } from './stats'
import type {
  AppSettings,
  Project,
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
  copyTextToClipboard,
  formatScanDebugText,
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

function projectIdFromScreen(s: Screen): string | null {
  if (
    s.name === 'project' ||
    s.name === 'add' ||
    s.name === 'edit' ||
    s.name === 'detail' ||
    s.name === 'scan'
  ) {
    return 'projectId' in s ? s.projectId : null
  }
  return null
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [, setProjects] = useState<Project[]>([])
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [settings, setSettings] = useState<AppSettings>({
    projectName: 'My project',
    lastSeenVersion: '',
    maxPowerMode: true,
    disabledAis: [],
    customCategories: [],
    themeId: 'midnight-teal',
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [whatsNew, setWhatsNew] = useState<ChangelogEntry[] | null>(null)
  const [whatsNewMode, setWhatsNewMode] = useState<'update' | 'history'>('update')
  const [pendingSwUpdate, setPendingSwUpdate] = useState<(() => void) | null>(null)
  /** Android browser only: full-page installer. Never in the installed APK. */
  const [showInstaller, setShowInstaller] = useState(false)
  useEffect(() => {
    // Re-check after load so Capacitor bridge / WebView UA is available
    setShowInstaller(shouldShowAndroidInstaller())
  }, [])

  const refresh = useCallback(async (projectId?: string | null) => {
    const pid = projectId === undefined ? projectIdFromScreen(screen) : projectId
    const [projList, s, p] = await Promise.all([
      listProjects(),
      getSettings(),
      pid ? listPurchases(pid) : Promise.resolve([] as Purchase[]),
    ])
    setProjects(projList)
    setSettings(s)
    setPurchases(p)
    if (pid) {
      const found = projList.find((x) => x.id === pid) || (await getProject(pid)) || null
      setActiveProject(found)
    } else {
      setActiveProject(null)
    }
    return s
  }, [screen])

  /**
   * Home / Settings → Home Screen theme only.
   * Inside a project (scan, receipts, edit…) → that project’s theme only.
   * Never cross-wire the two.
   */
  useEffect(() => {
    let cancelled = false
    const projectScreens = new Set([
      'project',
      'project-edit',
      'scan',
      'add',
      'detail',
      'edit',
    ])

    void (async () => {
      // Home list + Settings always use the Home Screen theme
      if (!projectScreens.has(screen.name)) {
        // Persist so cold start uses Home Screen theme, not last project preview
        applyTheme(homeThemeId(settings.themeId), { persistHome: true })
        return
      }
      // New project form: ProjectEditScreen owns live preview (does not touch home)
      if (screen.name === 'project-edit' && !screen.projectId) return

      const pid =
        'projectId' in screen && screen.projectId
          ? screen.projectId
          : activeProject?.id
      if (!pid) {
        applyTheme(homeThemeId(settings.themeId))
        return
      }
      let p = activeProject?.id === pid ? activeProject : null
      if (!p) {
        p = (await getProject(pid)) ?? null
      }
      if (cancelled) return
      // Project’s own theme only — never Settings home theme
      applyTheme(projectThemeId(p?.themeId))
    })()

    return () => {
      cancelled = true
    }
  }, [screen, activeProject, settings.themeId])

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
      setInfo('Scan a receipt first — then Regroup can put alike ones in the same group.')
      return
    }
    setError(null)
    const { purchases: next, changed, labels, preserved, filledMisc, mergedAlike } =
      regroupAllPurchases(purchases)
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
    // Only update receipts whose *group* categoryId moved — never rewrite line items
    const byId = new Map(purchases.map((p) => [p.id, p]))
    for (const p of next) {
      const prev = byId.get(p.id)
      if (!prev || prev.categoryId !== p.categoryId) {
        // Preserve line items / AI marks from the original receipt
        await savePurchase({
          ...prev!,
          categoryId: p.categoryId,
          updatedAt: p.updatedAt,
          lineItems: prev!.lineItems,
        })
      }
    }
    await refresh()
    if (changed === 0) {
      setInfo(
        `AI categories kept as-is — ${preserved} receipt${preserved === 1 ? '' : 's'} in ${groupCount} group${groupCount === 1 ? '' : 's'}.`,
      )
    } else {
      const bits: string[] = []
      if (mergedAlike > 0) {
        bits.push(
          `merged ${mergedAlike} alike receipt${mergedAlike === 1 ? '' : 's'} into shared groups`,
        )
      }
      if (filledMisc > 0) {
        bits.push(`placed ${filledMisc} uncategorized receipt${filledMisc === 1 ? '' : 's'}`)
      }
      setInfo(
        `${bits.join('; ') || `Updated ${changed}`} — still ${groupCount} group${groupCount === 1 ? '' : 's'}. AI category marks on each receipt were not re-run.`,
      )
    }
  }

  async function handleSavePurchase(input: {
    id?: string
    projectId: string
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
      projectId: input.projectId,
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
    await refresh(input.projectId)
    setInfo(input.bestAiId ? `Saved · ${getAi(input.bestAiId).name}` : 'Saved')
    setScreen({ name: 'project', projectId: input.projectId })
    return true
  }

  if (showInstaller) {
    return (
      <AndroidInstaller
        onContinueInBrowser={() => {
          rememberSkipInstaller()
          setShowInstaller(false)
        }}
      />
    )
  }

  if (loading) {
    return (
      <div className="app-shell">
        <div className="empty">
          <div className="spinner" />
          Loading…
          <p className="muted" style={{ marginTop: 12, fontSize: '0.85rem' }}>
            If this never finishes, hard-refresh the page.
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
            A newer build is available. Reload to switch to {formatVersionLabel()} and
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
                    'Reset local data on this device? Purchases and receipt photos stored here will be deleted. Nothing is in the cloud.',
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
        <ProjectsHome
          onOpenProject={(id) => {
            setError(null)
            setScreen({ name: 'project', projectId: id })
            void refresh(id)
          }}
          onNewProject={() => setScreen({ name: 'project-edit' })}
          onSettings={() => setScreen({ name: 'settings' })}
        />
      )}

      {screen.name === 'project-edit' && (
        <ProjectEditScreen
          projectId={screen.projectId}
          homeThemeId={homeThemeId(settings.themeId)}
          onBack={() =>
            setScreen(
              screen.projectId
                ? { name: 'project', projectId: screen.projectId }
                : { name: 'home' },
            )
          }
          onSaved={(id) => {
            setScreen({ name: 'project', projectId: id })
            void refresh(id)
          }}
          onDeleted={() => {
            setScreen({ name: 'home' })
            void refresh(null)
          }}
        />
      )}

      {screen.name === 'project' && activeProject && (
        <HomeScreen
          project={activeProject}
          total={total}
          purchaseCount={purchases.length}
          breakdown={breakdown}
          groups={purchaseGroups}
          purchases={purchases}
          customCategories={customCats}
          onRegroup={handleRegroup}
          onBackHome={() => {
            setScreen({ name: 'home' })
            void refresh(null)
          }}
          onEditProject={() =>
            setScreen({ name: 'project-edit', projectId: activeProject.id })
          }
          onScan={() => {
            setError(null)
            setInfo(null)
            setScreen({ name: 'scan', projectId: activeProject.id })
          }}
          onAdd={() => {
            setError(null)
            setInfo(null)
            setScreen({ name: 'add', projectId: activeProject.id })
          }}
          onOpen={(id) =>
            setScreen({
              name: 'detail',
              purchaseId: id,
              projectId: activeProject.id,
            })
          }
          onSettings={() => setScreen({ name: 'settings' })}
          onExportCsv={() => downloadCsv(purchases, activeProject.name)}
          onExportPdf={() => downloadPdfSummary(purchases, activeProject.name)}
        />
      )}

      {screen.name === 'scan' && (
        <ScanScreen
          maxPowerMode={settings.maxPowerMode}
          disabledAis={settings.disabledAis ?? []}
          retryBlob={screen.retryBlob}
          retryPreviewUrl={screen.retryPreviewUrl}
          rejected={screen.rejected}
          onBack={() => setScreen({ name: 'project', projectId: screen.projectId })}
          onNeedSettings={() => setScreen({ name: 'settings' })}
          onParsed={(suggestion, blob, previewUrl) => {
            const aisUsed = (suggestion.aisUsed ?? []) as AiId[]
            void recordScanParticipation(aisUsed)
            setError(null)
            setScreen({
              name: 'add',
              projectId: screen.projectId,
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
              projectId: screen.projectId,
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
          onBack={() => setScreen({ name: 'project', projectId: screen.projectId })}
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
                    projectId: screen.projectId,
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
              projectId: screen.projectId,
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
          onBack={() =>
            setScreen({
              name: 'detail',
              purchaseId: screen.purchaseId,
              projectId: screen.projectId,
            })
          }
          onSave={async (form, existingId) => {
            const existing = await getPurchase(screen.purchaseId)
            await handleSavePurchase({
              id: screen.purchaseId,
              projectId: screen.projectId || existing?.projectId || '',
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
          onBack={() => setScreen({ name: 'project', projectId: screen.projectId })}
          onEdit={() =>
            setScreen({
              name: 'edit',
              purchaseId: screen.purchaseId,
              projectId: screen.projectId,
            })
          }
          onDelete={async () => {
            if (!confirm('Delete this purchase?')) return
            await deletePurchase(screen.purchaseId)
            await refresh(screen.projectId)
            setInfo('Deleted')
            setScreen({ name: 'project', projectId: screen.projectId })
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
            // Home Screen theme only — does not rewrite project themes
            applyTheme(homeThemeId(next.themeId), { persistHome: true })
            setInfo('Settings saved.')
            setScreen({ name: 'home' })
          }}
          onThemeChange={async (next) => {
            await saveSettings(next)
            setSettings(next)
            applyTheme(homeThemeId(next.themeId), { persistHome: true })
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

/** Browser only: offer PWA install. Hidden when already installed as APK/PWA. */
function AndroidInstallCard() {
  const [standalone, setStandalone] = useState(() => isStandaloneApp() || isNativeCapacitorApp())
  const [canPrompt, setCanPrompt] = useState(() => hasNativeInstallPrompt())
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('schoolie-install-dismissed') === '1'
    } catch {
      return false
    }
  })
  const android = isAndroid()
  const ios = isIos()

  useEffect(() => {
    const unsub = subscribeInstallPrompt(() => setCanPrompt(hasNativeInstallPrompt()))
    const onChange = () => setStandalone(isStandaloneApp() || isNativeCapacitorApp())
    window.matchMedia('(display-mode: standalone)').addEventListener?.('change', onChange)
    return () => {
      unsub()
      window.matchMedia('(display-mode: standalone)').removeEventListener?.('change', onChange)
    }
  }, [])

  // Already in the app — never show install status fluff
  if (standalone || isNativeCapacitorApp()) return null
  if (dismissed) return null

  async function onInstall() {
    setBusy(true)
    try {
      const result = await promptInstall()
      if (result === 'accepted') setStandalone(true)
    } finally {
      setBusy(false)
    }
  }

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem('schoolie-install-dismissed', '1')
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="card install-card">
      <div className="install-card-row">
        <img src="./pwa-192.png" alt="Project Cost Tracker" className="install-logo" width={48} height={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>Add to home screen</strong>
          <p className="muted" style={{ margin: '4px 0 10px' }}>
            Optional — open Schoolie like a normal app.
          </p>
          {canPrompt ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', minHeight: 44 }}
              disabled={busy}
              onClick={() => void onInstall()}
            >
              {busy ? '…' : 'Install'}
            </button>
          ) : (
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 8px' }}>
              {android
                ? 'Chrome ⋮ → Install app'
                : ios
                  ? 'Safari Share → Add to Home Screen'
                  : 'Browser menu → Install app'}
            </p>
          )}
          <button type="button" className="install-dismiss" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}

function ProjectEditScreen(props: {
  projectId?: string
  /** Current Home Screen theme — only a starter suggestion for brand-new projects */
  homeThemeId: ThemeId
  onBack: () => void
  onSaved: (id: string) => void
  onDeleted: () => void
}) {
  const isNew = !props.projectId
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [coverId, setCoverId] = useState<string | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  // New projects start from a *copy* of the home theme; then they live separately
  const [themeId, setThemeId] = useState<ThemeId>(props.homeThemeId)
  const [pickingCover, setPickingCover] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** Only revoke blob: previews we created — never on StrictMode effect re-run of the active URL */
  const coverBlobRef = useRef<string | null>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!props.projectId) {
      // New project: suggest home look as a starting point (not linked after save)
      setThemeId(props.homeThemeId)
      applyTheme(props.homeThemeId) // visual only — does not persist home
      return
    }
    let cancelled = false
    void (async () => {
      const p = await getProject(props.projectId!)
      if (!p || cancelled) {
        if (!p) setLoadError('Project not found')
        return
      }
      setName(p.name)
      setDescription(p.description)
      setCoverId(p.coverImageId)
      // This project’s theme only (never Settings home)
      const tid = projectThemeId(p.themeId)
      setThemeId(tid)
      applyTheme(tid) // visual only
      if (p.coverImageId) {
        const url = await getImageUrl(p.coverImageId)
        if (url && !cancelled) {
          // Stored images: data: preferred; don't track for revoke unless blob:
          if (url.startsWith('blob:')) coverBlobRef.current = url
          setCoverPreview(url)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [props.projectId, props.homeThemeId])

  // Revoke only on leave this screen
  useEffect(() => {
    return () => {
      revokePreviewUrl(coverBlobRef.current)
      coverBlobRef.current = null
    }
  }, [])

  function setCoverPreviewSafe(url: string | null) {
    if (coverBlobRef.current && coverBlobRef.current !== url) {
      revokePreviewUrl(coverBlobRef.current)
      coverBlobRef.current = null
    }
    if (url?.startsWith('blob:')) coverBlobRef.current = url
    setCoverPreview(url)
  }

  async function onPickCover(file: File | null, inputEl?: HTMLInputElement | null) {
    // Always clear so picking the same photo again still fires change
    if (inputEl) inputEl.value = ''
    if (!file) return
    setPickingCover(true)
    setLoadError(null)
    try {
      const normalized = await normalizePickedImage(file, {
        name: file instanceof File ? file.name : 'cover.jpg',
      })
      const id = await saveImage(normalized.blob)
      // Prefer data: preview (survives re-renders; no revoke issues)
      const preview = normalized.dataUrl || normalized.previewUrl
      if (normalized.dataUrl && normalized.previewUrl.startsWith('blob:')) {
        revokePreviewUrl(normalized.previewUrl)
      }
      setCoverId(id)
      setCoverPreviewSafe(preview)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not open that photo.'
      setLoadError(
        msg.includes('receipt')
          ? 'Could not open that photo. Try Take photo or pick a JPEG from Gallery.'
          : msg,
      )
    } finally {
      setPickingCover(false)
    }
  }

  function clearCover() {
    setCoverId(null)
    setCoverPreviewSafe(null)
  }

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) {
      setLoadError('Give this project a name.')
      return
    }
    setSaving(true)
    setLoadError(null)
    try {
      const now = new Date().toISOString()
      const existing = props.projectId ? await getProject(props.projectId) : null
      const project: Project = {
        id: props.projectId || newId(),
        name: trimmed,
        description: description.trim(),
        coverImageId: coverId,
        // Always save this project’s own theme (never writes Settings / home theme)
        themeId,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      }
      await saveProject(project)
      applyTheme(themeId) // visual only
      // Confirm it stuck (localStorage / idb)
      const check = await getProject(project.id)
      if (coverId && check && check.coverImageId !== coverId) {
        throw new Error('Cover photo did not save. Try again.')
      }
      props.onSaved(project.id)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not save project')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!props.projectId) return
    if (
      !confirm(
        'Delete this project and all of its receipts? This cannot be undone on this device.',
      )
    ) {
      return
    }
    setSaving(true)
    try {
      await deleteProject(props.projectId)
      props.onDeleted()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={props.onBack} aria-label="Back">
          ←
        </button>
        <h1>{isNew ? 'New project' : 'Edit project'}</h1>
        <LogoMark size={36} />
      </header>

      <div className="form">
        {loadError && (
          <div className="banner banner-error" role="alert">
            {loadError}
          </div>
        )}

        <div className="field">
          <label>Cover photo</label>
          <div className="project-cover-picker" aria-live="polite">
            {pickingCover ? (
              <span className="muted">
                <span className="spinner" style={{ width: 28, height: 28 }} /> Adding photo…
              </span>
            ) : coverPreview ? (
              <SafeImage
                src={coverPreview}
                alt="Cover"
                className="project-cover-img"
                missingText="Photo failed to show — pick again"
              />
            ) : (
              <span className="muted">No cover yet — add one below</span>
            )}
          </div>
          {/* Labels (not programmatic .click on display:none) — reliable on Android WebView */}
          <div className="row-actions" style={{ marginTop: 10 }}>
            <label className="btn btn-primary" style={{ flex: 1, textAlign: 'center' }}>
              {pickingCover ? '…' : 'Take photo'}
              <input
                ref={cameraInputRef}
                className="hidden-input"
                type="file"
                accept="image/*,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.heic,.heif"
                capture="environment"
                disabled={pickingCover}
                onChange={(e) =>
                  void onPickCover(e.target.files?.[0] ?? null, e.currentTarget)
                }
              />
            </label>
            <label className="btn btn-secondary" style={{ flex: 1, textAlign: 'center' }}>
              {pickingCover ? '…' : 'Gallery'}
              <input
                ref={galleryInputRef}
                className="hidden-input"
                type="file"
                accept="image/*,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.heic,.heif"
                disabled={pickingCover}
                onChange={(e) =>
                  void onPickCover(e.target.files?.[0] ?? null, e.currentTarget)
                }
              />
            </label>
          </div>
          {coverPreview && (
            <button
              type="button"
              className="version-link"
              style={{ marginTop: 8 }}
              disabled={pickingCover}
              onClick={clearCover}
            >
              Remove cover photo
            </button>
          )}
        </div>

        <div className="field">
          <label htmlFor="proj-name">What is this project?</label>
          <input
            id="proj-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kitchen remodel, School bus, Road trip"
            autoFocus={isNew}
          />
        </div>
        <div className="field">
          <label htmlFor="proj-desc">What is it for?</label>
          <textarea
            id="proj-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description — goals, notes, anything helpful"
            rows={4}
          />
        </div>

        <div className="card settings-card">
          <strong>This project’s theme</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Only this project. Does not change the home screen or other projects.
          </p>
          <ThemePicker
            value={themeId}
            ariaLabel="This project’s theme"
            onChange={(id) => {
              setThemeId(id)
              applyTheme(id) // preview only — home theme stays stored as-is
            }}
          />
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={saving || pickingCover}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : isNew ? 'Create project' : 'Save project'}
        </button>

        {!isNew && (
          <button
            type="button"
            className="btn btn-danger"
            style={{ width: '100%', marginTop: 10 }}
            disabled={saving}
            onClick={() => void remove()}
          >
            Delete project
          </button>
        )}
      </div>
    </>
  )
}

function HomeScreen(props: {
  project: Project
  total: number
  purchaseCount: number
  breakdown: ReturnType<typeof categoryBreakdown>
  groups: ReturnType<typeof groupPurchasesByCategory>
  purchases: Purchase[]
  customCategories: Category[]
  onRegroup: () => void | Promise<void>
  onBackHome: () => void
  onEditProject: () => void
  onScan: () => void
  onAdd: () => void
  onOpen: (id: string) => void
  onSettings: () => void
  onExportCsv: () => void
  onExportPdf: () => void
}) {
  // Groups start expanded so the main screen shows receipts under each category
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [regroupBusy, setRegroupBusy] = useState(false)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const coverBlobRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!props.project.coverImageId) {
        if (coverBlobRef.current) {
          revokePreviewUrl(coverBlobRef.current)
          coverBlobRef.current = null
        }
        setCoverUrl(null)
        return
      }
      const url = await getImageUrl(props.project.coverImageId)
      if (cancelled) {
        if (url?.startsWith('blob:')) revokePreviewUrl(url)
        return
      }
      if (coverBlobRef.current) {
        revokePreviewUrl(coverBlobRef.current)
        coverBlobRef.current = null
      }
      if (url?.startsWith('blob:')) coverBlobRef.current = url
      setCoverUrl(url ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [props.project.coverImageId])

  useEffect(() => {
    return () => {
      revokePreviewUrl(coverBlobRef.current)
      coverBlobRef.current = null
    }
  }, [])

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
        <button type="button" className="icon-btn" onClick={props.onBackHome} aria-label="Projects">
          ←
        </button>
        <BrandLockup title={props.project.name} subtitle={APP_NAME_SHORT} size={36} />
        <div className="topbar-actions">
          <VersionChip
            onClick={props.onSettings}
            title="Version — open Settings for updates"
          />
          <button
            type="button"
            className="icon-btn"
            aria-label="Edit project"
            onClick={props.onEditProject}
          >
            ✎
          </button>
          <button type="button" className="icon-btn" aria-label="Settings" onClick={props.onSettings}>
            ⚙
          </button>
        </div>
      </header>

      <section className="hero-card project-hero">
        {coverUrl && (
          <div className="project-hero-cover">
            <SafeImage src={coverUrl} alt="Project cover" />
          </div>
        )}
        <div className="hero-inner">
          <div className="hero-label">Total spent</div>
          <div className="hero-total">{formatMoney(props.total)}</div>
          <div className="hero-sub">
            {props.purchaseCount === 0
              ? 'No receipts yet — scan one to start'
              : `${props.purchaseCount} receipt${props.purchaseCount === 1 ? '' : 's'} · ${props.groups.length} group${props.groups.length === 1 ? '' : 's'}`}
          </div>
          {props.project.description ? (
            <p className="project-hero-desc">{props.project.description}</p>
          ) : null}
        </div>
      </section>

      <AndroidInstallCard />

      <div className="section-title">
        <span>By category</span>
        <button
          type="button"
          className="regroup-btn"
          disabled={regroupBusy || props.purchases.length === 0}
          onClick={() => void runRegroup()}
          title="Put alike receipts in the same group — does not re-run AI or change marked categories"
        >
          {regroupBusy ? 'Regrouping…' : 'Regroup'}
        </button>
      </div>
      {props.breakdown.length === 0 ? (
        <div className="empty empty-soft">
          <div className="empty-icon">📊</div>
          <p>No purchases yet. Scan a receipt to start.</p>
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
            Groups use the category each free AI marked when you scanned. Press{' '}
            <strong>Regroup</strong> only to put alike receipts in the same group — it does not
            change what the AI already marked on each receipt.
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
          <p>Scan a receipt to start tracking costs for this project.</p>
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
  /** opening = loading/normalizing gallery pick; scanning = OCR team running */
  const [workPhase, setWorkPhase] = useState<'opening' | 'scanning' | null>(
    props.retryBlob && props.rejected ? 'scanning' : null,
  )
  const [progress, setProgress] = useState(0)
  const [scanError, setScanError] = useState<string | null>(null)
  const [heldBlob, setHeldBlob] = useState<Blob | null>(props.retryBlob ?? null)
  const [heldPreview, setHeldPreview] = useState<string | null>(props.retryPreviewUrl ?? null)
  const autoStarted = useRef(false)
  /** Blocks double-pick while gallery open / normalize / scan is in flight */
  const inFlightRef = useRef(false)

  async function runScan(
    blob: Blob,
    previewUrl: string,
    rejected?: RejectedScanSnapshot,
  ) {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setScanError(null)
    setHeldBlob(blob)
    setHeldPreview(previewUrl)
    setBusy(true)
    setWorkPhase('scanning')
    setProgress(0.02)
    const isRetry = Boolean(rejected)
    try {
      const board = normalizeLeaderboard(await getLeaderboard())
      const suggestion = await scanReceipt(blob, {
        maxPower: isRetry ? true : props.maxPowerMode,
        disabledAis: props.disabledAis,
        rejected,
        reliability: reliabilityWeights(board),
        onProgress: (p) => {
          setProgress(p.progress)
        },
      })
      props.onParsed(suggestion, blob, previewUrl)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed — try again or enter details manually.'
      setScanError(msg)
      props.onError(msg)
    } finally {
      inFlightRef.current = false
      setBusy(false)
      setWorkPhase(null)
      setProgress(0)
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

  async function handleFile(file: File | null, inputEl?: HTMLInputElement | null) {
    // Always clear so the same file can be re-picked later if needed
    if (inputEl) inputEl.value = ''
    if (!file) return
    // Already opening or scanning — ignore second pick
    if (inFlightRef.current || busy) return

    inFlightRef.current = true
    setScanError(null)
    setBusy(true)
    setWorkPhase('opening')
    setProgress(0)
    // Drop previous held file immediately so we never show the pick screen again
    setHeldBlob(null)
    setHeldPreview(null)

    try {
      // Photos, gallery, or Files (PDF invoices / images from Downloads)
      const doc = await normalizePickedDocument(file, {
        name: file instanceof File ? file.name : undefined,
      })
      setHeldBlob(doc.blob)
      setHeldPreview(doc.previewUrl)
      setWorkPhase('scanning')
      setProgress(0.02)

      let suggestion: ScanResult
      if (doc.kind === 'pdf-text' && doc.embeddedText) {
        // Digital PDF: layout text + structured engine (not photo OCR soup)
        suggestion = await scanInvoiceFromText(doc.embeddedText, {
          fileName: doc.fileName,
          layoutLines: doc.layoutLines,
          onProgress: (p) => {
            setProgress(p.progress)
          },
        })
      } else {
        // Photo or scan-style PDF page image(s) → OCR team
        const board = normalizeLeaderboard(await getLeaderboard())
        suggestion = await scanReceipt(doc.blob, {
          maxPower: props.maxPowerMode,
          disabledAis: props.disabledAis,
          reliability: reliabilityWeights(board),
          onProgress: (p) => {
            setProgress(p.progress)
          },
        })
        // Hybrid: merge any PDF text layer into the OCR dump and re-reason.
        // Multi-column Amazon PDFs often OCR product names but drop unit prices;
        // the embedded layer (when present) can supply missing $ amounts.
        if (doc.embeddedText && doc.embeddedText.trim().length > 40) {
          try {
            const { reasonAboutReceipt } = await import('./agents/receiptReasoner')
            const merged = `${doc.embeddedText.trim()}\n\n--- OCR ---\n${suggestion.rawText || ''}`
            const reasoned = await reasonAboutReceipt(
              {
                ...suggestion,
                source: 'on-device',
                confidence: suggestion.confidence ?? 0.5,
                rawText: merged,
              },
              merged,
              { allowLlm: false },
            )
            if (reasoned.repaired || reasoned.result.lineItems.length > (suggestion.lineItems?.length || 0)) {
              suggestion = {
                ...reasoned.result,
                source: 'on-device',
                aisUsed: suggestion.aisUsed,
              }
            } else {
              suggestion = {
                ...suggestion,
                rawText: merged,
              }
            }
          } catch {
            /* keep OCR-only result */
          }
        }
        if (doc.kind === 'pdf-scan' && doc.pageCount && doc.pageCount > 1) {
          suggestion = {
            ...suggestion,
            activeAiLabel: `${suggestion.activeAiLabel || 'Scan'} · PDF ${doc.pageCount} pages`,
            agentReport: [
              suggestion.agentReport,
              `Source: PDF (${doc.pageCount} pages rendered for OCR).`,
              doc.embeddedText ? 'Merged PDF text layer with OCR for prices/names.' : null,
            ]
              .filter(Boolean)
              .join('\n'),
          }
        }
      }
      props.onParsed(suggestion, doc.blob, doc.previewUrl)
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : 'Could not open that file. Try a photo, gallery image, or PDF invoice.'
      setScanError(msg)
      props.onError(msg)
    } finally {
      inFlightRef.current = false
      setBusy(false)
      setWorkPhase(null)
      setProgress(0)
    }
  }

  function clearHeldPhoto() {
    if (busy || inFlightRef.current) return
    setHeldBlob(null)
    setHeldPreview(null)
    setScanError(null)
  }

  const working = busy || workPhase != null

  return (
    <>
      <header className="topbar">
        <button
          type="button"
          className="icon-btn"
          onClick={props.onBack}
          aria-label="Back"
          disabled={working}
        >
          ←
        </button>
        <h1>Scan receipt</h1>
        <LogoMark size={36} />
      </header>

      {props.rejected && !working && (
        <div className="banner banner-info">
          <strong>Retry #{props.rejected.attempt}</strong>
          {props.rejected.amount != null
            ? ` — avoiding total $${props.rejected.amount.toFixed(2)}`
            : ''}
        </div>
      )}

      {working ? (
        <div className="card agent-status" aria-busy="true" aria-live="polite">
          {heldPreview && (
            <SafeImage
              className="receipt-preview receipt-preview-sm"
              src={heldPreview}
              alt="Scanning"
            />
          )}
          <div className="spinner" />
          <div className="status-title">
            {workPhase === 'opening'
              ? 'Opening file…'
              : progress < 0.95
                ? 'Reading your receipt…'
                : 'Almost done…'}
          </div>
          <p className="muted" style={{ margin: '6px 0 0', textAlign: 'center' }}>
            {workPhase === 'opening'
              ? 'Please wait — don’t pick another file'
              : 'Extracting store, total, date, and line items'}
          </p>
          {workPhase === 'scanning' && (
            <>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <div className="muted">{Math.round(progress * 100)}%</div>
            </>
          )}
        </div>
      ) : scanError ? (
        <div className="card scan-retry-card">
          {heldPreview && (
            <SafeImage className="receipt-preview" src={heldPreview} alt="Receipt preview" />
          )}
          <div className="banner banner-error" role="alert" style={{ margin: 0 }}>
            {scanError}
          </div>
          <strong className="scan-retry-title">
            {heldBlob ? "Scan didn't work" : "Couldn't open that file"}
          </strong>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {heldBlob
              ? 'Try again, pick a clearer photo, or upload a PDF invoice.'
              : 'Pick a photo, gallery image, or PDF invoice from Files.'}
          </p>
          <div className="row-actions stack" style={{ marginTop: 14 }}>
            {heldBlob && (
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
            )}
            <label className="btn btn-secondary">
              New photo
              <input
                className="hidden-input"
                type="file"
                accept="image/*,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.heic,.heif"
                capture="environment"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0] ?? null, e.currentTarget)
                }}
              />
            </label>
            <label className="btn btn-secondary">
              Gallery
              <input
                className="hidden-input"
                type="file"
                accept="image/*,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.heic,.heif"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0] ?? null, e.currentTarget)
                }}
              />
            </label>
            <label className="btn btn-secondary">
              Files
              <input
                className="hidden-input"
                type="file"
                accept="image/*,application/pdf,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0] ?? null, e.currentTarget)
                }}
              />
            </label>
            {heldBlob && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setScanError(null)
                  props.onManualWithPhoto(
                    heldBlob,
                    heldPreview ?? URL.createObjectURL(heldBlob),
                  )
                }}
              >
                Enter manually
              </button>
            )}
          </div>
        </div>
      ) : heldBlob && heldPreview && !props.rejected ? (
        <div className="card scan-retry-card">
          <SafeImage className="receipt-preview" src={heldPreview} alt="Receipt preview" />
          <strong className="scan-retry-title">Ready to scan again</strong>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Re-read this file, or pick a clearer photo / PDF.
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
                accept="image/*,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.heic,.heif"
                capture="environment"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0] ?? null, e.currentTarget)
                }}
              />
            </label>
            <label className="btn btn-secondary">
              Files
              <input
                className="hidden-input"
                type="file"
                accept="image/*,application/pdf,.pdf,.jpg,.jpeg,.png,.webp"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0] ?? null, e.currentTarget)
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
          <strong>Photo, gallery, or invoice file</strong>
          <p className="muted" style={{ marginTop: 8 }}>
            Take a picture, pick from Gallery, or upload a PDF invoice from Files /
            Downloads / email.
          </p>
          <div className="row-actions" style={{ marginTop: 16, flexWrap: 'wrap' }}>
            <label className={`btn btn-primary${working ? ' btn-disabled' : ''}`}>
              Take photo
              <input
                className="hidden-input"
                type="file"
                accept="image/*,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.heic,.heif"
                capture="environment"
                disabled={working}
                onChange={(e) => void handleFile(e.target.files?.[0] ?? null, e.currentTarget)}
              />
            </label>
            <label className={`btn btn-secondary${working ? ' btn-disabled' : ''}`}>
              Gallery
              <input
                className="hidden-input"
                type="file"
                accept="image/*,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.heic,.heif"
                disabled={working}
                onChange={(e) => void handleFile(e.target.files?.[0] ?? null, e.currentTarget)}
              />
            </label>
            <label className={`btn btn-secondary${working ? ' btn-disabled' : ''}`}>
              Files
              <input
                className="hidden-input"
                type="file"
                accept="image/*,application/pdf,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                disabled={working}
                onChange={(e) => void handleFile(e.target.files?.[0] ?? null, e.currentTarget)}
              />
            </label>
          </div>
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
  const [showAgentReport, setShowAgentReport] = useState(false)
  const [showScanDetails, setShowScanDetails] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reportNote, setReportNote] = useState('')
  const [debugCopyStatus, setDebugCopyStatus] = useState<string | null>(null)
  const [showDebugPreview, setShowDebugPreview] = useState(false)
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

  function buildDebugText(): string {
    const amountNum = parseMoneyInputLoose(form.amount)
    return formatScanDebugText({
      userNote: reportNote.trim() || undefined,
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
        fieldSources: form.fieldSources,
      },
      form: {
        date: form.date,
        vendor: form.vendor,
        amount: form.amount,
        description: form.description,
        categoryId: form.categoryId,
        notes: form.notes,
        lineItems: form.lineItems,
      },
    })
  }

  async function handleCopyScanDebug() {
    const text = buildDebugText()
    const ok = await copyTextToClipboard(text)
    if (ok) {
      setDebugCopyStatus('Copied — paste into chat with Grok')
      props.onDebugMessage?.(
        'Scan debug text copied. Paste it in chat so the agent can see exactly what the scan did.',
      )
    } else {
      setShowDebugPreview(true)
      setDebugCopyStatus('Clipboard blocked — select the text below and copy')
    }
    window.setTimeout(() => setDebugCopyStatus(null), 5000)
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
        {props.onTryAgain && (
          <div className="line-item-meta-row line-item-meta-row-end">
            <MarkPair
              label={`Mark ${li.description || 'line'}`}
              value={mark}
              sourceAi={sourceAi}
              showAi={false}
              onChange={(m) => setLineMark(li.id, m)}
            />
          </div>
        )}
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

  const hasScanMeta =
    fromScan &&
    Boolean(
      form.activeAiLabel ||
        form.aisUsed.length > 0 ||
        form.fieldSources?.primary ||
        form.agentReport,
    )

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
        <SafeImage
          className="receipt-preview"
          src={props.receiptPreviewUrl}
          alt="Receipt preview"
        />
      )}

      {fromScan && (
        <div className="receipt-read-banner">
          <strong>Check the receipt</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Review store, total, date, and lines below. Fix anything wrong before you save.
            {typeof form.confidence === 'number' ? (
              <>
                {' '}
                Read confidence: <strong>{Math.round(form.confidence * 100)}%</strong>
              </>
            ) : null}
          </p>
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
        {/* —— Receipt data first —— */}
        <div
          className={`field${partMarks.vendor === 'wrong' ? ' field-marked-wrong' : ''}${partMarks.vendor === 'right' ? ' field-marked-right' : ''}`}
        >
          <div className="field-label-row">
            <label htmlFor="vendor">Store / vendor</label>
            <div className="field-label-right">
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

        <div
          className={`field${partMarks.date === 'wrong' ? ' field-marked-wrong' : ''}${partMarks.date === 'right' ? ' field-marked-right' : ''}`}
        >
          <div className="field-label-row">
            <label htmlFor="date">Date</label>
            <div className="field-label-right">
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

        <div
          className={`field${partMarks.total === 'wrong' ? ' field-marked-wrong' : ''}${partMarks.total === 'right' ? ' field-marked-right' : ''}`}
        >
          <div className="field-label-row">
            <label htmlFor="amount">Amount (total paid)</label>
            <div className="field-label-right">
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
                Tap ✗ on a line if it&apos;s wrong. ✗ on “missing products” if the list is incomplete.
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
                      showAi={false}
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
                      showAi={false}
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
                  showAi={false}
                  onChange={(m) => setMark('missingItems', m)}
                />
              )}
            </div>
            {props.onTryAgain && partMarks.missingItems === 'wrong' && (
              <p className="muted mark-hint">Marked missing — Fix marked parts will hunt for items.</p>
            )}
          </div>
        )}

        <div
          className={`field${partMarks.category === 'wrong' ? ' field-marked-wrong' : ''}${partMarks.category === 'right' ? ' field-marked-right' : ''}`}
        >
          <div className="field-label-row">
            <label htmlFor="category">Category</label>
            <div className="field-label-right">
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

        {props.onTryAgain && fromScan && (
          <div
            className={`card scan-retry-card ${lowConfidence || looksThin || wrongCount > 0 ? 'scan-retry-card-warn' : ''}`}
          >
            <strong className="scan-retry-title">
              {wrongCount > 0
                ? `${wrongCount} part${wrongCount === 1 ? '' : 's'} marked wrong`
                : lowConfidence || looksThin
                  ? 'Something may be incomplete'
                  : 'Looks good? Save — or fix mistakes'}
            </strong>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Mark <strong>✗</strong> only on wrong fields above, then fix. Unmarked fields are kept
              as correct.
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
              <button type="button" className="btn btn-secondary" onClick={requestTryAgain}>
                Retry all
              </button>
            </div>
          </div>
        )}

        <div className="row-actions">
          <button type="button" className="btn btn-secondary" onClick={props.onBack}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {/* —— Copy plain-text debug for pasting to the coding agent —— */}
        {fromScan && (hasScanMeta || form.rawText || form.agentReport) && (
          <div className="card settings-card" style={{ marginTop: 12 }}>
            <strong>Copy scan debug for chat</strong>
            <p className="muted" style={{ margin: '6px 0 10px' }}>
              Copies OCR text, which AIs actually ran, totals, line items, and the full
              agent report — paste that into chat so Grok can see how the scan went wrong.
            </p>
            {reportNote.trim() ? null : (
              <p className="muted" style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>
                Optional: write what looks wrong under Scan details → then copy (your note is
                included).
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', minHeight: 48 }}
              onClick={() => void handleCopyScanDebug()}
            >
              Copy scan debug text
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setShowDebugPreview((v) => !v)}
            >
              {showDebugPreview ? 'Hide preview' : 'Show / select text'}
            </button>
            {debugCopyStatus && (
              <p className="muted" style={{ margin: '10px 0 0' }} role="status">
                {debugCopyStatus}
              </p>
            )}
            {showDebugPreview && (
              <textarea
                readOnly
                value={buildDebugText()}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  width: '100%',
                  marginTop: 10,
                  minHeight: 180,
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '0.75rem',
                }}
              />
            )}
          </div>
        )}

        {/* —— AI / scan details last (collapsed) —— */}
        {(hasScanMeta || props.receiptBlob || props.receiptPreviewUrl) && (
          <div className="card settings-card scan-details-card">
            <button
              type="button"
              className="agent-report-toggle"
              onClick={() => setShowScanDetails((v) => !v)}
            >
              {showScanDetails ? '▼' : '▶'} Scan details &amp; AI info
            </button>
            {showScanDetails && (
              <div className="scan-details-body">
                {(form.activeAiLabel || form.aisUsed.length > 0 || form.fieldSources?.primary) && (
                  <div className="answer-credit-card answer-credit-card-nested">
                    <div className="answer-credit-head">
                      <span className="answer-credit-kicker">Who answered this scan</span>
                      {form.fieldSources?.primary ? (
                        <div className="answer-credit-primary">
                          <span className="answer-credit-emoji">
                            {getAi(form.fieldSources.primary).emoji}
                          </span>
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
                      {form.fieldSources?.answerLabel ||
                        form.activeAiLabel ||
                        'Team huddle result'}
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
                          Actually ran this scan ({form.aisUsed.length}):{' '}
                          {form.aisUsed
                            .map((id) => `${getAi(id).emoji} ${getAi(id).name}`)
                            .join(' · ')}
                        </div>
                      </ExpandableBlock>
                    )}
                  </div>
                )}

                {form.aisUsed.length > 0 && (
                  <div className="field" style={{ marginTop: 12 }}>
                    <label>Who scanned best? (leaderboard)</label>
                    <p className="muted" style={{ margin: '0 0 8px' }}>
                      Optional — pick only from AIs that ran this scan.
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

                {form.agentReport && (
                  <div className="agent-report-card" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="agent-report-toggle"
                      onClick={() => setShowAgentReport((v) => !v)}
                    >
                      {showAgentReport ? '▼' : '▶'} Full scan report
                    </button>
                    {showAgentReport && (
                      <ExpandableBlock collapsedMax={160} className="agent-report-expand">
                        <pre className="agent-report-body agent-report-body-in-expand">
                          {form.agentReport}
                        </pre>
                      </ExpandableBlock>
                    )}
                  </div>
                )}

                <div className="debug-report-card" style={{ marginTop: 12 }}>
                  <strong>Share this scan with Grok</strong>
                  <p className="muted" style={{ margin: '6px 0 10px' }}>
                    Copy the text dump (OCR + who ran + answers) and paste it in chat. No
                    need to retype what went wrong.
                  </p>
                  <div className="field">
                    <label htmlFor="debugNote">What went wrong? (optional — included in copy)</label>
                    <textarea
                      id="debugNote"
                      value={reportNote}
                      onChange={(e) => setReportNote(e.target.value)}
                      placeholder="e.g. Total should be $76.67, vendor is Swag not Pennsylvania…"
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%', marginBottom: 8 }}
                    onClick={() => void handleCopyScanDebug()}
                  >
                    Copy scan debug text
                  </button>
                  {(props.receiptBlob || props.receiptPreviewUrl) && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ width: '100%' }}
                      disabled={reporting}
                      onClick={() => void handleReportBadScan()}
                    >
                      {reporting ? 'Reporting…' : 'Also save full report (JSON)'}
                    </button>
                  )}
                  {debugCopyStatus && (
                    <p className="muted" style={{ margin: '10px 0 0' }} role="status">
                      {debugCopyStatus}
                    </p>
                  )}
                </div>
              </div>
            )}
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
        const url = await getImageUrl(p.receiptImageId)
        if (url) setPreviewUrl(url)
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
        const url = await getImageUrl(p.receiptImageId)
        if (url) setPreviewUrl(url)
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

      {previewUrl ? (
        <SafeImage className="receipt-preview" src={previewUrl} alt="Receipt" />
      ) : null}

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

  if (stats == null) return null
  if (stats.vendors === 0 && stats.hints === 0) return null

  return (
    <div className="card settings-card">
      <strong>On-device memory</strong>
      <p className="muted" style={{ margin: '6px 0 12px' }}>
        {stats.vendors} store{stats.vendors === 1 ? '' : 's'} · {stats.hints} category hint
        {stats.hints === 1 ? '' : 's'} (local only)
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
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
  /** Persist theme without leaving Settings */
  onThemeChange: (s: AppSettings) => Promise<void>
  onClear: () => Promise<void>
  onShowWhatsNew: () => void
  onUpdateAvailable: () => void
}) {
  const [maxPowerMode, setMaxPowerMode] = useState(props.settings.maxPowerMode !== false)
  const [disabledAis, setDisabledAis] = useState<AiId[]>(
    () => sanitizeDisabledAis(props.settings.disabledAis ?? []),
  )
  const [themeId, setThemeId] = useState<ThemeId>(() =>
    normalizeThemeId(props.settings.themeId),
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
  const [hfToken, setHfToken] = useState('')
  const [hfTokenSaved, setHfTokenSaved] = useState(false)

  useEffect(() => {
    void getLeaderboard().then((b) => setBoard(normalizeLeaderboard(b)))
    void listRemoteDebugReports().then(setDebugReports)
    void import('./agents/vlmRunner').then(({ getHfToken }) =>
      getHfToken().then((t) => {
        if (t) setHfToken(t)
      }),
    )
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

  const nativeApp = isNativeCapacitorApp()

  useEffect(() => {
    void useGitHubUpdates()
    void setAutoUpdate(true)
  }, [])

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={props.onBack} aria-label="Back">
          ←
        </button>
        <h1>Settings</h1>
        <VersionChip title="App version" />
      </header>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          setSaving(true)
          void props
            .onSave({
              projectName: props.settings.projectName || 'My project',
              lastSeenVersion: props.settings.lastSeenVersion,
              maxPowerMode,
              disabledAis: sanitizeDisabledAis(disabledAis),
              customCategories: props.settings.customCategories ?? [],
              themeId,
            })
            .finally(() => setSaving(false))
        }}
      >
        {nativeApp && <UpdateCenter />}

        <div className="card settings-card">
          <strong>Home screen theme</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Only the projects list and this Settings screen. Each project has its
            own theme under Edit project — changing home never rewrites them.
          </p>
          <ThemePicker
            value={themeId}
            ariaLabel="Home screen theme"
            onChange={(id) => {
              setThemeId(id)
              applyTheme(id, { persistHome: true })
              void props.onThemeChange({
                projectName: props.settings.projectName || 'My project',
                lastSeenVersion: props.settings.lastSeenVersion,
                maxPowerMode,
                disabledAis: sanitizeDisabledAis(disabledAis),
                customCategories: props.settings.customCategories ?? [],
                themeId: id,
              })
            }}
          />
        </div>

        <div className="card settings-card">
          <strong>Max power mode</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Off = skip heavy free AIs (faster on older phones).
          </p>
          <label className="power-toggle">
            <input
              type="checkbox"
              checked={maxPowerMode}
              onChange={(e) => setMaxPowerMode(e.target.checked)}
            />
            <span>{maxPowerMode ? 'ON' : 'OFF (light team only)'}</span>
          </label>
        </div>

        <OnDeviceMemoryCard />

        <div className="card settings-card">
          <strong>Optional vision models (OFF by default)</strong>
          <p className="muted" style={{ margin: '6px 0 10px' }}>
            Normal scans stay 100% on this phone — free, no account, nothing sent to Grok
            or any paid AI. These optional open models (Qwen, RolmOCR, GOT-OCR, SmolVLM,
            InternVL, DeepSeek-OCR) only run if you turn them on; they use free Hugging Face
            inference (network). Optional free HF token improves rate limits.
          </p>
          <label className="field" style={{ display: 'block', marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              Hugging Face token (optional, free)
            </span>
            <input
              type="password"
              autoComplete="off"
              placeholder="hf_… from huggingface.co/settings/tokens"
              value={hfToken}
              onChange={(e) => {
                setHfToken(e.target.value)
                setHfTokenSaved(false)
              }}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={() => {
              void import('./agents/vlmRunner').then(({ setHfToken: save }) =>
                save(hfToken).then(() => setHfTokenSaved(true)),
              )
            }}
          >
            {hfTokenSaved ? 'Token saved' : 'Save HF token'}
          </button>
        </div>

        <div className="card settings-card">
          <strong>AIs</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            All free. Default team is on-device only (OCR + reasoner that self-checks and
            re-solves). Cloud vision models start OFF. Nothing runs through Grok or a paid API.
            Turn off any engine that is slow on this phone.
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
          <strong>AI leaderboard</strong>
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

        <details className="card settings-card">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Advanced / developer</summary>
          <p className="muted" style={{ margin: '10px 0 12px', fontSize: '0.85rem' }}>
            Device probe, AI tests, roster, debug tools.
          </p>

        <div style={{ marginTop: 12 }}>
          <strong>Device AI scan</strong>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%', marginTop: 8 }}
            disabled={probing}
            onClick={() => void handleDeviceScan()}
          >
            {probing ? 'Scanning…' : 'Scan this device'}
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

        <div style={{ marginTop: 16 }}>
          <strong>AI stability test</strong>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%', marginTop: 8 }}
            disabled={stabilityRunning}
            onClick={() => void handleStabilityTest()}
          >
            {stabilityRunning ? 'Testing…' : 'Test free AIs'}
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

        <div style={{ marginTop: 16 }}>
          <strong>Debug scans</strong>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%', marginTop: 8 }}
            disabled={debugLoading}
            onClick={() => void refreshDebugReports()}
          >
            {debugLoading ? 'Refreshing…' : 'Refresh debug list'}
          </button>
          {debugReports.length > 0 && (
            <div className="debug-list" style={{ marginTop: 12 }}>
              {debugReports.map((r) => (
                <div key={r.id} className="debug-list-row">
                  <div>
                    <strong className="muted" style={{ color: 'var(--text)', fontSize: '0.85rem' }}>
                      {r.id}
                    </strong>
                    <div className="muted" style={{ fontSize: '0.8rem' }}>
                      {r.vendor || '—'} · {r.amount != null ? `$${r.amount}` : 'no total'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </details>

        <div className="card settings-card">
          <strong>App version</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            <strong style={{ color: 'var(--text)' }}>{formatVersionLabel()}</strong>
          </p>
          <button type="button" className="btn btn-secondary" onClick={props.onShowWhatsNew}>
            What&apos;s new
          </button>
        </div>

        {!nativeApp && (
          <div className="card settings-card update-scan-card">
            <strong>Browser updates</strong>
            {updateStatus.state === 'available' && (
              <p className="muted" style={{ margin: '6px 0 10px' }}>
                {updateStatus.message}
              </p>
            )}
            <div className="row-actions stack" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={updateStatus.state === 'checking'}
                onClick={() => void handleCheckUpdates()}
              >
                {updateStatus.state === 'checking' ? 'Checking…' : 'Check for updates'}
              </button>
              {updateStatus.state === 'available' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => applyWaitingUpdate()}
                >
                  Reload to update
                </button>
              )}
            </div>
          </div>
        )}

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

/**
 * App version + changelog.
 * Bump APP_VERSION (and package.json) on every release users should notice.
 * Add a CHANGELOG entry for that version so the "What's new" sheet stays accurate.
 */

/** Keep in sync with package.json version (single source users see in the UI). */
export const APP_VERSION = '1.34.2'

/**
 * Android versionCode for the launcher/shell APK.
 * Bump this whenever the home-screen icon or native plugins change.
 * In-app “Update home-screen logo” compares this to the installed package.
 */
export const APK_VERSION_CODE = 29

/** GitHub release tag that hosts the shell APK (keep in sync when shipping a new shell). */
export const APK_RELEASE_TAG = 'v1.29.1'

export type ChangelogEntry = {
  version: string
  date: string
  title: string
  changes: string[]
}

/** Newest first */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.34.2',
    date: '2026-08-10',
    title: 'Amazon orders: real product names, real totals',
    changes: [
      'Grand total from stacked Amazon summaries (not items subtotal)',
      'Never treat item subtotal as Shipping',
      'Reject “Supplied by / Terminals” OCR crumbs as product titles',
      'Better hard-parts titles (AWG lugs, connector kits, bus bars…)',
    ],
  },
  {
    version: '1.34.1',
    date: '2026-08-10',
    title: 'Any project — not school-bus only',
    changes: [
      'Downloads and installers renamed to Project Cost Tracker (no Schoolie/skoolie names)',
      'APK: project-cost-tracker.apk · backup files use the same branding',
      'Built for kitchen remodels, trips, businesses, vehicles — any project',
    ],
  },
  {
    version: '1.34.0',
    date: '2026-08-10',
    title: 'Backup, fix wrong scans, and project budgets',
    changes: [
      'Full backup & restore in Settings (projects, receipts, photos, settings)',
      'What’s wrong? chips after a scan — mark total/store/products and re-scan',
      'Optional project budget with spent / remaining on the project home',
    ],
  },
  {
    version: '1.33.5',
    date: '2026-08-03',
    title: 'Install on Android and Apple from one link',
    changes: [
      'One install page for phones: Android gets the APK; iPhone/iPad use Safari → Add to Home Screen',
      'Same free on-device app on Apple (no App Store required)',
      'GitHub Pages hosts the shared install link',
    ],
  },
  {
    version: '1.33.4',
    date: '2026-08-03',
    title: 'One spending list — no duplicate engine lines',
    changes: [
      '“Engine & Powertrain” and “Engine And Powertrain” show as one spend bar',
      'Spending bars and Receipts use the same category buckets',
      'Cleaner home layout: Spending by category + Receipts (no dual grouping story)',
    ],
  },
  {
    version: '1.33.3',
    date: '2026-08-03',
    title: 'Engine + powertrain sit in one group',
    changes: [
      '“Groups (similar together)” now clusters engine and powertrain (and similar families)',
      'Display-only — each receipt still keeps its real category (engine vs powertrain)',
      'Categories (spend) still lists exact categories for accurate totals',
    ],
  },
  {
    version: '1.33.2',
    date: '2026-08-03',
    title: 'Groups only sort — never change receipt categories',
    changes: [
      'Removed Regroup that rewrote categories (it felt broken and was unwanted)',
      '“By category” shows each receipt’s real category and spend',
      '“Groups” only puts similar categories together for browsing',
      'Each receipt still shows its own category under the title',
    ],
  },
  {
    version: '1.33.1',
    date: '2026-08-03',
    title: 'Stop inventing words; core charge/trade-in are real money',
    changes: [
      'Do not invent product names from tax, sale total, or OCR chrome',
      'Do not invent categories like “core-parts” / “state” from random tokens',
      'Core charge = deposit you pay; core trade-in = money back for returned cores (real $ amounts)',
      'AutoZone: real unit prices (e.g. batteries) instead of even-split junk lines',
      'Never even-split prices across tax/total labels',
    ],
  },
  {
    version: '1.33.0',
    date: '2026-08-03',
    title: 'Project AI data lab — see everything the AIs got wrong',
    changes: [
      'New “View all project + AI data” on each project',
      'Lists every receipt with saved fields, line items, confidence, and OCR/agent dumps',
      'Copy one receipt or the whole project dump to paste into chat for AI fixes',
      'New scans store OCR text + agent report with the receipt (older ones need a re-scan to capture dumps)',
    ],
  },
  {
    version: '1.32.7',
    date: '2026-08-02',
    title: 'Private-sale price + title cleanup (no more $750 vs $150)',
    changes: [
      'OCR 7150.00 / Loc 7150 treated as $150.00 (leading 7 glued on price)',
      'Listing total forced to the real asking price — not multi-page sum ghosts',
      'Line amount always matches total on single-item private sales',
      'Seller “Dustn/Oustn Mawrer” → Dustin Maurer; clean “reconditioned bus” title',
      'Reject tax/core-charge rows as products; AutoZone vendor + SALE TOTAL totals',
    ],
  },
  {
    version: '1.32.6',
    date: '2026-08-01',
    title: 'Private-sale / Marketplace screenshots — less OCR soup',
    changes: [
      'Reject gibberish vendors like “NIN A HVBDARBM KARZ” (OCR soup, not a store)',
      'Detect “I’m selling…” listings → Private sale · seller name when readable',
      'Rebuild garbage product titles into a short listing description',
      'Read dates like V26/2026 (7 misread as V) as 2026-07-26',
    ],
  },
  {
    version: '1.32.5',
    date: '2026-07-31',
    title: 'Pair unit prices to product titles (not marketing blurbs)',
    changes: [
      'Attach $22 / $20 / $31 style prices to Brand – Product rows from Mosaic OCR',
      'Reject marketing blurbs as line items when real product titles exist',
      'If one product has no price, fill the gap so lines sum to the grand total',
      'GRAND TOTAL on its own line + $ amount on the next line is read correctly',
    ],
  },
  {
    version: '1.32.4',
    date: '2026-07-31',
    title: 'Full multi-page PDF preview + per-page OCR (no more cut-off)',
    changes: [
      'Preview shows the entire PDF stitch (scroll to see page 2+) — not only the first page',
      'OCR reads each PDF page at full page resolution, then merges (prices on later pages no longer crushed)',
      'When many products appear but only order totals are read, run Mosaic tile OCR to hunt unit prices',
      'Still free & on-device',
    ],
  },
  {
    version: '1.32.3',
    date: '2026-07-31',
    title: 'Real unit prices when OCR has them; honest even-split when not',
    changes: [
      'If unit prices appear next to products and sum to the subtotal, use those (not equal $ splits)',
      'When prices are missing from OCR, still list every product but mark amounts as estimated even-split',
      'Lower confidence + clear notes so you know to edit real prices',
      'PDF scans merge any embedded text layer with OCR to recover missing $ amounts',
      'Recover common OCR money glitches ($ misread as S)',
    ],
  },
  {
    version: '1.32.2',
    date: '2026-07-31',
    title: 'Reasoner lists all products on multi-item Amazon PDFs',
    changes: [
      'When OCR shows several Brand – Product rows but no unit prices, list each product (not one $93 bundle)',
      'Ignores marketing blurbs and multi-page duplicate OCR so you get real SKUs only',
      'Splits subtotal evenly across those lines so totals still close',
      'Still fully free & on-device — reasoner self-checks without Grok or paid APIs',
    ],
  },
  {
    version: '1.32.1',
    date: '2026-07-31',
    title: 'Fully free & local by default + multi-product reasoner',
    changes: [
      'Default path: 100% on this phone — no Grok, no paid cloud, no HF required',
      'Cloud vision models (Qwen, RolmOCR, etc.) stay OFF until you opt in',
      'On-device reasoner self-checks and re-solves bad parses without any network',
      'If OCR names several products but unit prices are unreadable, still create one line per product',
      'Splits the order subtotal across those lines so math still closes',
    ],
  },
  {
    version: '1.32.0',
    date: '2026-07-31',
    title: 'Reasoner — scan self-checks and re-solves',
    changes: [
      'After every scan, Arbiter critiques whether the answer is *possible*',
      'Impossible math (product ≫ total, fee=total, tax=total, garbage vendor) triggers a re-solve from OCR',
      'Optional free language model repair only if you enabled cloud vision models',
      'Goal: the team on your phone figures out broken parses — not Grok at scan time',
    ],
  },
  {
    version: '1.31.3',
    date: '2026-07-31',
    title: 'Fix Amazon PDF order scans',
    changes: [
      'Stop treating Amazon order numbers (113-0548166-9548225) as $48,166 product prices',
      '“TOTAL before TAX” no longer sets tax equal to the order total',
      'Detect Amazon order summaries as vendor (not OCR crumbs like S000)',
      'Prefer “Order placed” date over “Return window closed”',
      'Drop bogus shipping/fee lines that clone the grand total on multi-column PDFs',
    ],
  },
  {
    version: '1.31.2',
    date: '2026-07-30',
    title: 'Copy scan debug text',
    changes: [
      'After a scan: one tap copies OCR text, who ran, totals, line items, and the full agent report',
      'Use for your own notes or when reporting a bug offline — the app does not need chat to scan',
      'Optional “what went wrong” note is included in the copy',
    ],
  },
  {
    version: '1.31.1',
    date: '2026-07-30',
    title: 'Honest “who ran” on each scan',
    changes: [
      'Scan details only list AIs that actually ran — not every enabled model',
      'Shows skipped / failed engines separately in the agent report',
      'Leaderboard pick limited to real participants for that receipt',
    ],
  },
  {
    version: '1.31.0',
    date: '2026-07-30',
    title: 'Big vision models for hard receipts',
    changes: [
      'Added free vision VLMs: Qwen2.5-VL, Qwen3-VL, RolmOCR, GOT-OCR 2.0, SmolVLM, InternVL, DeepSeek-OCR',
      'They look at the receipt image (not only Tesseract) via free Hugging Face inference',
      'Optional free HF token in Settings for better rate limits',
      'Toggle each model on/off; light mode still skips heavy tier',
    ],
  },
  {
    version: '1.30.0',
    date: '2026-07-30',
    title: 'Oracle — real vision model reads the receipt',
    changes: [
      'New free on-device vision AI (Donut DocVQA) that looks at the whole page',
      'Asks the image for store, total, date, tax, fees, and line items — not just Tesseract',
      'First scan downloads the free model once, then caches offline',
      'Falls back to classic OCR if the vision model cannot start on a device',
    ],
  },
  {
    version: '1.29.2',
    date: '2026-07-30',
    title: 'Unstick package download on build 27',
    changes: [
      'No longer aborts a working native download when progress events are silent',
      'Shows live % while the ~15 MB package downloads (even on older shells)',
      'Skips WebView pre-fetch that could hang at 0% before download starts',
      'Build 27 can finish Install via native downloader; then you get build 29 logo',
    ],
  },
  {
    version: '1.29.1',
    date: '2026-07-30',
    title: 'Fix package download stuck at 0%',
    changes: [
      'In-app APK downloader follows GitHub redirects more reliably',
      'Shows live progress / heartbeat instead of freezing at 0%',
      'Falls back to WebView download + Install if native download stalls',
      'Tries alternate release URLs automatically',
    ],
  },
  {
    version: '1.29.0',
    date: '2026-07-30',
    title: 'Receipt engine rebuild — accurate invoices',
    changes: [
      'New structured receipt engine: totals, fees, lines with arithmetic lock',
      'PDF invoices rebuild lines from glyph positions (not a word soup)',
      'Retry hard-bans the wrong total/vendor so Fix marked parts cannot repeat them',
      'Engine + classic parse compete; picks the stronger arithmetic result',
    ],
  },
  {
    version: '1.28.1',
    date: '2026-07-30',
    title: 'New cost-peak logo',
    changes: [
      'Redesigned mark: ascending bars + rising trajectory into a hard peak',
      'In-app logo and PWA icons refreshed',
      'Home-screen launcher icon updates with the new package build',
    ],
  },
  {
    version: '1.28.0',
    date: '2026-07-30',
    title: 'Upload PDF invoices and files',
    changes: [
      'Scan screen: new Files button for PDFs and images from Downloads / email',
      'Digital PDF invoices use embedded text (more accurate than photo OCR)',
      'Scanned PDFs are rendered to pages then read with the OCR team',
      'Supports multi-page invoices (up to 4 pages stitched)',
    ],
  },
  {
    version: '1.27.0',
    date: '2026-07-30',
    title: 'Much better receipt scanning (proper OCR path)',
    changes: [
      'Upscales small / cropped photos before OCR (was only downscaling)',
      'Percentile contrast + unsharp prep for thermal and dim phone shots',
      'Forge: adaptive binarize + column/block page modes for tall receipts',
      'Drops weak OCR garbage so it can’t outvote a strong read',
      'Stronger TOTAL-line detection and money OCR fixes (O→0, l→1)',
    ],
  },
  {
    version: '1.26.2',
    date: '2026-07-30',
    title: 'Home theme and project themes are fully separate',
    changes: [
      'Settings → Home screen theme only changes the projects list / Settings',
      'Edit project → This project’s theme only changes that project',
      'Changing one project no longer rewrites the home look or other projects',
    ],
  },
  {
    version: '1.26.1',
    date: '2026-07-30',
    title: 'No double-upload while opening a photo',
    changes: [
      'As soon as you pick a gallery photo, the pick screen locks with “Opening photo…”',
      'Blocks a second Take photo / Gallery tap while the first image is loading or scanning',
      'Avoids accidental duplicate scans when the gallery is slow',
    ],
  },
  {
    version: '1.26.0',
    date: '2026-07-30',
    title: 'Theme per project',
    changes: [
      'Each project can have its own color theme (Edit project → Project theme)',
      'Opening a project switches to that look; home uses Settings → Home theme',
      'New projects start from your home theme until you change them',
    ],
  },
  {
    version: '1.25.9',
    date: '2026-07-30',
    title: 'Fix project cover photos',
    changes: [
      'Cover photo: Take photo / Gallery buttons that work on Android',
      'Preview no longer goes blank after picking a cover',
      'Cover is saved with the project and shows on the home list',
    ],
  },
  {
    version: '1.25.8',
    date: '2026-07-30',
    title: 'Receipt first, AI details last',
    changes: [
      'After a scan, store / total / lines show first so you can verify the read',
      'AI credits, full report, and leaderboard are under “Scan details” at the bottom',
      'Scan screen focuses on the photo — no AI roster list up front',
    ],
  },
  {
    version: '1.25.7',
    date: '2026-07-30',
    title: 'Ten app themes',
    changes: [
      'Settings → Theme: 10 full looks (dark, light, workshop, blueprint…)',
      'Theme applies instantly and is remembered on this device',
      'Status bar color follows the active theme on Android',
    ],
  },
  {
    version: '1.25.6',
    date: '2026-07-30',
    title: 'Quiet home screen — updates only in Settings',
    changes: [
      'Main screens: only a tiny version pill in the top corner',
      'Orange dot on the pill when an update is available',
      'All update download/install UI lives in Settings only',
    ],
  },
  {
    version: '1.25.5',
    date: '2026-07-30',
    title: 'See your versions and get up to date',
    changes: [
      'Shows app content version, Android package build, and installer status',
      'One “Get up to date” button: content first, then package (in-app)',
      'Replaces the stuck Updating… / dual-button mess in Settings',
    ],
  },
  {
    version: '1.25.4',
    date: '2026-07-30',
    title: 'Updates fully inside the app',
    changes: [
      'APK downloads inside Cost Tracker (no browser, no external links)',
      'Uses Android PackageInstaller with in-app progress %',
      'You only confirm Install on the system sheet',
    ],
  },
  {
    version: '1.25.3',
    date: '2026-07-30',
    title: 'In-app installer no longer freezes',
    changes: [
      'Update home-screen logo opens the system download immediately (no endless spinner)',
      'Does not wait on broken native DownloadManager bridge',
      'Extra “Open download link” button if the first tap is blocked',
    ],
  },
  {
    version: '1.25.2',
    date: '2026-07-30',
    title: 'Fix update stuck on “Updating…”',
    changes: [
      'APK download no longer hangs forever waiting on Android DownloadManager',
      'Shows download % progress, then opens Install',
      'Falls back to system download if streaming fails',
    ],
  },
  {
    version: '1.25.1',
    date: '2026-07-30',
    title: 'Home-screen logo install fixed',
    changes: [
      'Fixed broken APK download link (latest release was missing schoolie.apk)',
      'In-app Update home-screen logo uses a direct release URL that always works',
      'Always shows the update card until the installed package is new enough',
    ],
  },
  {
    version: '1.25.0',
    date: '2026-07-30',
    title: 'More consistent receipt AI',
    changes: [
      'New Consensus pass: multi-OCR paths vote on total, vendor, and date',
      'Arithmetic check (products + tax + fee ≈ total) locks in the right total more often',
      'Drops duplicate/ghost product lines that used to break the math',
      'Stronger photo prep for dim thermal receipts + more OCR label cleanup',
    ],
  },
  {
    version: '1.24.9',
    date: '2026-07-30',
    title: 'Update home-screen logo from the app',
    changes: [
      'Big “Update home-screen logo” card on the home screen when the package is behind',
      'Settings → Update home-screen logo downloads the package inside the app',
      'Android still needs one Install tap (system rule) — no browser or GitHub hunt',
    ],
  },
  {
    version: '1.24.8',
    date: '2026-07-30',
    title: 'Bold new infinity logo',
    changes: [
      'Completely new brand mark — rising infinity path (not a bus or receipt)',
      'Home screen, splash, and in-app logo all refreshed',
    ],
  },
  {
    version: '1.24.7',
    date: '2026-07-30',
    title: 'Update everything from inside the app',
    changes: [
      'Check for updates installs web fixes and full app (icon) updates in-app',
      'No browser reinstall needed — tap Install when Android asks for the full app',
      'New folder + receipt home-screen logo (replaces school bus)',
    ],
  },
  {
    version: '1.24.6',
    date: '2026-07-30',
    title: 'New Project Cost Tracker logo',
    changes: [
      'Replaced the school bus icon with a folder + receipt mark',
      'Home-screen launcher, in-app logo, and PWA icons match the rebrand',
    ],
  },
  {
    version: '1.24.5',
    date: '2026-07-29',
    title: 'Regroup keeps AI categories',
    changes: [
      'Regroup no longer re-runs AI invent or overwrites categories on saved receipts',
      'Alike receipts (e.g. Engine + Engine parts) merge into one home-screen group',
      'Only uncategorized (misc) receipts get a first category if needed',
    ],
  },
  {
    version: '1.24.4',
    date: '2026-07-29',
    title: 'Photos actually show (not blank boxes)',
    changes: [
      'Compress camera/gallery photos before display and storage',
      'Stop using huge data-URLs that Android WebView paints as blank',
      'Store images as base64 with magic-byte checks so blanks never load',
      'Broken photos show a clear message instead of an empty frame',
    ],
  },
  {
    version: '1.24.3',
    date: '2026-07-29',
    title: 'Gallery “Recent” photos load correctly',
    changes: [
      'Android Recent / MediaStore picks with empty MIME type are accepted',
      'Photos are fully read and re-encoded to JPEG for preview + OCR',
      'Clearer error if a HEIC/cloud photo cannot be opened',
    ],
  },
  {
    version: '1.24.2',
    date: '2026-07-29',
    title: 'Fix blank receipt photos',
    changes: [
      'Photos load correctly after app restarts (ArrayBuffer storage)',
      'localStorage backup so images survive storage mode changes',
      'More reliable image display on Android WebView (no full APK rebuild needed)',
    ],
  },
  {
    version: '1.24.1',
    date: '2026-07-29',
    title: 'Fix status bar covering the app',
    changes: [
      'Content sits below the Android notification bar',
      'Safe-area padding on main layout and installer',
    ],
  },
  {
    version: '1.24.0',
    date: '2026-07-29',
    title: 'Project Cost Tracker — multiple projects',
    changes: [
      'Renamed to Project Cost Tracker (receipts for any project)',
      'Home screen lists projects; create new ones with name, description, and cover photo',
      'Each project has its own receipts, totals, and category groups',
      'Existing data migrates into a default project automatically',
    ],
  },
  {
    version: '1.23.1',
    date: '2026-07-29',
    title: 'Cleaner UI — less status fluff',
    changes: [
      'Hide “already installed” and install-how-to cards in the real app',
      'Settings focused on real controls; developer tools under Advanced',
      'Scan screen no longer shows long free/local lectures',
    ],
  },
  {
    version: '1.23.0',
    date: '2026-07-29',
    title: 'Simple install + automatic GitHub updates',
    changes: [
      'One APK download — no zip packs or PC server required',
      'App auto-updates from GitHub when you open it',
      'Settings: one “Check for updates” button (advanced options hidden)',
    ],
  },
  {
    version: '1.22.1',
    date: '2026-07-28',
    title: 'Fix “object store was not found” crash on load',
    changes: [
      'Broken IndexedDB schemas self-heal or fall back to permanent local storage',
      'Load APIs never throw storage errors — app always boots',
      'Reset local data fully wipes and reopens a clean database',
    ],
  },
  {
    version: '1.21.1',
    date: '2026-07-28',
    title: 'Installed APK opens the app, not the download screen',
    changes: [
      'Detect Capacitor / Android WebView so the installer is hidden inside the APK',
      'App tray icon opens Schoolie home directly',
    ],
  },
  {
    version: '1.21.0',
    date: '2026-07-28',
    title: 'Real Android APK install',
    changes: [
      'Download schoolie.apk and install like a normal Android app',
      'Installer page offers Download & install (not browser shortcuts)',
      'Build with npm run apk; serve with npm run start:android',
    ],
  },
  {
    version: '1.20.0',
    date: '2026-07-28',
    title: 'Android installer page + HTTPS install server',
    changes: [
      'On Android Chrome the site opens as an Install Schoolie page first',
      'npm run start:android serves HTTPS so Chrome can install correctly',
      'Step-by-step Chrome menu install when automatic install is blocked',
    ],
  },
  {
    version: '1.19.3',
    date: '2026-07-28',
    title: 'Android home-screen install',
    changes: [
      'Big Install card on the home screen for Android (app tray icon)',
      'Chrome: Install app / Add to Home screen — full-screen Schoolie with bus logo',
      'Electron is for desktop only; phones use this install path',
    ],
  },
  {
    version: '1.19.2',
    date: '2026-07-28',
    title: 'App tray + system tray',
    changes: [
      'Installed in the applications menu/tray with the school bus logo',
      'While running, Schoolie stays in the system tray — click to show/hide',
      'Closing the window hides to tray instead of quitting',
    ],
  },
  {
    version: '1.19.1',
    date: '2026-07-28',
    title: 'Clickable desktop logo',
    changes: [
      'Install a Schoolie bus icon on the Desktop and app menu: npm run app:icon',
      'Double-click the logo to start the standalone app',
    ],
  },
  {
    version: '1.19.0',
    date: '2026-07-28',
    title: 'Standalone desktop app',
    changes: [
      'Run as its own window with npm run app (Electron) — not a browser tab',
      'Pack installers with npm run app:pack (Linux AppImage)',
      'Phone: still installable as a PWA (Add to Home Screen) for full-screen use',
      'All receipt AI and data stay free and on-device',
    ],
  },
  {
    version: '1.18.3',
    date: '2026-07-28',
    title: 'Permanent storage without “close other tabs”',
    changes: [
      'Opens the existing local database without version fights',
      'If IndexedDB fails, uses permanent localStorage on this device (not temporary memory)',
      'No more messages blaming other browser tabs',
    ],
  },
  {
    version: '1.18.2',
    date: '2026-07-28',
    title: 'App always opens even if the database is stuck',
    changes: [
      'Auto-repairs or rebuilds a blocked IndexedDB instead of showing an error',
      'Falls back to temporary in-memory storage so the home screen always loads',
      'No more “Database is taking too long to open” dead-end',
    ],
  },
  {
    version: '1.18.1',
    date: '2026-07-28',
    title: 'Fix hang on “Loading your schoolie log…”',
    changes: [
      'IndexedDB open no longer waits forever when another tab blocks it',
      'Retry load + Reset local data if startup fails',
      'Avoided unnecessary DB version bump that could freeze boot',
    ],
  },
  {
    version: '1.18.0',
    date: '2026-07-28',
    title: 'Smarter free AI — still 100% local',
    changes: [
      'On-device memory learns stores, fees, and categories when you save',
      'Local smart pass repairs totals, fees, and free-form categories after OCR',
      'Layout-first OCR: deskew + document rows first; heavy engines only if needed',
      'Better photo prep (contrast) + capture tips on the scan screen',
      'No cloud keys — everything stays on your phone',
    ],
  },
  {
    version: '1.17.3',
    date: '2026-07-28',
    title: 'Type cents with a period',
    changes: [
      'Price fields keep the decimal point while you type (e.g. 12.50)',
      'Line-item amounts and total amount both allow cents',
    ],
  },
  {
    version: '1.17.2',
    date: '2026-07-28',
    title: 'Towing is invented from the receipt, not hardcoded',
    changes: [
      'No schoolie preset for towing — free-form AI invents “Towing” when that word is on the receipt',
      'Same invent path as other free-form groups (filters, engine parts, …)',
      'Fee ✗ and category ✗ fixes from 1.17.1 still apply',
    ],
  },
  {
    version: '1.17.1',
    date: '2026-07-28',
    title: '✗ marks actually fix fees & categories',
    changes: [
      'Marking Fees ✗ when empty now hunts convenience/service fees hard (no more blank fee section)',
      'Also uses total − subtotal − tax when the fee line is hard to OCR',
      'Marking Category ✗ forces a new bucket (won’t stick on Misc)',
    ],
  },
  {
    version: '1.17.0',
    date: '2026-07-28',
    title: 'Category groups on the home screen',
    changes: [
      'Main screen groups receipts under the categories the free AIs invent',
      'Regroup button re-sorts all saved receipts and line items anytime',
      'Hero shows how many groups you have; expand/collapse each group',
    ],
  },
  {
    version: '1.16.1',
    date: '2026-07-28',
    title: 'Harder OCR — T0TAL, fees, store names',
    changes: [
      'Fixes OCR zeros that broke totals (T0TAL), fees (C0NVENIENCE), and vendors (H0ME DEP0T)',
      'No longer treats card lines (VISA CHIP) as the store name',
      'Convenience fees stay in their own Fees section through Council',
      'Subtotal + tax + fee used when total label is noisy',
    ],
  },
  {
    version: '1.16.0',
    date: '2026-07-28',
    title: 'Free-form categories (engine parts, etc.)',
    changes: [
      'Categories are no longer a fixed schoolie-only list',
      'AI invents groups like Engine & Powertrain or Fuel system from the receipt',
      'Type any category name; similar spends group together on the home chart',
    ],
  },
  {
    version: '1.15.2',
    date: '2026-07-28',
    title: 'Clear “who answered” after every scan/rescan',
    changes: [
      'Big Who answered card shows primary AI + OCR/total/vendor credits',
      'Each field and line shows which free AI produced it',
      'Rescan keeps AI credit on unmarked/kept fields',
    ],
  },
  {
    version: '1.15.1',
    date: '2026-07-28',
    title: 'Titan ONNX crash soft-fail',
    changes: [
      'Fixes Titan “Can’t create a session / graph.cc” killing the scan',
      'Titan prefers WASM, tries safer backends, then skips cleanly if ONNX fails',
      'Other free on-device AIs keep running when Titan is unavailable',
    ],
  },
  {
    version: '1.15.0',
    date: '2026-07-28',
    title: 'On-device team huddle — AIs talk to each other',
    changes: [
      'All OCR + parse AIs run locally on your phone (no paid keys)',
      'Team huddle: agents post findings, challenge gaps, and agree together',
      'Council still does a second debate pass; Seeker is optional free web only',
    ],
  },
  {
    version: '1.14.1',
    date: '2026-07-28',
    title: 'Stability test runs every free AI',
    changes: [
      'Test free AIs no longer skips half the roster',
      'Exercises Forge, Lens, Ruler, Wedge, Prism, Bloom, Mosaic, Hammer, Titan, Scout, parsers, Council, Seeker',
    ],
  },
  {
    version: '1.14.0',
    date: '2026-07-28',
    title: 'Unmarked = correct; Fees section; stronger wrong-fix',
    changes: [
      'If you don’t mark a field wrong, the rescan keeps it as correct',
      'Only ✗ parts are rewritten — banned from repeating the same answer',
      'Convenience / service / processing fees go in a Fees section',
    ],
  },
  {
    version: '1.13.0',
    date: '2026-07-28',
    title: 'Expand long sections + ✓/✗ weights AIs',
    changes: [
      'Long text sections expand / scroll so you can read everything',
      'Each mark shows which free AI produced that field or line',
      '✓ credits and ✗ dings that AI — future scans weight trusted AIs higher',
    ],
  },
  {
    version: '1.12.0',
    date: '2026-07-28',
    title: 'Mark parts ✓ right or ✗ wrong, then fix',
    changes: [
      'Mark total, vendor, category, date, shipping, missing products, or each line item',
      'Fix marked parts re-scans and keeps what you marked right',
      'Retry all still re-reads everything if you prefer',
    ],
  },
  {
    version: '1.11.0',
    date: '2026-07-28',
    title: 'More free AIs + per-AI on/off',
    changes: [
      'Added free no-key AIs: Mosaic (tile OCR), Wedge (deskew), Prism (multi-layout), Bloom (2× upscale)',
      'Settings: enable/disable any non-core AI if your phone can’t handle it',
      'Disable heavy / Enable all shortcuts; light mode still skips heavy tier',
    ],
  },
  {
    version: '1.10.2',
    date: '2026-07-28',
    title: 'Try again tells AIs the last answer was wrong',
    changes: [
      'Pressing Try again passes the rejected total/items to the free AI team',
      'Retry re-reads the photo differently and avoids cloning the same answer',
      'Council + Quorum diversify; optional note about what looked wrong helps',
    ],
  },
  {
    version: '1.10.1',
    date: '2026-07-28',
    title: 'Shipping as its own line section',
    changes: [
      'When a receipt has a shipping price, it becomes its own Shipping line (not dropped)',
      'Review screen groups Products and Shipping separately',
      'Manual “+ Shipping” on the form; products still drive the main category',
    ],
  },
  {
    version: '1.10.0',
    date: '2026-07-28',
    title: 'Ruler — reads receipt lines from the photo layout',
    changes: [
      'New free Ruler AI maps every word box on the receipt (not just a text dump)',
      'Keeps product names on the same visual row as their prices',
      'Folds multi-line item names into one product before splitting the list',
      'Sieve + Ledger prefer layout-aware rows so items split more cleanly',
    ],
  },
  {
    version: '1.9.1',
    date: '2026-07-28',
    title: 'Try again when a scan is wrong',
    changes: [
      'Big Try again button if the scan fails or the read looks incomplete',
      'Re-run free AIs on the same photo, or take a new shot',
      'Still can fix fields manually or report a bad scan for debugging',
    ],
  },
  {
    version: '1.9.0',
    date: '2026-07-27',
    title: 'UI polish + new logo',
    changes: [
      'Refined schoolie bus logo and app icons',
      'Cleaner home hero, empty states, category dots, glass bottom bar',
      'Verified tests/build; removed unused assets',
    ],
  },
  {
    version: '1.8.2',
    date: '2026-07-27',
    title: 'Category fixes from user debug notes',
    changes: [
      'Fuel filters / Racor / diesel parts → Fuel & Travel (not Tools)',
      'Towing / service invoices → Misc (services), not Fuel',
      'Optional convenience fee line kept as Misc on tow invoices',
    ],
  },
  {
    version: '1.8.1',
    date: '2026-07-27',
    title: 'Debug recheck: Swag dupes + Falzone towing',
    changes: [
      'Collapse duplicate product amounts when sum exceeds subtotal',
      'Ignore address/shipping chrome in product names',
      'Invoice layout: skip Subtotal/Total/Convenience Fee as products',
      'Towing invoices → Falzone vendor + correct service filing',
      'Seeker detects missing web proxy (HTML responses)',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-07-27',
    title: 'Seeker free web lookup for receipts',
    changes: [
      'Seeker agent looks up SKUs/products on DuckDuckGo + Wikipedia (no API key)',
      'Local free proxy /api/web-lookup on dev/preview server',
      'Council re-debates after Seeker enriches weak product names',
    ],
  },
  {
    version: '1.7.1',
    date: '2026-07-27',
    title: 'Council agent debate + debug receipt recheck',
    changes: [
      'Council blackboard: Cashier challenges gaps, Sieve hunts missing prices, Clerk fixes vendor',
      'Agents talk to each other in multi-round debate after Quorum',
      'Rechecked Swag Performance Parts debug scan — products + shipping math agreement',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-07-27',
    title: 'Max-power free AIs — Hammer + Titan',
    changes: [
      'Hammer: multi-worker parallel OCR swarm (heavy CPU, no key)',
      'Titan: free on-device neural OCR via Transformers.js / TrOCR (WebGPU or WASM)',
      'Max power mode ON by default — pushes the phone hard on every scan',
      'Still 100% free — no API keys, no cloud billing',
    ],
  },
  {
    version: '1.6.1',
    date: '2026-07-27',
    title: 'Fix real receipt parse (Swag Performance Parts)',
    changes: [
      'Multi-line product blocks: catch second items like Caterpillar fuel filter',
      'Do not treat Shipping as a product line item',
      'Vendor from domain/brand footer (not OCR garbage)',
      'Fuel filter / diesel parts map to Tools category',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-07-27',
    title: 'Keyless free AI team only',
    changes: [
      'Removed all AIs that need API keys (Grok, ChatGPT, Gemini)',
      'Added free high-power Lens (upscale OCR), Sieve (line-item ensemble), Quorum (final vote)',
      'Forge + Lens dual OCR paths voted by Quorum — all on-device, no keys',
      'Device scan + stability tests cover only free keyless AIs',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-07-27',
    title: 'Free high-power AIs + device & stability tests',
    changes: [
      'Free high-power Forge OCR (multi-preprocess on your phone)',
      'Settings → Scan this device for AI capability',
      'Settings → Test free AIs stability suite (synthetic receipt)',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-07-27',
    title: 'Report bad scans for debugging',
    changes: [
      '“Report bad scan” saves the receipt photo + AI outputs so the coding agent can inspect them',
      'Reports land in debug-scans/ when using the project’s dev/preview server',
      'Always can download a debug JSON bundle to share',
      'Settings shows remote debug reports when available',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-07-27',
    title: 'Named AIs + leaderboard',
    changes: [
      'See which AI is working by name (Scout, Grok, ChatGPT, …)',
      'Settings lists every AI in the roster with ready/needs-key status',
      'Optional ChatGPT (OpenAI) key alongside Grok (xAI)',
      'Leaderboard: crown who scanned best after each receipt',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-07-27',
    title: 'Multi-agent receipt team + line items',
    changes: [
      'OCR dual-pass + line-items, totals, merchant, and arbiter agents cross-check each other',
      'Full receipt line-item breakdown (edit each row, category per item)',
      'Agent team report on the review screen shows how they agreed or disagreed',
      'Optional cloud agent still cross-checks when local results look thin',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-07-27',
    title: 'Version badge & update scan',
    changes: [
      'Always show the app version so you know which build you’re on',
      'When the app updates, a “What’s new” sheet lists what changed',
      'Settings → Scan for updates checks the server for a newer build',
      'Settings includes full version history and a way to re-open release notes',
      'Banner when a newer install is ready (PWA) so you can reload into it',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-07-27',
    title: 'On-device agent & visual refresh',
    changes: [
      'Low-power on-device receipt agent (runs on your phone when you upload a photo)',
      'Optional cloud boost only if the local read looks weak',
      'New logo, icons, and polished mobile UI',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-07-27',
    title: 'First release',
    changes: [
      'Track schoolie conversion purchases for one bus',
      'Totals, category breakdown, receipt photos',
      'CSV / PDF export and home-screen install (PWA)',
    ],
  },
]

export function getChangelogEntry(version: string): ChangelogEntry | undefined {
  return CHANGELOG.find((e) => e.version === version)
}

/** Entries newer than `fromVersion` (exclusive), newest first. If fromVersion empty, only current. */
export function getUpdatesSince(fromVersion: string | null | undefined): ChangelogEntry[] {
  if (!fromVersion) {
    const current = getChangelogEntry(APP_VERSION)
    return current ? [current] : []
  }
  const out: ChangelogEntry[] = []
  for (const entry of CHANGELOG) {
    if (entry.version === fromVersion) break
    out.push(entry)
  }
  return out
}

export function formatVersionLabel(version: string = APP_VERSION): string {
  return `v${version}`
}

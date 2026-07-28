# Schoolie Cost Tracker

Phone-friendly app to track purchases for **one** school bus conversion (schoolie). Scan receipts with **free on-device AIs**, confirm, and see spend by category.

**Standalone project** — not part of any other app in this workspace.

## Run as a real app (not a browser tab)

### Desktop (Windows / Mac / Linux)

```bash
cd schoolie-tracker
npm install
npm run app
```

That builds (if needed) and opens **Schoolie Cost Tracker** in its own window via Electron.

| Command | What it does |
|---------|----------------|
| `npm run app` | Standalone desktop window |
| `npm run app:pack` | Build Linux AppImage under `release/` |
| `npm run app:pack:deb` | Build `.deb` installer |
| `npm run app:dev` | Electron shell against a running `npm run dev` (set `SCHOOLIE_DEV=1`) |

### Phone (full-screen icon)

1. `npm start` (or host the `dist/` build)
2. Open the URL on your phone
3. Browser menu → **Add to Home Screen** / **Install app**

That installs the PWA so it opens full-screen without browser chrome. Data and OCR stay on the phone.

## Features

- Running total + category groups + regroup
- **Free multi-agent OCR/parse** (no paid API keys)
- On-device memory of stores / fees / categories you confirm
- Mark ✗ and try again on wrong sections
- Manual add / edit / delete
- Export CSV and PDF
- Standalone desktop app **or** installable PWA

## Quick start (browser / phone URL)

```bash
cd schoolie-tracker
npm install
npm run dev
```

Or production-style:

```bash
npm start
```

Open the printed URL on your phone (same network).

## Receipt scanning

**100% free for core scanning — no paid API keys.** Everything runs on your device (browser or Electron window).

Layout-first OCR → parse team → local smart pass + memory. Optional Seeker free web lookup only works when the app is served with its host middleware (`npm run dev` / `npm start`); the desktop pack is fully offline for OCR/tracking.

## Data

- Stored on this device only (IndexedDB and/or permanent localStorage backup)
- Export CSV/PDF from the home screen
- Clearing app data without export loses the log

## Scripts

| Command | Description |
|---------|-------------|
| `npm run app` | **Standalone desktop app** |
| `npm run app:pack` | Package AppImage |
| `npm run dev` | Dev server |
| `npm run build` | Production web build |
| `npm start` | Serve production build (phone / PWA) |
| `npm test` | Unit tests |

## Version

UI shows `vX.Y.Z` (see Settings and home chip). Changelog ships in the app.

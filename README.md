# Schoolie Cost Tracker

Phone-friendly app to track purchases for **one** school bus conversion (schoolie). Scan receipts with **free on-device AIs**, confirm, and see spend by category.

**Standalone project** — not part of any other app in this workspace.

## Run as a real app (not a browser tab)

### Desktop (Windows / Mac / Linux)

```bash
cd schoolie-tracker
npm install
npm run app:icon
```

That installs a **Schoolie bus logo** on your Desktop and in the app menu.  
**Double-click the logo** to start the standalone app (no browser tab).

| Command | What it does |
|---------|----------------|
| `npm run app:icon` | **Install clickable logo** on Desktop + app menu |
| `npm run app` | Launch the window once from the terminal |
| `npm run app:pack` | Build Linux AppImage under `release/` |
| `npm run app:pack:deb` | Build `.deb` installer |

### Android phone (app tray icon)

Electron/desktop installers **do not** put icons on Android. On a phone:

1. On the computer: `npm start` (or `npm run preview`)
2. On the phone (same Wi‑Fi): open the printed URL in **Chrome**
3. On the Schoolie **home screen**, use the yellow **Install Schoolie on this phone** card  
   **or** Chrome ⋮ → **Install app** / **Add to Home screen**
4. Confirm — the school bus logo appears on your **home screen / app tray**
5. Open it from there anytime (full-screen, no browser bar)

Data and OCR stay free and on-device.

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

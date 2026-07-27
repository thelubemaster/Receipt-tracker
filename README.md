# Schoolie Cost Tracker

Phone-friendly app to track purchases for **one** school bus conversion (schoolie). Scan receipts, confirm the suggested details, and see total spend by category.

**Standalone project** — not part of any other app in this workspace.

## Features

- Running total + category breakdown + recent purchases
- **On-device low-power agent** (Tesseract OCR + schoolie filing rules) when you upload a receipt — works offline after first language pack
- Optional cloud boost (xAI) if on-device confidence is low
- Suggest & confirm before save
- Manual add / edit / delete
- Receipt photos stored on device (IndexedDB)
- Export CSV and PDF summary
- Installable PWA (Add to Home Screen)

## Quick start

```bash
cd schoolie-tracker
npm install
npm run dev
```

Open the URL on your phone (same Wi‑Fi) or use the printed local URL. In the browser: **Add to Home Screen**.

## Receipt scanning

**Default — on your phone:** Tap **Scan receipt** → photo → on-device agent reads text and suggests fields. No API key needed.

**Optional cloud boost:** Add an xAI key in Settings ([console.x.ai](https://console.x.ai)). Used only when the on-device read looks weak.

## Version & updates

- Version chip on home and in Settings (`vX.Y.Z`)
- **Settings → Scan for updates** compares this build to the server’s `version.json`
- “What’s new” appears after you land on a newer version

## Data & backup

- Data is stored in this browser/device only
- Use **CSV** / **PDF** on the home screen to export a backup
- Clearing site data or losing the phone without export loses the log

## Scripts

| Command        | Description              |
|----------------|--------------------------|
| `npm run dev`  | Dev server               |
| `npm run build`| Production build         |
| `npm run preview` | Preview production build |
| `npm test`     | Unit tests               |

## Tech

Vite · React · TypeScript · IndexedDB · xAI vision · vite-plugin-pwa

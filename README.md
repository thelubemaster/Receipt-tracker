# Schoolie Cost Tracker

Phone-friendly app to track purchases for **one** school bus conversion (schoolie). Scan receipts, confirm the suggested details, and see total spend by category.

**Standalone project** — not part of any other app in this workspace.

## Features

- Running total + category breakdown + recent purchases
- Scan receipt (photo) → AI suggests date, store, amount, description, category → you confirm
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

## Receipt scanning (xAI)

1. Get an API key at [console.x.ai](https://console.x.ai)
2. In the app: **Settings** → paste key → Save
3. Tap **Scan receipt**

The key stays on your device and is only sent to xAI with the receipt image.

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

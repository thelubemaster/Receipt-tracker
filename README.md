# Schoolie Cost Tracker (Receipt Tracker)

Free, on-device receipt scanning and cost tracking for a school bus conversion (**schoolie**).

**GitHub:** [thelubemaster/Receipt-tracker](https://github.com/thelubemaster/Receipt-tracker)

## Features

- Photograph receipts → local OCR/AI suggests vendor, total, category
- Purchases, categories, totals — stored on your device (IndexedDB)
- Android APK install + **over-the-air web updates from GitHub** (no reinstall for most changes)
- Desktop (Electron) and browser/PWA modes

## Updates from GitHub

After you push to `main`/`master`, GitHub Actions:

1. Builds the web app
2. Deploys to **GitHub Pages**:  
   `https://thelubemaster.github.io/Receipt-tracker/`
3. Publishes a **Release** with `web-update.zip` (tag `vX.Y.Z` from `package.json`)

The installed Android app checks:

1. Your PC update server (optional, `npm run start:android`)
2. GitHub Pages `app-update.json`
3. Latest GitHub Release assets

### One-time GitHub setup

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Push this project to `main` (or `master`)
3. Wait for the **Release web update** workflow to finish
4. On the phone: Settings → **Check for updates** (or auto-update on open)

### Install Android APK (first time)

```bash
npm install
npm run apk                 # builds APK
npm run start:android       # serves installer on your LAN
```

Open the URL printed in the terminal on your phone (HTTP port **4190**), download **schoolie.apk**, install.

Later updates: leave the app installed; it pulls the smaller web bundle from GitHub.

## Develop

```bash
npm install
npm run dev
```

```bash
npm run build
npm test
```

## Version

Bump both:

- `package.json` → `version`
- `src/version.ts` → `APP_VERSION` (+ changelog entry)

Then push — Actions tags release `v…` and updates Pages.

## Privacy

All receipt photos and purchases stay on your device. No cloud account required.

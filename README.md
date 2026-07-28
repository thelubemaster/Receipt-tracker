# Schoolie Cost Tracker (Receipt Tracker)

Free, on-device receipt scanning and cost tracking for a school bus conversion (**schoolie**).

**Repo:** [thelubemaster/Receipt-tracker](https://github.com/thelubemaster/Receipt-tracker)

---

## Download the Android app

### One tap (recommended)

**[⬇ Download schoolie.apk](https://github.com/thelubemaster/Receipt-tracker/releases/latest/download/schoolie.apk)**

Same link every time — always the latest release.

Or open the [Releases page](https://github.com/thelubemaster/Receipt-tracker/releases/latest) and download **schoolie.apk**.

### Install on your phone

1. Open **schoolie.apk** (Chrome download notification or Files app)
2. Allow **Install unknown apps** for Chrome / Files if Android asks
3. Tap **Install** → **Open**

No Play Store account required. Your data stays on the device.

### Web installer

After GitHub Pages is enabled, Android phones can also open:

**https://thelubemaster.github.io/Receipt-tracker/**

and tap **Download app from GitHub**.

---

## Features

- Photograph receipts → local OCR/AI suggests vendor, total, category
- Purchases, categories, totals — stored on your device only
- **Download APK from GitHub** + **OTA web updates** from the same repo (no reinstall for most changes)
- Desktop (Electron) and browser/PWA modes

## How updates work

On every push to `main`/`master`, GitHub Actions:

1. Builds the web app → **GitHub Pages**
2. Builds the **Android APK**
3. Publishes a **Release** `vX.Y.Z` with:
   - `schoolie.apk` ← install / reinstall the app
   - `web-update.zip` ← small OTA package for already-installed apps

Installed apps check GitHub for newer web bundles (Settings → Check for updates).

### One-time GitHub setup

1. **Settings → Pages → Source: GitHub Actions**
2. Push this project (`master` or `main`)
3. Wait for the **Release app** workflow (builds APK + web)
4. Share the download link above

## Develop locally

```bash
npm install
npm run dev          # web UI
npm run apk          # build APK on a machine with Android SDK
npm run start:android  # optional LAN installer (HTTP :4190)
```

```bash
npm run build
npm test
```

## Version

Bump both:

- `package.json` → `version`
- `src/version.ts` → `APP_VERSION` (+ changelog entry)

Then push — Actions publishes release `v…` with a fresh APK.

## Privacy

All receipt photos and purchases stay on your device. No cloud account required.

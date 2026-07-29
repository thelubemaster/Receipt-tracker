# Schoolie Cost Tracker

Free on-device receipt scanning for a school bus conversion.

**Repo:** [thelubemaster/Receipt-tracker](https://github.com/thelubemaster/Receipt-tracker)

---

## Install (one step)

### On your Android phone

1. Open this link and download the file:  
   **[⬇ schoolie.apk](https://github.com/thelubemaster/Receipt-tracker/releases/latest/download/schoolie.apk)**
2. Open **schoolie.apk** → **Install** → **Open**

That’s it. Allow “Install unknown apps” only if Android asks.

### Updates (automatic)

After install, open the app on Wi‑Fi or mobile data. It checks GitHub and installs a small update package by itself.  
You only re-download the APK for rare native changes (or if something is badly broken).

Settings → **Check for updates** if you want to force a check.

---

## Develop

```bash
npm install
npm run dev
npm run build
npm run apk          # build APK (needs Android SDK)
```

Publish: push to `main`, attach `schoolie.apk` + `web-update.zip` to a GitHub Release tagged `vX.Y.Z` matching `package.json` version.

## Privacy

Receipts and purchases stay on your device. No account required.

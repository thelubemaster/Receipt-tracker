#!/usr/bin/env bash
# Build Project-Cost-Tracker-Install.zip
# Primary install file: 00-INSTALL-Project-Cost-Tracker.apk (tap after extract)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APK_SRC=""
for c in \
  "$ROOT/public/downloads/project-cost-tracker.apk" \
  "$ROOT/dist/downloads/project-cost-tracker.apk" \
  "$ROOT/public/downloads/schoolie.apk" \
  "$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
do
  if [[ -f "$c" ]]; then APK_SRC="$c"; break; fi
done
if [[ -z "$APK_SRC" ]]; then
  echo "No project-cost-tracker.apk found. Run: npm run apk" >&2
  exit 1
fi

OUT_DIR="$ROOT/dist/downloads"
mkdir -p "$OUT_DIR"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# One APK only (clear name sorts first).
cp -f "$APK_SRC" "$STAGE/00-INSTALL-Project-Cost-Tracker.apk"

cp -f "$ROOT/install-pack/00-OPEN-ME-TO-INSTALL.html" "$STAGE/"
cp -f "$ROOT/install-pack/README-INSTALL.txt" "$STAGE/"
cp -f "$ROOT/install-pack/install-adb.sh" "$STAGE/"
cp -f "$ROOT/install-pack/install-adb.bat" "$STAGE/"
chmod +x "$STAGE/install-adb.sh"
sed -i 's/schoolie\.apk/00-INSTALL-Project-Cost-Tracker.apk/g; s/project-cost-tracker\.apk/00-INSTALL-Project-Cost-Tracker.apk/g' \
  "$STAGE/install-adb.sh" "$STAGE/install-adb.bat" 2>/dev/null || true

ZIP="$OUT_DIR/Project-Cost-Tracker-Install.zip"
rm -f "$ZIP"
(
  cd "$STAGE"
  zip -qr "$ZIP" .
)
mkdir -p "$ROOT/public/downloads"
cp -f "$ZIP" "$ROOT/public/downloads/Project-Cost-Tracker-Install.zip"

echo "✓ Install pack: $ZIP"
ls -lh "$ZIP"
echo "Contents:"
unzip -l "$ZIP"

#!/usr/bin/env bash
# Build Schoolie-Install.zip
# Primary install file: 00-INSTALL-Schoolie.apk (tap after extract)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APK_SRC=""
for c in \
  "$ROOT/public/downloads/schoolie.apk" \
  "$ROOT/dist/downloads/schoolie.apk" \
  "$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
do
  if [[ -f "$c" ]]; then APK_SRC="$c"; break; fi
done
if [[ -z "$APK_SRC" ]]; then
  echo "No schoolie.apk found. Run: npm run apk" >&2
  exit 1
fi

OUT_DIR="$ROOT/dist/downloads"
mkdir -p "$OUT_DIR"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Sort first + obvious name so people tap the APK, not a broken HTML link
cp -f "$APK_SRC" "$STAGE/00-INSTALL-Schoolie.apk"
# Same bytes under classic name for people who expect schoolie.apk
cp -f "$APK_SRC" "$STAGE/schoolie.apk"

cp -f "$ROOT/install-pack/00-OPEN-ME-TO-INSTALL.html" "$STAGE/"
cp -f "$ROOT/install-pack/README-INSTALL.txt" "$STAGE/"
cp -f "$ROOT/install-pack/install-adb.sh" "$STAGE/"
cp -f "$ROOT/install-pack/install-adb.bat" "$STAGE/"
chmod +x "$STAGE/install-adb.sh"

ZIP="$OUT_DIR/Schoolie-Install.zip"
rm -f "$ZIP"
(
  cd "$STAGE"
  zip -qr "$ZIP" .
)
mkdir -p "$ROOT/public/downloads"
cp -f "$ZIP" "$ROOT/public/downloads/Schoolie-Install.zip"

echo "✓ Install pack: $ZIP"
ls -lh "$ZIP"
echo "Contents:"
unzip -l "$ZIP"

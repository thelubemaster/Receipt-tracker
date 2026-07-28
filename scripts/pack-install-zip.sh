#!/usr/bin/env bash
# Build Schoolie-Install.zip = APK + "open me" installer HTML
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

cp -f "$ROOT/install-pack/00-OPEN-ME-TO-INSTALL.html" "$STAGE/"
cp -f "$ROOT/install-pack/README-INSTALL.txt" "$STAGE/"
cp -f "$ROOT/install-pack/install-adb.sh" "$STAGE/"
cp -f "$ROOT/install-pack/install-adb.bat" "$STAGE/"
chmod +x "$STAGE/install-adb.sh"
cp -f "$APK_SRC" "$STAGE/schoolie.apk"

ZIP="$OUT_DIR/Schoolie-Install.zip"
rm -f "$ZIP"
(
  cd "$STAGE"
  zip -qr "$ZIP" .
)
# also keep a copy under public for local server if needed
mkdir -p "$ROOT/public/downloads"
cp -f "$ZIP" "$ROOT/public/downloads/Schoolie-Install.zip"

echo "✓ Install pack: $ZIP"
ls -lh "$ZIP"
echo "Contents:"
unzip -l "$ZIP" | sed -n '1,20p'

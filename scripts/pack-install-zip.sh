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

# One APK only (clear name sorts first). Duplicating schoolie.apk doubles the zip size.
cp -f "$APK_SRC" "$STAGE/00-INSTALL-Schoolie.apk"

cp -f "$ROOT/install-pack/00-OPEN-ME-TO-INSTALL.html" "$STAGE/"
cp -f "$ROOT/install-pack/README-INSTALL.txt" "$STAGE/"
cp -f "$ROOT/install-pack/install-adb.sh" "$STAGE/"
cp -f "$ROOT/install-pack/install-adb.bat" "$STAGE/"
chmod +x "$STAGE/install-adb.sh"
# adb helpers expect schoolie.apk name — symlink name via copy of tiny note, script uses 00- name
sed -i 's/schoolie\.apk/00-INSTALL-Schoolie.apk/g' "$STAGE/install-adb.sh" "$STAGE/install-adb.bat"

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

#!/usr/bin/env bash
# Optional: install schoolie.apk to a phone over USB (requires adb).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
APK="$DIR/schoolie.apk"
if [[ ! -f "$APK" ]]; then
  echo "Missing schoolie.apk next to this script." >&2
  exit 1
fi
if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found. On Android: open 00-OPEN-ME-TO-INSTALL.html or schoolie.apk instead." >&2
  exit 1
fi
adb devices
adb install -r "$APK"
echo "Installed. Open Schoolie on the phone."

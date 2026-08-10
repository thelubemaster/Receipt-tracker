#!/usr/bin/env bash
# Optional: install project-cost-tracker.apk to a phone over USB (requires adb).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
APK=""
for c in \
  "$DIR/00-INSTALL-Project-Cost-Tracker.apk" \
  "$DIR/project-cost-tracker.apk" \
  "$DIR/schoolie.apk"
do
  if [[ -f "$c" ]]; then APK="$c"; break; fi
done
if [[ -z "$APK" ]]; then
  echo "Missing APK next to this script." >&2
  exit 1
fi
if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found. On Android: open 00-INSTALL-Project-Cost-Tracker.apk instead." >&2
  exit 1
fi
adb devices
adb install -r "$APK"
echo "Installed. Open Project Cost Tracker on the phone."

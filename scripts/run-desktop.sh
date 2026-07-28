#!/usr/bin/env bash
# Launch Schoolie as a standalone desktop window (Electron).
# Usage: npm run app   OR   bash scripts/run-desktop.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f dist/index.html ]]; then
  echo "Building Schoolie…"
  npm run build
fi

if [[ ! -d node_modules/electron ]]; then
  echo "Installing Electron…"
  npm install --no-fund --no-audit
fi

echo "Starting Schoolie desktop app…"
# Electron refuses to run as root without --no-sandbox
EXTRA=()
if [[ "$(id -u)" -eq 0 ]]; then
  EXTRA+=(--no-sandbox)
fi
exec npx electron . "${EXTRA[@]}" "$@"

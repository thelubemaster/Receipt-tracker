#!/usr/bin/env bash
# Start Schoolie Cost Tracker in the foreground (stops when you close the terminal).
# Usage: npm start
# Rebuilds when dist is missing or package.json version changed (avoids stale v1.x UI).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${SCHOOLIE_PORT:-4190}"
HOST="${SCHOOLIE_HOST:-0.0.0.0}"

cd "$ROOT"

PKG_VER="$(node -p "require('./package.json').version" 2>/dev/null || echo "")"
STAMP_FILE="dist/.schoolie-build-version"
NEED_BUILD=0

if [[ ! -f dist/index.html ]]; then
  NEED_BUILD=1
elif [[ -n "$PKG_VER" ]]; then
  BUILT_VER="$(cat "$STAMP_FILE" 2>/dev/null || echo "")"
  if [[ "$BUILT_VER" != "$PKG_VER" ]]; then
    echo "Version changed (${BUILT_VER:-none} → ${PKG_VER}) — rebuilding…"
    NEED_BUILD=1
  fi
fi

if [[ "$NEED_BUILD" -eq 1 ]]; then
  echo "Building Schoolie…"
  npm run build
  if [[ -n "$PKG_VER" ]]; then
    mkdir -p dist
    echo "$PKG_VER" > "$STAMP_FILE"
  fi
fi

if [[ ! -f node_modules/vite/bin/vite.js ]]; then
  echo "Missing deps — run: npm install" >&2
  exit 1
fi

# Stamp current build if missing (e.g. manual npm run build)
if [[ -n "$PKG_VER" && ! -f "$STAMP_FILE" ]]; then
  echo "$PKG_VER" > "$STAMP_FILE"
fi

echo "Schoolie → http://localhost:${PORT}/  (v${PKG_VER:-?})"
echo "(Stop with Ctrl+C when you're done — nothing stays running in the background.)"
exec node node_modules/vite/bin/vite.js preview --host "$HOST" --port "$PORT"

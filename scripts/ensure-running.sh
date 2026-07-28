#!/usr/bin/env bash
# Start Schoolie Cost Tracker in the foreground (stops when you close the terminal).
# Usage: npm start

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${SCHOOLIE_PORT:-4190}"
HOST="${SCHOOLIE_HOST:-0.0.0.0}"

cd "$ROOT"

if [[ ! -f dist/index.html ]]; then
  echo "Building Schoolie…"
  npm run build
fi

if [[ ! -f node_modules/vite/bin/vite.js ]]; then
  echo "Missing deps — run: npm install" >&2
  exit 1
fi

echo "Schoolie → http://localhost:${PORT}/"
echo "(Stop with Ctrl+C when you're done — nothing stays running in the background.)"
exec node node_modules/vite/bin/vite.js preview --host "$HOST" --port "$PORT"

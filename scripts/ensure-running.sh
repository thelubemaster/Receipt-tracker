#!/usr/bin/env bash
# Keep Schoolie Cost Tracker available on a fixed port.
# Safe to call repeatedly (login, cron, manual) — no duplicate servers.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${SCHOOLIE_PORT:-4190}"
HOST="${SCHOOLIE_HOST:-0.0.0.0}"
PIDFILE="${ROOT}/.schoolie-preview.pid"
LOG="${ROOT}/.schoolie-preview.log"
NODE="${NODE:-$(command -v node)}"
VITE="${ROOT}/node_modules/vite/bin/vite.js"

cd "$ROOT"

is_up() {
  curl -sf --connect-timeout 1 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1
}

pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# Already healthy?
if is_up; then
  echo "Schoolie already running on http://127.0.0.1:${PORT}/"
  exit 0
fi

# Stale pidfile?
if [[ -f "$PIDFILE" ]]; then
  old="$(cat "$PIDFILE" 2>/dev/null || true)"
  if pid_alive "$old"; then
    # Process exists but not answering — kill and restart
    kill "$old" 2>/dev/null || true
    sleep 1
    kill -9 "$old" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
fi

# Need a build?
if [[ ! -f dist/index.html ]]; then
  echo "Building Schoolie…"
  npm run build >>"$LOG" 2>&1
fi

if [[ ! -f "$VITE" ]]; then
  echo "Missing vite — run npm install in $ROOT" >&2
  exit 1
fi

echo "Starting Schoolie on ${HOST}:${PORT}…"
# Detached restart loop so a crash brings the app back
nohup bash -c "
  while true; do
    \"${NODE}\" \"${VITE}\" preview --host \"${HOST}\" --port \"${PORT}\" >>\"${LOG}\" 2>&1 &
    child=\$!
    echo \$child > \"${PIDFILE}\"
    wait \$child
    code=\$?
    echo \"[\$(date -Iseconds)] preview exited \$code — restarting in 2s\" >>\"${LOG}\"
    sleep 2
  done
" >/dev/null 2>&1 &

# Wait until it answers (up to ~15s)
for _ in $(seq 1 30); do
  if is_up; then
    echo "Schoolie ready → http://localhost:${PORT}/"
    echo "               → http://100.120.111.214:${PORT}/  (network)"
    exit 0
  fi
  sleep 0.5
done

echo "Started but not answering yet — check ${LOG}" >&2
exit 1

#!/usr/bin/env bash
# Start Schoolie Cost Tracker standalone (Electron). Used by app menu / tray / desktop icon.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
[[ -f "$ROOT/package.json" ]] || ROOT="/root/schoolie-tracker"
cd "$ROOT"

LOG_DIR="${XDG_CACHE_HOME:-$HOME/.cache}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/schoolie-app.log"

{
  echo "---- $(date -Iseconds) ----"
  echo "ROOT=$ROOT USER=$(id -un) DISPLAY=${DISPLAY:-} WAYLAND=${WAYLAND_DISPLAY:-}"
} >>"$LOG" 2>&1 || true

# Node / npm (nvm or fixed path used in this environment)
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
if [[ -x /root/.nvm/versions/node/v24.16.0/bin/node ]]; then
  export PATH="/root/.nvm/versions/node/v24.16.0/bin:$PATH"
fi
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

if [[ ! -f "$ROOT/dist/index.html" ]]; then
  echo "Building Schoolie (first launch)…" | tee -a "$LOG"
  (cd "$ROOT" && npm run build) >>"$LOG" 2>&1 || {
    echo "Build failed. See $LOG" >&2
    exit 1
  }
fi

ELECTRON_BIN="$ROOT/node_modules/electron/dist/electron"
if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Installing Electron…" | tee -a "$LOG"
  (cd "$ROOT" && npm install --no-fund --no-audit electron@37.2.0) >>"$LOG" 2>&1 || true
  # Repair incomplete electron install
  if [[ ! -x "$ELECTRON_BIN" ]]; then
    (cd "$ROOT/node_modules/electron" && node install.js) >>"$LOG" 2>&1 || true
  fi
fi

if [[ -x "$ELECTRON_BIN" ]]; then
  printf 'electron' >"$ROOT/node_modules/electron/path.txt"
fi

# Display
if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  # Common defaults under proot / VNC
  for d in :0 :1 :2; do
    if [[ -e /tmp/.X11-unix/X${d#:} ]]; then
      export DISPLAY="$d"
      break
    fi
  done
  export DISPLAY="${DISPLAY:-:0}"
fi

EXTRA=()
if [[ "$(id -u)" -eq 0 ]]; then
  EXTRA+=(--no-sandbox --disable-gpu-sandbox)
fi

cd "$ROOT"
if [[ -x "$ELECTRON_BIN" ]]; then
  exec "$ELECTRON_BIN" "${EXTRA[@]}" "$ROOT" "$@" >>"$LOG" 2>&1
fi

# Fallback
exec npx electron . "${EXTRA[@]}" "$@" >>"$LOG" 2>&1

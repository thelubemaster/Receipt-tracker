#!/usr/bin/env bash
# Clickable launcher entry point for Schoolie Cost Tracker.
# Used by the desktop icon (.desktop file). Always resolves the install root.

set -euo pipefail

# Prefer the directory this script lives in (project/scripts → project root)
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Fallback: fixed path if the desktop file embeds it
if [[ ! -f "$ROOT/package.json" ]]; then
  ROOT="/root/schoolie-tracker"
fi

cd "$ROOT"

# Log for debugging launcher issues (optional)
LOG="${XDG_CACHE_HOME:-$HOME/.cache}/schoolie-app.log"
mkdir -p "$(dirname "$LOG")"
{
  echo "---- $(date -Iseconds) start ----"
  echo "ROOT=$ROOT"
  echo "USER=$(id -un) uid=$(id -u)"
} >>"$LOG" 2>&1 || true

export PATH="${PATH}:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin"

# Prefer project-local node if nvm present
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
fi

if ! command -v npm >/dev/null 2>&1 && [[ -x /root/.nvm/versions/node/v24.16.0/bin/npm ]]; then
  export PATH="/root/.nvm/versions/node/v24.16.0/bin:$PATH"
fi

if [[ ! -f dist/index.html ]]; then
  echo "Building Schoolie…" | tee -a "$LOG"
  npm run build >>"$LOG" 2>&1 || {
    echo "Build failed — see $LOG" >&2
    exit 1
  }
fi

if [[ ! -d node_modules/electron ]]; then
  echo "Installing Electron…" | tee -a "$LOG"
  npm install --no-fund --no-audit >>"$LOG" 2>&1 || true
fi

# Ensure electron binary path file is valid
if [[ -x node_modules/electron/dist/electron ]]; then
  printf 'electron' > node_modules/electron/path.txt
fi

EXTRA=()
if [[ "$(id -u)" -eq 0 ]]; then
  EXTRA+=(--no-sandbox)
fi

# Linux desktop apps often need DISPLAY
if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  export DISPLAY="${DISPLAY:-:0}"
fi

cd "$ROOT"
exec npx electron . "${EXTRA[@]}" "$@" >>"$LOG" 2>&1

#!/usr/bin/env bash
# Stop Schoolie preview + restart loop.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${SCHOOLIE_PORT:-4190}"
PIDFILE="${ROOT}/.schoolie-preview.pid"

# Kill restart-loop parent and child by pidfile + port listeners
if [[ -f "$PIDFILE" ]]; then
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]]; then
    # Kill process group / parent bash loop if possible
    kill "$pid" 2>/dev/null || true
    # Parent of vite is often the loop; try parent too
    ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
    [[ -n "${ppid:-}" && "$ppid" != "1" ]] && kill "$ppid" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
fi

# Anything still bound to the port
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
else
  python3 - <<PY
import os, signal, subprocess
port = "${PORT}"
out = subprocess.check_output(["ps", "-eo", "pid,args"], text=True)
for line in out.splitlines():
    if "vite" in line and "preview" in line and "python" not in line:
        try:
            os.kill(int(line.split()[0]), signal.SIGTERM)
        except Exception:
            pass
PY
fi

sleep 0.5
echo "Schoolie stopped (port ${PORT})."

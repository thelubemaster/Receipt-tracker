#!/usr/bin/env bash
# Stop a Schoolie preview if one is still bound to the port.

set -euo pipefail

PORT="${SCHOOLIE_PORT:-4190}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="${ROOT}/.schoolie-preview.pid"

if [[ -f "$PIDFILE" ]]; then
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  [[ -n "${pid:-}" ]] && kill "$pid" 2>/dev/null || true
  rm -f "$PIDFILE"
fi

python3 - <<PY
import os, signal, subprocess
out = subprocess.check_output(["ps", "-eo", "pid,args"], text=True)
for line in out.splitlines():
    if "vite" in line and "preview" in line and "python" not in line:
        try:
            os.kill(int(line.split()[0]), signal.SIGTERM)
            print("stopped", line.split()[0])
        except Exception:
            pass
PY

echo "Schoolie is not running."

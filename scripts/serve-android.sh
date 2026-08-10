#!/usr/bin/env bash
# Serve Project Cost Tracker for Android install with HTTPS (Chrome install needs a secure origin).
# Usage: npm run start:android
# Phone: open the printed https://IP:4190 URL → Install page.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${SCHOOLIE_PORT:-4190}"
CERT_DIR="$ROOT/.certs"
KEY="$CERT_DIR/key.pem"
CERT="$CERT_DIR/cert.pem"

if [[ ! -f dist/index.html ]]; then
  echo "Building…"
  npm run build
fi

mkdir -p "$CERT_DIR"
if [[ ! -f "$KEY" || ! -f "$CERT" ]]; then
  echo "Creating local HTTPS certificate (one-time)…"
  openssl req -x509 -newkey rsa:2048 \
    -keyout "$KEY" -out "$CERT" \
    -days 825 -nodes \
    -subj "/CN=Project Cost TrackerLocal/O=Project Cost Tracker/C=US" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    2>/dev/null || \
  openssl req -x509 -newkey rsa:2048 \
    -keyout "$KEY" -out "$CERT" \
    -days 825 -nodes \
    -subj "/CN=Project Cost TrackerLocal"
fi

# Discover LAN IP for phone
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
IP="${IP:-$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')}"
IP="${IP:-127.0.0.1}"

echo ""
echo "=============================================="
echo "  Project Cost Tracker Android installer (HTTPS)"
echo "=============================================="
echo "  On your phone (Chrome), open:"
echo ""
echo "    https://${IP}:${PORT}/"
echo ""
echo "  Chrome will warn about the certificate — tap"
echo "  Advanced → Proceed (safe for your home network)."
echo "  Then use the Install page to add Project Cost Tracker."
echo "=============================================="
echo ""

# vite preview with HTTPS
exec node node_modules/vite/bin/vite.js preview \
  --host 0.0.0.0 \
  --port "$PORT" \
  --strictPort \
  --https \
  2>/dev/null || \
exec npx vite preview --host 0.0.0.0 --port "$PORT" --strictPort

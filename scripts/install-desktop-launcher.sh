#!/usr/bin/env bash
# Install a clickable Schoolie app icon on the Desktop and app menu.
# Usage: npm run app:install-icon   OR   bash scripts/install-desktop-launcher.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$ROOT"

START="$ROOT/scripts/start-schoolie-app.sh"
ICON_SRC="$ROOT/public/pwa-512.png"
ICON_NAME="schoolie-tracker"
APP_ID="schoolie-tracker"

chmod +x "$START" "$ROOT/scripts/run-desktop.sh" 2>/dev/null || true

if [[ ! -f "$ICON_SRC" ]]; then
  echo "Missing icon: $ICON_SRC" >&2
  exit 1
fi

# --- Icon theme paths (so the logo shows on the launcher) ---
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps"
mkdir -p "$ICON_DIR"
cp -f "$ICON_SRC" "$ICON_DIR/${ICON_NAME}.png"

# Also 128 and 256 if we only have 512 (reuse same file)
for size in 128 192 256; do
  d="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/${size}x${size}/apps"
  mkdir -p "$d"
  cp -f "$ICON_SRC" "$d/${ICON_NAME}.png"
done

# Pixmap fallback
PIXMAP="${XDG_DATA_HOME:-$HOME/.local/share}/pixmaps"
mkdir -p "$PIXMAP"
cp -f "$ICON_SRC" "$PIXMAP/${ICON_NAME}.png"

# --- .desktop file ---
DESKTOP_CONTENT="[Desktop Entry]
Version=1.0
Type=Application
Name=Schoolie Cost Tracker
GenericName=Schoolie
Comment=Track schoolie conversion costs — free on-device receipt scans
Exec=${START}
Icon=${ICON_NAME}
Path=${ROOT}
Terminal=false
Categories=Office;Finance;Utility;
Keywords=schoolie;bus;receipt;budget;
StartupNotify=true
StartupWMClass=schoolie-tracker
"

APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS_DIR"
DESKTOP_FILE="$APPS_DIR/${APP_ID}.desktop"
printf '%s\n' "$DESKTOP_CONTENT" >"$DESKTOP_FILE"
chmod +x "$DESKTOP_FILE"

# Desktop folder (GNOME / common)
for DESK in "$HOME/Desktop" "$HOME/desktop" "/root/Desktop"; do
  if [[ -d "$DESK" ]] || mkdir -p "$DESK" 2>/dev/null; then
    DEST="$DESK/Schoolie Cost Tracker.desktop"
    printf '%s\n' "$DESKTOP_CONTENT" >"$DEST"
    chmod +x "$DEST"
    # Mark as trusted (GNOME 3.38+)
    if command -v gio >/dev/null 2>&1; then
      gio set "$DEST" metadata::trusted true 2>/dev/null || true
    fi
    # Allow launch without "Untrusted application" on some desktops
    if command -v dbus-launch >/dev/null 2>&1; then
      gio set "$DEST" metadata::trusted true 2>/dev/null || true
    fi
    echo "Desktop icon: $DEST"
    break
  fi
done

# Refresh icon cache if available
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor" 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" 2>/dev/null || true
fi

echo ""
echo "✓ Schoolie launcher installed"
echo "  App menu:  $DESKTOP_FILE"
echo "  Icon:      $ICON_DIR/${ICON_NAME}.png"
echo "  Start:     $START"
echo ""
echo "Look for “Schoolie Cost Tracker” on your Desktop or in the applications menu."
echo "Double-click the school bus logo to open the app."

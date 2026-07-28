#!/usr/bin/env bash
# Install Schoolie into the system app menu (and Desktop).
# Also ensures the bus logo is registered so it shows in the app tray/launcher.
# Usage: npm run app:icon

set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$ROOT"

START="$ROOT/scripts/start-schoolie-app.sh"
ICON_SRC="$ROOT/public/pwa-512.png"
ICON_NAME="schoolie-tracker"
APP_ID="schoolie-tracker"

chmod +x "$START" \
  "$ROOT/scripts/run-desktop.sh" \
  "$ROOT/scripts/install-desktop-launcher.sh" 2>/dev/null || true

if [[ ! -f "$ICON_SRC" ]]; then
  echo "Missing icon: $ICON_SRC" >&2
  exit 1
fi

# Ensure a build exists so first click works offline
if [[ ! -f dist/index.html ]]; then
  echo "Building Schoolie once so the launcher can start immediately…"
  npm run build
fi

# --- Icons for app tray / launcher ---
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
for size in 48 64 128 192 256 512; do
  d="$DATA_HOME/icons/hicolor/${size}x${size}/apps"
  mkdir -p "$d"
  cp -f "$ICON_SRC" "$d/${ICON_NAME}.png"
done
mkdir -p "$DATA_HOME/pixmaps"
cp -f "$ICON_SRC" "$DATA_HOME/pixmaps/${ICON_NAME}.png"

# System-wide icons when we can (makes it appear for all users)
if [[ "$(id -u)" -eq 0 ]] || command -v sudo >/dev/null 2>&1; then
  for size in 48 128 256 512; do
    d="/usr/share/icons/hicolor/${size}x${size}/apps"
    if mkdir -p "$d" 2>/dev/null; then
      cp -f "$ICON_SRC" "$d/${ICON_NAME}.png" 2>/dev/null || true
    elif command -v sudo >/dev/null 2>&1; then
      sudo mkdir -p "$d" 2>/dev/null || true
      sudo cp -f "$ICON_SRC" "$d/${ICON_NAME}.png" 2>/dev/null || true
    fi
  done
  if mkdir -p /usr/share/pixmaps 2>/dev/null; then
    cp -f "$ICON_SRC" "/usr/share/pixmaps/${ICON_NAME}.png" 2>/dev/null || true
  fi
fi

DESKTOP_CONTENT="[Desktop Entry]
Version=1.0
Type=Application
Name=Schoolie Cost Tracker
GenericName=Schoolie
Comment=Track schoolie conversion costs — free on-device receipt scans
Exec=${START}
TryExec=${START}
Icon=${ICON_NAME}
Path=${ROOT}
Terminal=false
Categories=Office;Finance;Utility;
Keywords=schoolie;bus;receipt;budget;cost;
StartupNotify=true
StartupWMClass=schoolie-tracker
X-GNOME-UsesNotifications=true
"

# --- User app menu (always) ---
APPS_DIR="$DATA_HOME/applications"
mkdir -p "$APPS_DIR"
USER_DESKTOP_FILE="$APPS_DIR/${APP_ID}.desktop"
printf '%s\n' "$DESKTOP_CONTENT" >"$USER_DESKTOP_FILE"
chmod +x "$USER_DESKTOP_FILE"

# --- System app menu when possible ---
SYSTEM_APPS="/usr/share/applications"
if [[ -d "$SYSTEM_APPS" ]]; then
  if [[ -w "$SYSTEM_APPS" ]]; then
    printf '%s\n' "$DESKTOP_CONTENT" >"$SYSTEM_APPS/${APP_ID}.desktop"
    chmod +x "$SYSTEM_APPS/${APP_ID}.desktop"
    echo "System app menu: $SYSTEM_APPS/${APP_ID}.desktop"
  elif command -v sudo >/dev/null 2>&1; then
    TMP="$(mktemp)"
    printf '%s\n' "$DESKTOP_CONTENT" >"$TMP"
    sudo cp "$TMP" "$SYSTEM_APPS/${APP_ID}.desktop" 2>/dev/null && \
      sudo chmod +x "$SYSTEM_APPS/${APP_ID}.desktop" 2>/dev/null && \
      echo "System app menu: $SYSTEM_APPS/${APP_ID}.desktop" || true
    rm -f "$TMP"
  fi
fi

# xdg-desktop-menu install (registers with the desktop environment)
if command -v xdg-desktop-menu >/dev/null 2>&1; then
  xdg-desktop-menu install --novendor "$USER_DESKTOP_FILE" 2>/dev/null || true
fi

# --- Desktop shortcut ---
for DESK in "$HOME/Desktop" "$HOME/desktop" "/root/Desktop"; do
  if mkdir -p "$DESK" 2>/dev/null; then
    DEST="$DESK/Schoolie Cost Tracker.desktop"
    printf '%s\n' "$DESKTOP_CONTENT" >"$DEST"
    chmod +x "$DEST"
    if command -v gio >/dev/null 2>&1; then
      gio set "$DEST" metadata::trusted true 2>/dev/null || true
    fi
    echo "Desktop icon: $DEST"
    break
  fi
done

# Refresh caches so the logo appears immediately
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$DATA_HOME/icons/hicolor" 2>/dev/null || true
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" 2>/dev/null || true
  update-desktop-database /usr/share/applications 2>/dev/null || true
fi

echo ""
echo "✓ Schoolie is installed in the app menu / launcher"
echo "  Menu entry: $USER_DESKTOP_FILE"
echo "  Logo:       $DATA_HOME/icons/hicolor/512x512/apps/${ICON_NAME}.png"
echo "  Start:      $START"
echo ""
echo "Open your applications tray/menu and click “Schoolie Cost Tracker”."
echo "When the app is running, the bus icon also stays in the system tray"
echo "(notification area) — click it to show or hide Schoolie."

#!/usr/bin/env bash
# Install Schoolie so it shows in the app menu / launcher for every user.
# Usage: npm run app:icon
#        sudo bash scripts/install-desktop-launcher.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$ROOT"

START="$ROOT/scripts/start-schoolie-app.sh"
ICON_SRC="$ROOT/public/pwa-512.png"
ICON_NAME="schoolie-tracker"
APP_ID="schoolie-tracker"
ICON_FILE="/usr/share/pixmaps/${ICON_NAME}.png"
# Absolute icon path so the logo always shows (theme cache is flaky)
ICON_ABS="$ICON_FILE"

chmod +x \
  "$START" \
  "$ROOT/scripts/run-desktop.sh" \
  "$ROOT/scripts/install-desktop-launcher.sh" \
  2>/dev/null || true

if [[ ! -f "$ICON_SRC" ]]; then
  echo "Missing icon: $ICON_SRC" >&2
  exit 1
fi

if [[ ! -f dist/index.html ]]; then
  echo "Building Schoolie…"
  npm run build
fi

# Stable launch command on PATH
mkdir -p /usr/local/bin 2>/dev/null || true
cat > /usr/local/bin/schoolie <<EOF
#!/usr/bin/env bash
exec "$START" "\$@"
EOF
chmod +x /usr/local/bin/schoolie
echo "Command: /usr/local/bin/schoolie"

# System icon (absolute path — always works)
mkdir -p /usr/share/pixmaps 2>/dev/null || true
cp -f "$ICON_SRC" "$ICON_ABS"
for size in 48 64 128 192 256 512; do
  d="/usr/share/icons/hicolor/${size}x${size}/apps"
  mkdir -p "$d" 2>/dev/null || true
  cp -f "$ICON_SRC" "$d/${ICON_NAME}.png" 2>/dev/null || true
done

write_desktop() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")" 2>/dev/null || true
  cat >"$dest" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Schoolie Cost Tracker
GenericName=Schoolie
Comment=Track schoolie conversion costs — free on-device receipt scans
Exec=/usr/local/bin/schoolie
TryExec=/usr/local/bin/schoolie
Icon=${ICON_ABS}
Path=${ROOT}
Terminal=false
Categories=Office;Finance;Utility;Education;
Keywords=schoolie;bus;receipt;budget;cost;tracker;
StartupNotify=true
StartupWMClass=schoolie-tracker
X-GNOME-UsesNotifications=true
EOF
  chmod +x "$dest" 2>/dev/null || true
  echo "Installed: $dest"
}

# System-wide applications menu
write_desktop "/usr/share/applications/${APP_ID}.desktop"

# Flatpak-style / local for root
write_desktop "/root/.local/share/applications/${APP_ID}.desktop"

# Every user home we can find (e.g. ubuntu)
for home in /root /home/*; do
  [[ -d "$home" ]] || continue
  user="$(basename "$home")"
  [[ "$user" == "*" ]] && continue

  write_desktop "$home/.local/share/applications/${APP_ID}.desktop"

  # Per-user icons
  for size in 48 128 256 512; do
    d="$home/.local/share/icons/hicolor/${size}x${size}/apps"
    mkdir -p "$d" 2>/dev/null || true
    cp -f "$ICON_SRC" "$d/${ICON_NAME}.png" 2>/dev/null || true
  done
  mkdir -p "$home/.local/share/pixmaps" 2>/dev/null || true
  cp -f "$ICON_SRC" "$home/.local/share/pixmaps/${ICON_NAME}.png" 2>/dev/null || true

  # Desktop shortcut
  for DESK in "$home/Desktop" "$home/desktop"; do
    mkdir -p "$DESK" 2>/dev/null || true
    if [[ -d "$DESK" ]]; then
      dest="$DESK/Schoolie Cost Tracker.desktop"
      write_desktop "$dest"
      # Trust for GNOME
      if command -v gio >/dev/null 2>&1; then
        sudo -u "$user" gio set "$dest" metadata::trusted true 2>/dev/null || \
          gio set "$dest" metadata::trusted true 2>/dev/null || true
      fi
      # KDE / some DEs
      chmod a+x "$dest" 2>/dev/null || true
    fi
  done

  # Fix ownership for non-root homes
  if [[ "$home" != /root && -d "$home" ]]; then
    uid="$(stat -c %u "$home" 2>/dev/null || echo 0)"
    gid="$(stat -c %g "$home" 2>/dev/null || echo 0)"
    chown -R "$uid:$gid" \
      "$home/.local/share/applications/${APP_ID}.desktop" \
      "$home/.local/share/icons" \
      "$home/.local/share/pixmaps" \
      "$home/Desktop/Schoolie Cost Tracker.desktop" \
      "$home/desktop/Schoolie Cost Tracker.desktop" \
      2>/dev/null || true
  fi
done

# Register with desktop environments
if command -v xdg-desktop-menu >/dev/null 2>&1; then
  xdg-desktop-menu forceupdate 2>/dev/null || true
  xdg-desktop-menu install --novendor \
    "/usr/share/applications/${APP_ID}.desktop" 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications 2>/dev/null || true
  update-desktop-database /root/.local/share/applications 2>/dev/null || true
  for home in /home/*; do
    [[ -d "$home/.local/share/applications" ]] || continue
    update-desktop-database "$home/.local/share/applications" 2>/dev/null || true
  done
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi

# Copy logo next to desktop files as Schoolie.png (some file managers show this)
for DESK in /root/Desktop /home/*/Desktop; do
  [[ -d "$DESK" ]] || continue
  cp -f "$ICON_SRC" "$DESK/Schoolie.png" 2>/dev/null || true
done

echo ""
echo "========================================"
echo "  Schoolie Cost Tracker is installed"
echo "========================================"
echo ""
echo "  App menu name:  Schoolie Cost Tracker"
echo "  Terminal:       schoolie"
echo "  Desktop:        Schoolie Cost Tracker.desktop"
echo "  Icon file:      $ICON_ABS"
echo ""
echo "Open your applications menu and search for “Schoolie”."
echo "Or run:  schoolie"
echo ""

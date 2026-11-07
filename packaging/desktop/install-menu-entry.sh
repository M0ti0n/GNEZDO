#!/bin/sh
# Adds GNEZDO to the applications menu of this user (and the desktop, if there is one).
# Run it again after moving the GNEZDO folder. Remove: rm ~/.local/share/applications/gnezdo.desktop
set -e
here=$(dirname "$(readlink -f "$0")")
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$apps"
entry="$apps/gnezdo.desktop"
cat > "$entry" <<DESKTOP
[Desktop Entry]
Type=Application
Name=GNEZDO
Comment=Laser nesting
Exec="$here/gnezdo"
Icon=$here/gnezdo.png
Terminal=false
Categories=Graphics;Engineering;
StartupWMClass=GNEZDO
DESKTOP
chmod +x "$entry"
desk=$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")
if [ -d "$desk" ]; then
  cp "$entry" "$desk/gnezdo.desktop"
  chmod +x "$desk/gnezdo.desktop"
  gio set "$desk/gnezdo.desktop" metadata::trusted true 2>/dev/null || true
fi
echo "GNEZDO added to the applications menu ($entry)."

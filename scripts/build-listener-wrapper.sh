#!/bin/bash
# Build the iMessage listener as a minimal .app BUNDLE.
#
# Why an app bundle: macOS Full Disk Access does not reliably persist for bare
# command-line binaries (the entry appears then "disappears"/won't toggle).
# TCC treats .app bundles as first-class — the FDA grant sticks. launchd runs
# the executable INSIDE the bundle, which inherits the app's FDA, and that
# executable spawns the current node (so node upgrades never break the grant).
#
# Grant Full Disk Access to ~/Applications/JusticeListener.app once.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/justice-imessage-listener-wrapper.c"
APP="$HOME/Applications/JusticeListener.app"
MACOS="$APP/Contents/MacOS"
EXE="$MACOS/JusticeListener"
PLIST="$APP/Contents/Info.plist"

rm -rf "$APP"
mkdir -p "$MACOS"

clang -O2 -o "$EXE" "$SRC"

cat > "$PLIST" <<'PL'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>JusticeListener</string>
  <key>CFBundleIdentifier</key>
  <string>ai.wolflaw.justice.imessage-listener</string>
  <key>CFBundleName</key>
  <string>JusticeListener</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSUIElement</key>
  <true/>
  <key>LSBackgroundOnly</key>
  <true/>
</dict>
</plist>
PL

# Ad-hoc sign the whole bundle (deep) so it has a stable TCC identity.
codesign -s - --force --deep "$APP"

echo "Built app bundle: $APP"
echo "Executable: $EXE"
codesign -dv "$APP" 2>&1 | grep -E 'Identifier|Signature' || true

#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
xcrun swift build --product HermiDesktop --disable-sandbox
APP="$PWD/.preview/Hermi Preview.app"
BUILD_DIR="$(xcrun swift build --show-bin-path --disable-sandbox)"
PREVIEW_ID="tech.hermi.designpreview.mac.preview$$"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BUILD_DIR/HermiDesktop" "$APP/Contents/MacOS/HermiDesktop"
rm -rf "$APP/Contents/HermiPreview_HermiDesign.bundle" "$APP/Contents/Resources/HermiPreview_HermiDesign.bundle"
cp -R "$BUILD_DIR/HermiPreview_HermiDesign.bundle" "$APP/Contents/Resources/"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>HermiDesktop</string>
<key>CFBundleIdentifier</key><string>$PREVIEW_ID</string>
<key>CFBundleName</key><string>Hermi Preview</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
if [ "${1:-}" != "--build-only" ]; then
  PREVIEW_APP="/private/tmp/hermi-preview-$$.app"
  cp -R "$APP" "$PREVIEW_APP"
  if ! open -na "$PREVIEW_APP" --args "$@" 2>/dev/null; then
    sleep 1
    open -na "$PREVIEW_APP" --args "$@"
  fi
fi

#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
xcrun swift build --product HermiDesktop --disable-sandbox
APP="$PWD/.preview/Hermi Preview.app"
mkdir -p "$APP/Contents/MacOS"
cp .build/debug/HermiDesktop "$APP/Contents/MacOS/HermiDesktop"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>HermiDesktop</string>
<key>CFBundleIdentifier</key><string>tech.hermi.designpreview.mac</string>
<key>CFBundleName</key><string>Hermi Preview</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
if [ "${1:-}" != "--build-only" ]; then open "$APP"; fi

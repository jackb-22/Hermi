#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
CAIRN_BUILD_PATH="${CAIRN_BUILD_PATH:-$PWD/.build}"
swift build --scratch-path "$CAIRN_BUILD_PATH" --disable-sandbox
APP="$PWD/.preview/Cairn Preview.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$CAIRN_BUILD_PATH/debug/CairnPreview" "$APP/Contents/MacOS/CairnPreview"
cp -R "$CAIRN_BUILD_PATH/debug/Cairn_CairnKit.bundle" "$APP/Contents/Resources/"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>CairnPreview</string><key>CFBundleIdentifier</key><string>tech.cairn.preview</string><key>CFBundleName</key><string>Cairn Preview</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/><key>NSCameraUsageDescription</key><string>Preview Cairn's in-app capture.</string><key>NSMicrophoneUsageDescription</key><string>Record ambient sound with a capture.</string><key>NSLocationUsageDescription</key><string>Verify check-ins during an outing.</string></dict></plist>
PLIST
if [ "${1:-}" != "--build-only" ]; then open "$APP"; fi

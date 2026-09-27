#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
DEVICE_ID="${HERMI_SIMULATOR_ID:-$(xcrun simctl list devices available -j | python3 -c '
import sys,json
devices=[d for group in json.load(sys.stdin)["devices"].values() for d in group if "iPhone" in d["name"]]
if not devices: sys.exit("No available iPhone simulator. Install an iOS runtime in Xcode Settings > Components.")
devices.sort(key=lambda d: (d["state"] == "Booted", "17 Pro" in d["name"], d["name"]), reverse=True)
print(devices[0]["udid"])
')}"
mkdir -p .build
xcodebuild -project HermiPreview.xcodeproj -scheme HermiPreview -configuration Debug \
  -destination "platform=iOS Simulator,id=$DEVICE_ID" -derivedDataPath .build/xcode \
  CODE_SIGNING_ALLOWED=NO build > .build/simulator-build.log 2>&1 || {
    tail -80 .build/simulator-build.log
    exit 1
  }
if [ "${1:-}" = "--build-only" ]; then exit 0; fi
# Boot can report an already-booted device; bootstatus is the readiness check.
xcrun simctl boot "$DEVICE_ID" 2>/dev/null || true
xcrun simctl bootstatus "$DEVICE_ID" -b
xcrun simctl install "$DEVICE_ID" .build/xcode/Build/Products/Debug-iphonesimulator/HermiPreview.app
open -a Simulator
xcrun simctl launch "$DEVICE_ID" tech.hermi.designpreview

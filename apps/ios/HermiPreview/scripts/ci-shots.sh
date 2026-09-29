#!/bin/sh
# CI (macOS runner): build HermiPreview once, then screenshot every scenario in shot-scenarios.txt on each device.
#   sh scripts/ci-shots.sh <out-dir> [only-regex]
# Devices: the smallest, a standard and the largest available iPhone. Status bar is frozen for stable images.
set -eu
cd "$(dirname "$0")/.."
OUT="$1"; ONLY="${2:-.}"
mkdir -p "$OUT" .build

DEVICES=$(xcrun simctl list devices available -j | python3 -c '
import sys, json, re
ds = [d for g, group in json.load(sys.stdin)["devices"].items() if "iOS" in g for d in group if d["name"].startswith("iPhone")]
def pick(pred):
    for d in ds:
        if pred(d["name"]): return d
se = pick(lambda n: "SE" in n) or pick(lambda n: re.search(r"iPhone \d+e?$", n))
std = pick(lambda n: re.fullmatch(r"iPhone \d+", n) is not None)
big = pick(lambda n: "Pro Max" in n) or pick(lambda n: "Plus" in n)
seen = []
for d in (se, std, big):
    if d and d["udid"] not in [s["udid"] for s in seen]: seen.append(d)
print("\n".join(d["udid"] + "|" + d["name"].replace(" ", "-").replace("(", "").replace(")", "") for d in seen))
')
echo "devices:"; echo "$DEVICES"
FIRST=$(echo "$DEVICES" | head -1 | cut -d"|" -f1)

echo "▶ build"
xcodebuild -project HermiPreview.xcodeproj -scheme HermiPreview -configuration Debug \
  -destination "platform=iOS Simulator,id=$FIRST" -derivedDataPath .build/xcode \
  CODE_SIGNING_ALLOWED=NO build > "$OUT/build.log" 2>&1 || { grep -E "error:" "$OUT/build.log" | head -40; tail -60 "$OUT/build.log"; exit 1; }
APP=.build/xcode/Build/Products/Debug-iphonesimulator/HermiPreview.app

echo "$DEVICES" | while IFS="|" read -r UDID NAME; do
  [ -n "$UDID" ] || continue
  xcrun simctl boot "$UDID" 2>/dev/null </dev/null || true
  xcrun simctl bootstatus "$UDID" -b > /dev/null </dev/null
  xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 </dev/null || true
  xcrun simctl install "$UDID" "$APP" </dev/null
  grep -v '^#' scripts/shot-scenarios.txt | grep -v '^$' | while IFS="|" read -r SCENARIO ARGS; do
    echo "$SCENARIO" | grep -Eq "$ONLY" || continue
    CONTENT_SIZE=""
    case "$ARGS" in *--content-size=*) CONTENT_SIZE=$(echo "$ARGS" | sed 's/.*--content-size=\([^ ]*\).*/\1/'); ARGS=$(echo "$ARGS" | sed 's/--content-size=[^ ]*//') ;; esac
    xcrun simctl ui "$UDID" content_size "${CONTENT_SIZE:-large}" 2>/dev/null </dev/null || true
    xcrun simctl terminate "$UDID" tech.hermi.designpreview 2>/dev/null </dev/null || true
    # shellcheck disable=SC2086
    xcrun simctl launch "$UDID" tech.hermi.designpreview $ARGS > /dev/null </dev/null
    sleep "${SHOT_WAIT:-6}"
    xcrun simctl io "$UDID" screenshot --type=png "$OUT/$SCENARIO@$NAME.png" > /dev/null 2>&1 </dev/null
    echo "  ✓ $SCENARIO @ $NAME"
  done
  xcrun simctl shutdown "$UDID" </dev/null || true
done

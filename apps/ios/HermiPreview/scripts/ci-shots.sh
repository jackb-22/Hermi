#!/bin/sh
# CI (macOS runner): build HermiPreview once, then screenshot every scenario in shot-scenarios.txt on each device.
#   sh scripts/ci-shots.sh <out-dir> [only-regex]
# Devices: the smallest, a standard and the largest available iPhone. Status bar is frozen for stable images.
set -eu
cd "$(dirname "$0")/.."
OUT="$1"; ONLY="${2:-.}"
mkdir -p "$OUT" .build

# The narrowest phone (375 pt) catches clipping; add an iPhone SE on the newest runtime when the image has none.
RUNTIME=$(xcrun simctl list runtimes available -j | python3 -c '
import sys, json
rs = [r for r in json.load(sys.stdin)["runtimes"] if r["platform"] == "iOS"]
print(max(rs, key=lambda r: [int(x) for x in r["version"].split(".")])["identifier"])
')
echo "runtime $RUNTIME"
if ! xcrun simctl list devices available -j | python3 -c "
import sys, json
sys.exit(0 if any('SE' in d['name'] for d in json.load(sys.stdin)['devices'].get('$RUNTIME', [])) else 1)"; then
  xcrun simctl create "iPhone SE (3rd generation)" com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation "$RUNTIME" \
    > /dev/null 2>&1 || echo "  (could not add an iPhone SE on $RUNTIME)"
fi
# Only the newest runtime: the app links Swift overlays of the SDK (e.g. libswiftWebKit) that older runtimes lack.
DEVICES=$(xcrun simctl list devices available -j | python3 -c '
import sys, json, re
ds = [d for d in json.load(sys.stdin)["devices"].get(sys.argv[1], []) if d["name"].startswith("iPhone")]
def pick(pred):
    for d in ds:
        if pred(d["name"]): return d
small = pick(lambda n: "SE" in n) or pick(lambda n: "mini" in n) or pick(lambda n: re.fullmatch(r"iPhone \d+e", n))
std = pick(lambda n: re.fullmatch(r"iPhone \d+", n) is not None)
big = pick(lambda n: "Pro Max" in n) or pick(lambda n: "Plus" in n or "Air" in n)
seen = []
for d in (small, std, big):
    if d and d["udid"] not in [s["udid"] for s in seen]: seen.append(d)
print("\n".join(d["udid"] + "|" + d["name"].replace(" ", "-").replace("(", "").replace(")", "") for d in seen))
' "$RUNTIME")
echo "devices:"; echo "$DEVICES"
FIRST=$(echo "$DEVICES" | head -1 | cut -d"|" -f1)

echo "▶ build"
xcodebuild -project HermiPreview.xcodeproj -scheme HermiPreview -configuration Debug \
  -destination "platform=iOS Simulator,id=$FIRST" -derivedDataPath .build/xcode \
  CODE_SIGNING_ALLOWED=NO build > "$OUT/build.log" 2>&1 || { grep -E "error:" "$OUT/build.log" | head -40; tail -60 "$OUT/build.log"; exit 1; }
APP=.build/xcode/Build/Products/Debug-iphonesimulator/HermiPreview.app
# The AI fixtures are New York times; show them as New York times.
export SIMCTL_CHILD_TZ=America/New_York

# One device at a time: booting several simulators at once stalls the hosted runner.
shoot_device() { # udid name
  UDID="$1"; NAME="$2"; MARK="$OUT/.mark-$NAME"
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
    touch "$MARK"
    # shellcheck disable=SC2086
    xcrun simctl launch "$UDID" tech.hermi.designpreview $ARGS > /dev/null </dev/null || echo "  launch reported a failure"
    sleep "${SHOT_WAIT:-6}"
    xcrun simctl io "$UDID" screenshot --type=png "$OUT/$SCENARIO@$NAME.png" > /dev/null 2>&1 </dev/null
    if xcrun simctl spawn "$UDID" launchctl list </dev/null 2>/dev/null | grep -q tech.hermi.designpreview; then
      echo "  ✓ $SCENARIO @ $NAME"
    else
      # Crashed: keep the crash report and the app's recent log next to the screenshot.
      echo "  ✗ $SCENARIO @ $NAME: not running (crash report and log saved)"
      find "$HOME/Library/Logs/DiagnosticReports" -name 'HermiPreview*' -newer "$MARK" \
        -exec cp {} "$OUT/crash-$SCENARIO@$NAME.ips" \; 2>/dev/null || true
      xcrun simctl spawn "$UDID" log show --last 2m --style compact \
        --predicate 'process == "HermiPreview" OR eventMessage CONTAINS "designpreview"' </dev/null \
        2>/dev/null | tail -150 > "$OUT/log-$SCENARIO@$NAME.txt" || true
      echo "$SCENARIO@$NAME" >> "$OUT/crashed.txt"
    fi
  done
  xcrun simctl shutdown "$UDID" </dev/null || true
  rm -f "$MARK"
}
echo "$DEVICES" > "$OUT/.devices"
while IFS="|" read -r UDID NAME; do
  [ -n "$UDID" ] && shoot_device "$UDID" "$NAME" </dev/null
done < "$OUT/.devices"
rm -f "$OUT/.devices"
if [ -f "$OUT/crashed.txt" ]; then echo "crashed:"; cat "$OUT/crashed.txt"; exit 3; fi

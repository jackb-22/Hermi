#!/bin/sh
# Try Hermi in the iOS Simulator: builds the app and opens it signed in to the live demo backend.
#
#   sh scripts/judge-sim.sh           # one simulator, signed in as @ava
#   sh scripts/judge-sim.sh --two     # plus a second simulator as @ben (to join ava's plan, see the README)
#   sh scripts/judge-sim.sh --keep    # keep the app's data from an earlier run (default: fresh install)
#   sh scripts/judge-sim.sh --two --as judge1,judge2   # your own account pair (see Accounts in the README)
#
# Needs a Mac with Xcode (16 or later) and an iOS Simulator runtime (Xcode → Settings → Components).
# It asks for the demo token from our submission's testing instructions (or set HERMI_DEV_TOKEN).
set -eu
cd "$(dirname "$0")/.."
two=0; keep=0; first_user=ava; second_user=ben; want_as=0
for arg in "$@"; do
  if [ "$want_as" = 1 ]; then
    first_user=$(echo "$arg" | cut -d, -f1); second_user=$(echo "$arg" | cut -s -d, -f2)
    [ -n "$second_user" ] || second_user=ben
    want_as=0; continue
  fi
  case "$arg" in
    --two) two=1 ;;
    --keep) keep=1 ;;
    --as) want_as=1 ;;
    *) echo "unknown option: $arg"; exit 2 ;;
  esac
done
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
command -v xcrun >/dev/null 2>&1 || { echo "Xcode is required (App Store → Xcode)."; exit 1; }

if [ -z "${HERMI_DEV_TOKEN:-}" ]; then
  printf "Demo token (from the submission's testing instructions): "
  stty -echo 2>/dev/null || true; read -r HERMI_DEV_TOKEN; stty echo 2>/dev/null || true; echo
fi
[ -n "$HERMI_DEV_TOKEN" ] || { echo "A demo token is needed to sign in."; exit 1; }

# Two different available iPhone simulators (booted ones first).
DEVICES=$(xcrun simctl list devices available -j | python3 -c '
import sys, json
devices = [d for group in json.load(sys.stdin)["devices"].values() for d in group if "iPhone" in d["name"]]
if not devices: sys.exit("No iPhone simulator found. Install an iOS runtime in Xcode → Settings → Components.")
devices.sort(key=lambda d: (d["state"] == "Booted", "Pro" in d["name"], d["name"]), reverse=True)
print(" ".join(d["udid"] for d in devices[:2]))
')
FIRST=$(echo "$DEVICES" | cut -d" " -f1)
SECOND=$(echo "$DEVICES" | cut -s -d" " -f2)

launch() { # udid username
  xcrun simctl boot "$1" 2>/dev/null || true
  if [ "$keep" = 0 ]; then xcrun simctl uninstall "$1" tech.hermi.designpreview 2>/dev/null || true; fi
  echo "▶ Hermi on $(xcrun simctl list devices | grep "$1" | sed 's/ (.*//;s/^ *//') as @$2"
  HERMI_SIMULATOR_ID="$1" SIMCTL_CHILD_HERMI_DEV_TOKEN="$HERMI_DEV_TOKEN" SIMCTL_CHILD_HERMI_USERNAME="$2" \
    sh apps/ios/HermiPreview/scripts/simulator-preview.sh
}

launch "$FIRST" "$first_user"
if [ "$two" = 1 ]; then
  if [ -z "$SECOND" ]; then echo "Only one iPhone simulator is installed; add another in Xcode → Window → Devices and Simulators."
  else launch "$SECOND" "$second_user"; fi
fi
echo "✔ Hermi is open. Follow “Try Hermi” in README.md."

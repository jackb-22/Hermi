#!/bin/sh
# One-shot Mac test loop: pull, package tests, map bridge check, then build and launch in the Simulator.
# Stops at the first failure and prints its log.
#
#   sh apps/ios/HermiPreview/scripts/check.sh                # pull + tests + launch
#   sh apps/ios/HermiPreview/scripts/check.sh --no-pull      # skip git pull
#   sh apps/ios/HermiPreview/scripts/check.sh --skip-tests   # just pull + launch
#   HERMI_API_BASE=https://….trycloudflare.com HERMI_DEV_TOKEN=… sh apps/ios/HermiPreview/scripts/check.sh
#     (prefills Settings → Server when nothing is saved there yet)
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

pull=1; tests=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) pull=0 ;;
    --skip-tests) tests=0 ;;
    *) echo "unknown option: $arg"; exit 2 ;;
  esac
done
mkdir -p .build

if [ "$pull" = 1 ]; then
  echo "▶ git pull ($(git rev-parse --abbrev-ref HEAD))"
  git pull --ff-only
  git log --oneline -1
fi

if [ "$tests" = 1 ]; then
  echo "▶ swift test"
  if ! xcrun swift test --disable-sandbox > .build/swift-test.log 2>&1; then
    grep -E "error:|failed|XCTAssert" .build/swift-test.log | head -40
    echo "--- last lines of .build/swift-test.log ---"; tail -40 .build/swift-test.log
    exit 1
  fi
  grep -E "Executed [0-9]+ tests" .build/swift-test.log | tail -1

  echo "▶ map bridge check"
  if command -v node > /dev/null 2>&1; then
    node scripts/test-map-bridge.cjs
  else
    echo "  (node not installed; skipped)"
  fi
fi

echo "▶ Simulator build + launch"
if [ -n "${HERMI_API_BASE:-}" ]; then export SIMCTL_CHILD_HERMI_API_BASE="$HERMI_API_BASE"; fi
if [ -n "${HERMI_DEV_TOKEN:-}" ]; then export SIMCTL_CHILD_HERMI_DEV_TOKEN="$HERMI_DEV_TOKEN"; fi
sh scripts/simulator-preview.sh
echo "✔ launched. Run the current step's checklist in INTEGRATION.md."

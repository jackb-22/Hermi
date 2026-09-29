#!/bin/sh
# iOS feedback loop from Linux: push this branch, wait for the `ios` workflow on this commit, download its
# screenshots, contact sheets and test log into .ci-shots/<sha>/.
#
#   scripts/ios-ci.sh                     # push HEAD; the push triggers the workflow (all scenarios + tests)
#   scripts/ios-ci.sh --only 'ai-'        # dispatch a run shooting only matching scenarios (no push needed)
#   scripts/ios-ci.sh --only 'ai-' --no-tests
set -eu
cd "$(dirname "$0")/.."
only=""; tests=true
while [ $# -gt 0 ]; do
  case "$1" in
    --only) only="$2"; shift ;;
    --no-tests) tests=false ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
  shift
done
branch=$(git rev-parse --abbrev-ref HEAD)
sha=$(git rev-parse HEAD); short=$(git rev-parse --short HEAD)
git push -q -u origin "HEAD:$branch" 2>&1 | grep -v '^remote:' || true

if [ -n "$only" ]; then
  gh workflow run ios.yml --ref "$branch" -f only="$only" -f tests="$tests"
  event=workflow_dispatch
else
  event=push
fi

echo "▶ waiting for the ios run on $short ($event)"
run=""
for _ in $(seq 1 30); do
  run=$(gh run list --workflow ios.yml --branch "$branch" --event "$event" --limit 10 \
    --json databaseId,headSha --jq "map(select(.headSha == \"$sha\"))[0].databaseId // empty")
  [ -n "$run" ] && break
  sleep 4
done
[ -n "$run" ] || { echo "no run found (did the push touch apps/ios/**?). Try --only ."; exit 1; }
echo "  run $run: $(gh run view "$run" --json url --jq .url)"

status=0
gh run watch "$run" --interval 15 --exit-status > /dev/null 2>&1 || status=$?
out=".ci-shots/$short"
rm -rf "$out"; mkdir -p "$out"
gh run download "$run" -D "$out" 2>/dev/null || true
if [ "$status" != 0 ]; then
  echo "✗ run failed; failing steps:"
  gh run view "$run" --log-failed 2>/dev/null | tail -60
fi
find "$out" -name 'sheet*.png' | sort
find "$out" -name 'swift-test.log' -exec sh -c 'grep -E "Executed|error:|failed" "$1" | tail -8' _ {} \;
echo "shots: $(find "$out" -name '*@*.png' ! -name 'sheet*' | wc -l) in $out"
exit "$status"

#!/bin/sh
# iOS feedback loop from Linux: push this branch, wait for the `ios` workflow on this commit, download its
# screenshots, contact sheets and test log into .ci-shots/<sha>/.
#
#   scripts/ios-ci.sh            # push HEAD (the push triggers the run), wait, download
#   scripts/ios-ci.sh --rerun    # run the workflow again on HEAD (e.g. a flaky simulator)
#
# A commit whose message has a line `shots: <regex>` shoots only matching scenarios, and `tests: skip` skips
# swift test (see .github/workflows/ios.yml). The workflow only lives on this branch, so runs are found by commit.
set -eu
cd "$(dirname "$0")/.."
rerun=0
for arg in "$@"; do
  case "$arg" in
    --rerun) rerun=1 ;;
    *) echo "unknown option: $arg"; exit 2 ;;
  esac
done
branch=$(git rev-parse --abbrev-ref HEAD)
sha=$(git rev-parse HEAD); short=$(git rev-parse --short HEAD)
git push -q -u origin "HEAD:$branch" 2>&1 | grep -v '^remote:' || true

find_run() {
  gh run list --branch "$branch" --commit "$sha" --limit 10 --json databaseId,workflowName \
    --jq 'map(select(.workflowName == "ios"))[0].databaseId // empty'
}
echo "▶ waiting for the ios run on $short"
run=""
for _ in $(seq 1 30); do
  run=$(find_run || true)
  [ -n "$run" ] && break
  sleep 4
done
[ -n "$run" ] || { echo "no ios run for $short (the push must touch apps/ios/** or the workflow)"; exit 1; }
if [ "$rerun" = 1 ]; then gh run rerun "$run"; sleep 5; fi
echo "  run $run: $(gh run view "$run" --json url --jq .url)"

status=0
gh run watch "$run" --interval 15 --exit-status > /dev/null 2>&1 || status=$?
out=".ci-shots/$short"
rm -rf "$out"; mkdir -p "$out"
gh run download "$run" -D "$out" 2>/dev/null || true
if [ "$status" != 0 ]; then
  echo "✗ run failed; failing steps:"
  gh run view "$run" --log-failed 2>/dev/null | tail -80
fi
find "$out" -name 'sheet*.png' | sort
find "$out" -name 'swift-test.log' -exec sh -c 'grep -E "Executed|error:|failed" "$1" | tail -8' _ {} \;
echo "shots: $(find "$out" -name '*@*.png' ! -name 'sheet*' | wc -l) in $out"
exit "$status"

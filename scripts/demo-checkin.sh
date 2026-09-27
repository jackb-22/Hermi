#!/usr/bin/env bash
# Checks a demo user in at a place near Columbia through a dev venue tag (the NFC stand-in), so the
# Social map has a fresh friend check-in: it blinks for about an hour and shows for 3 hours.
# Needs scripts/demo-up.sh running.
#
#   scripts/demo-checkin.sh jenny "Book Culture"
#   scripts/demo-checkin.sh jenny "Book Culture" --dry-run   # find the place, check in nothing
#
# A place can only be checked into once per 6 hours per user. Never use Demo Hall: minting a dev tag
# replaces the place's registered venue tag, and Demo Hall's real NFC tag must keep working.
set -euo pipefail
cd "$(dirname "$0")/.."
user=${1:?usage: demo-checkin.sh <username> "<place name>" [--dry-run]}
query=${2:?usage: demo-checkin.sh <username> "<place name>" [--dry-run]}
dry=${3:-}
shopt -s nocasematch
if [[ "$query" == *"demo hall"* ]]; then echo "Refusing Demo Hall: its real venue tag would be replaced."; exit 1; fi
shopt -u nocasematch

BASE=$(cat .demo/url)
DEV=$(grep -E '^DEV_TOKEN=' .env.demo | cut -d= -f2-)
TOKEN=$(curl -sf -X POST "$BASE/v1/auth/dev" -H 'content-type: application/json' -H "x-dev-token: $DEV" \
  -d "{\"username\":\"$user\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

# Morningside Heights / Columbia area, all categories.
PLACE=$(curl -sf "$BASE/v1/places?bbox=-73.9750,40.7950,-73.9450,40.8200&cat=all&limit=100" -H "authorization: Bearer $TOKEN" \
  | QUERY="$query" python3 -c '
import json, os, sys
q = os.environ["QUERY"].lower()
items = [p for p in json.load(sys.stdin)["items"] if q in p["name"].lower() and "demo hall" not in p["name"].lower()]
if not items: sys.exit("No place near Columbia matches that name.")
p = items[0]
print(json.dumps({"id": p["id"], "name": p["name"], "lat": p["loc"]["lat"], "lng": p["loc"]["lng"]}))')
NAME=$(echo "$PLACE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
echo "@$user → $NAME"
if [ "$dry" = "--dry-run" ]; then echo "(dry run: no check-in)"; exit 0; fi

TAG_URL=$(curl -sf -X POST "$BASE/v1/dev/tags" -H "authorization: Bearer $TOKEN" -H "x-dev-token: $DEV" \
  -H 'content-type: application/json' \
  -d "$(echo "$PLACE" | python3 -c 'import json,sys; p=json.load(sys.stdin); print(json.dumps({"kind":"venue","placeId":p["id"],"bindToMe":False}))')" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["url"])')

BODY=$(echo "$PLACE" | TAG_URL="$TAG_URL" python3 -c '
import json, os, sys
p = json.load(sys.stdin)
print(json.dumps({"tier": "tag", "tagUrl": os.environ["TAG_URL"], "lat": p["lat"], "lng": p["lng"], "accuracy": 8}))')
curl -s -X POST "$BASE/v1/checkins" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$BODY" \
  | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "error" in d: sys.exit("Check-in failed: %s (%s)" % (d["error"]["message"], d["error"]["code"]))
print("checked in: +%d XP%s" % (d["xp"]["total"], " · first visit" if d.get("firstVisit") else ""))'

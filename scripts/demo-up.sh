#!/usr/bin/env bash
# Runs the backend on this laptop for the phones: RustFS for media, a public HTTPS tunnel, then the API with its
# worker in one process against the production databases in .env.demo. Ctrl-C stops everything.
#
#   scripts/demo-up.sh                                  # cloudflared quick tunnel (the URL changes every run)
#   NGROK_DOMAIN=<name>.ngrok-free.app scripts/demo-up.sh   # stable URL (ngrok's free static domain)
#
# The laptop must stay awake and online; this keeps it from sleeping while the server runs.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.demo ] || { echo "Missing .env.demo: copy .env.demo.example and fill it in."; exit 1; }
mkdir -p .demo
env_value() { grep -E "^$1=" .env.demo | head -1 | cut -d= -f2-; }
PORT=$(env_value PORT); PORT=${PORT:-3000}
DEV_TOKEN=$(env_value DEV_TOKEN)

echo "▶ media storage (RustFS)"
docker compose up -d s3 >/dev/null
for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:9000" && break; sleep 1; done

tunnel_pid=""
# Stops the tunnel and the server loop with it (everything this script started shares its process group).
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$tunnel_pid" ]; then kill "$tunnel_pid" 2>/dev/null || true; fi
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "▶ tunnel"
if [ -n "${NGROK_DOMAIN:-}" ]; then
  ngrok http --url="$NGROK_DOMAIN" "$PORT" --log=stdout >.demo/tunnel.log 2>&1 &
  tunnel_pid=$!
  URL="https://$NGROK_DOMAIN"
else
  cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >.demo/tunnel.log 2>&1 &
  tunnel_pid=$!
  URL=""
  for _ in $(seq 1 30); do
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' .demo/tunnel.log | head -1 || true)
    [ -n "$URL" ] && break
    sleep 1
  done
  [ -n "$URL" ] || { echo "cloudflared gave no URL; see .demo/tunnel.log"; exit 1; }
fi
export PUBLIC_BASE_URL="$URL"
echo "$URL" >.demo/url

cat <<EOF

  Hermi backend
  API        $URL
  Docs       $URL/docs      Health  $URL/health
  Dev token  x-dev-token: $DEV_TOKEN
  Sign in    POST $URL/v1/auth/dev  {"username":"jack"}  (or jenny) with the dev token header
  The app's API base URL must be set to $URL$( [ -z "${NGROK_DOMAIN:-}" ] && echo " (new on every run)" )

EOF

# API + worker in one process; restarted if it crashes, stopped by Ctrl-C (a clean exit).
ROOT=$(pwd)
run="cd '$ROOT/apps/api' && until pnpm exec tsx --env-file='$ROOT/.env.demo' src/server.ts; do echo 'server exited; restarting in 2 s'; sleep 2; done"
# In the background and waited on, so Ctrl-C or a kill of this script runs cleanup at once (bash holds traps
# until a foreground command finishes).
if command -v systemd-inhibit >/dev/null; then
  systemd-inhibit --what=sleep:idle:handle-lid-switch --who=hermi --why="demo backend running" bash -c "$run" &
else
  bash -c "$run" &
fi
wait $!

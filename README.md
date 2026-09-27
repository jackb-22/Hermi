# Incentivize the Physical

Monorepo: `apps/api` (Fastify API + worker, Lane B), `packages/shared` (zod contract, domain constants), `apps/mobile` (Expo app, Lane A).

## Backend dev loop (Linux)

```bash
cp .env.example .env
docker compose up -d          # mongo (atlas-local, supports $vectorSearch), timescaledb, rustfs (S3)
pnpm install
pnpm --filter @itp/api migrate
pnpm dev                      # http://localhost:3000/docs
pnpm test
```

Contract for the app: `CONTRACT.md` and live OpenAPI at `/openapi.json` (`/docs` for a UI).

## Demo data

```bash
pnpm --filter @itp/api exec tsx --env-file=../../.env scripts/import-overture.ts data/manhattan_places.geojsonseq   # places (once)
pnpm --filter @itp/api exec tsx --env-file=../../.env scripts/seed.ts --reset --demo maya,sam [--media-dir ./captures]
pnpm --filter @itp/api exec tsx scripts/simulate-walk.ts --base http://localhost:3000   # full quest over HTTP
pnpm --filter @itp/api exec tsx scripts/simulate-tap.ts --base http://localhost:3000    # two phones tapping tags
```

`--demo` takes the usernames of the demo phones' accounts (set them with `PATCH /me {username}` after signing in, then re-run).
Everything the seed writes is marked, so `--reset` removes exactly it.

## Content Credentials (C2PA)

Verified captures get a signed copy of the original with a C2PA manifest (in-app capture, place, time, check-in), linked from `/verify/:hash`. To enable signing, generate a demo signer once and put the two printed lines in `.env` (and the App Platform secrets):

```sh
apps/api/scripts/make-c2pa-cert.sh .c2pa   # writes .c2pa/ (gitignored), prints C2PA_CERT_PEM=… and C2PA_KEY_PEM=…
```

The root CA is ours, so viewers report the manifest as valid but from an untrusted signer. Without these keys, captures still post; the stamp falls back to the server-verified capture record.

## Demo backend on the laptop (no cloud hosting)

The phones reach this laptop through a public HTTPS tunnel. API and worker run in one process against the production databases; media live in RustFS and are served by the API (`/media/<key>`, byte ranges for video).

```bash
cp .env.demo.example .env.demo      # fill in: production MONGO_URI / TIGER_URL, keys, two `openssl rand -hex 32` secrets
scripts/demo-up.sh                  # prints the public URL, docs, health and the dev token; Ctrl-C stops everything
# stable URL instead of a new one each run: NGROK_DOMAIN=<name>.ngrok-free.app scripts/demo-up.sh
```

Once it is up (the URL is also in `.demo/url`), from `apps/api`:

```bash
URL=$(cat ../../.demo/url); TOKEN=$(grep ^DEV_TOKEN= ../../.env.demo | cut -d= -f2)
pnpm exec tsx --env-file=../../.env.demo scripts/seed.ts --reset --demo jack,jenny   # demo data (removes only earlier seed data)
pnpm exec tsx scripts/simulate-walk.ts --base $URL --dev-token $TOKEN                # full quest; ends "LOOP WORKS ✔"
pnpm exec tsx scripts/simulate-tap.ts --base $URL --dev-token $TOKEN                 # two phones tapping tags
```

Signing in on the phones (no Apple account yet): `POST $URL/v1/auth/dev {"username":"jack"}` with header `x-dev-token: $TOKEN`. Tag taps are simulated the same way: `POST /v1/dev/tags` mints a tag URL, `POST /v1/taps {url, lat, lng, accuracy}` reads it.

## Fallback: Google Cloud Run

Only if the laptop cannot host the demo. The same image and code; region next to Atlas and Tiger.

```bash
gcloud config set project <project>
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com storage.googleapis.com
gcloud storage buckets create gs://<bucket> --location=us-east4 --uniform-bucket-level-access
gcloud iam service-accounts create hermi-media
gcloud storage hmac create hermi-media@<project>.iam.gserviceaccount.com    # → S3_KEY / S3_SECRET
gcloud storage buckets add-iam-policy-binding gs://<bucket> --member=serviceAccount:hermi-media@<project>.iam.gserviceaccount.com --role=roles/storage.objectAdmin
# env.yaml (gitignored): the .env.demo values, plus
#   PUBLIC_BASE_URL: https://<service URL, printed by the first deploy>
#   S3_ENDPOINT: https://storage.googleapis.com   S3_REGION: auto   S3_BUCKET: <bucket>   S3_FORCE_PATH_STYLE: "1"
#   MEDIA_UPLOAD_MODE: direct   (Cloud Run caps request bodies at 32 MiB; phones PUT straight to Cloud Storage)
#   MEDIA_DELIVERY: api
gcloud run deploy hermi-api --source . --region us-east4 --port 8080 --env-vars-file env.yaml \
  --min-instances 1 --max-instances 1 --no-cpu-throttling --cpu 1 --memory 2Gi --allow-unauthenticated
```

One always-on instance runs API, worker and the iMessage agent (`RUN_WORKER=inline`); keep max instances at 1 so there is one worker and one agent. The same project can enable Places API (New) and Routes API for `GOOGLE_MAPS_KEY` (real opening hours and ETAs).

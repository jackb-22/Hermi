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

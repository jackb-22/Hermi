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

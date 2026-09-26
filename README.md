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

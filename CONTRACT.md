# API contract (backend ↔ app)

The backend owns this contract. The **live, always-current reference** is the OpenAPI document:

- `GET /docs` — browsable reference with try-it-out
- `GET /openapi.json` — machine-readable; generate types with `npx openapi-typescript <base>/openapi.json -o api.d.ts`
- Or import the zod schemas directly from `packages/shared/src/api` (same monorepo).

## Conventions

| Thing | Rule |
|---|---|
| Base path | Every route is served at `/v1/<path>` **and** at the bare `/<path>` (the plan's endpoint table has no prefix). Prefer `/v1`. |
| Auth | `Authorization: Bearer <token>` from `POST /v1/auth/apple` (or `POST /v1/auth/dev` on dev deployments). Tokens last 30 days. |
| IDs | ULID strings. |
| Times | ISO-8601 UTC strings in and out. |
| Coordinates | `{ "lat": number, "lng": number }` objects. Never arrays. |
| Units | meters, minutes (durations), km only where the field name says `Km`. |
| Errors | Always `{ "error": { "code": "...", "message": "...", "details"?: ... } }`. Switch on `code`, never on `message`. Codes: see `packages/shared/src/errors.ts`. |
| Unknown fields | Stripped from requests, not rejected. |
| Lists | `{ "items": [...], "nextCursor": string \| null }`. |
| Realtime | None. Poll the social layer every 30 s while the map is open; everything else arrives by push. |

## Dev affordances (non-production deployments)

- `POST /v1/auth/dev { "username": "maya" }` → token, creates the user if needed.
- `POST /v1/auth/apple { "identityToken": "fake:<anything>" }` works until real Sign in with Apple is configured.
- `POST /v1/auth/edu` returns `devCode` so you can finish verification without an inbox.
- App Attest is not enforced (`ATTEST_MODE=off|log`), so the Simulator works.

## Changelog (additive only; nothing is renamed once listed here)

- **v0.1.0** — `/health`, auth (`/auth/apple`, `/auth/dev`, `/auth/edu`, `/auth/edu/verify`), `/me` (GET, PATCH, DELETE), `/me/push-token`, universal-link fallbacks `/c/:id`, `/t/:id`, AASA.

## Additions beyond the plan's data model

The plan implies these without listing them; they are part of the contract:

- `sessions` (Action-mode session + recap), `media` (capture records), `edu_codes`, `feed_seen`, `blocks`, `reports`, `saves`.
- Tiger: `checkins.id` column (check-ins are referenced by id from media and reviews), `movement_daily` continuous aggregate.
- Streaks follow the later spec (pp. 25–26): friendship holds `hangouts`, `streakWeeks`, `lastHangoutWeek`; one hangout per pair per day.

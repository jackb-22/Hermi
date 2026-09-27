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

## Dev affordances

Open when running locally. On a deployment every dev affordance needs the header `x-dev-token: <DEV_TOKEN>` (ask Jack for the value), otherwise it returns 403.

- `POST /v1/auth/dev { "username": "maya" }` → token, creates the user if needed.
- `POST /v1/auth/apple { "identityToken": "fake:<anything>" }` works until real Sign in with Apple is configured.
- `POST /v1/auth/edu` returns `devCode` (with the dev token, while no email provider is configured) so you can finish verification without an inbox.
- App Attest is not enforced (`ATTEST_MODE=off|log`), so the Simulator works.

## Changelog (additive only; nothing is renamed once listed here)

- **v0.1.0** — `/health`, auth (`/auth/apple`, `/auth/dev`, `/auth/edu`, `/auth/edu/verify`), `/me` (GET, PATCH, DELETE), `/me/push-token`, universal-link fallbacks `/c/:id`, `/t/:id`, AASA.
- **v0.2.0** — places: `GET /places?bbox=w,s,e,n&cat=&limit=` (top-N per category), `GET /places/near?lat&lng&cat&r` (zoom-sized radius, widened to ≥5 results, 1200 m cap), `GET /places/:id` (place sheet with hereNow / friendsBeen / going / wouldGoAgainPct). Auth optional on all three; signed-in adds `tasteMatch` and the 21+ filter.
- **v0.3.0** — onboarding: `GET /onboarding/deck` (public), `POST /me/taste { is21, swipes:[{cardId, liked}] }` (also Retune taste).
- **v0.4.0** — plans: `POST /plans`, `GET /plans?scope=upcoming|drafts|completed|all`, `GET/PATCH/DELETE /plans/:id`, `PUT /plans/:id/stops` (whole ordered list; each stop is `{placeId}` or `{slot:{category,near}}`, optional `id` to keep it, `legMode`, `stayMin`). Every response is fully timed (`arriveAt`/`departAt`), with `totals.xpPreview`, red-row `issues[]` and `ghostChanges[]`.
- **v0.5.0** — `POST /plans/:id/schedule` (AI button tap: real ETAs, hours, AI stays, validate, one ghost fix), `POST /plans/:id/changes/apply { ids? }`, `POST /plans/:id/changes/dismiss { ids? }`. Ghost change kinds: swap, move, add_stop, remove_stop, set_mode, set_start, set_stay.
- **v0.6.0** — Action mode: `POST /sessions { planId? }` (returns 100 m geofences + plan), `GET /sessions/active`, `POST /sessions/:id/points { points:[{lat,lng,accuracy,speed?,time}] }` (≤500 per batch; implausible points dropped and counted).
- **v0.7.0** — App Attest: `GET /attest/challenge`, `POST /attest/register { keyId, attestation, challenge }`. Check-ins, taps and captures accept header `x-app-attest: base64(JSON{keyId, assertion})` where the assertion signs sha256(raw JSON body). Enforcement is off on dev and `log` on the demo deployment, so the Simulator keeps working.
- **v0.8.0** — `POST /checkins` — GPS tier `{tier:'gps', placeId, sessionId, lat, lng, accuracy}` (needs 5 min of session trace inside 100 m, walked in, accuracy ≤ 50 m) or tag tier `{tier:'tag', tagUrl, lat, lng, accuracy}` (within 150 m). Returns XP breakdown, first-visit flag and the completed plan stop. Error codes: `TAG_INVALID`, `CHECKIN_TOO_FAR`, `CHECKIN_NO_DWELL`, `CHECKIN_LOW_ACCURACY`, `CHECKIN_RATE_LIMITED` (one per venue per 6 h), `SESSION_NOT_ACTIVE`.
- **v0.9.0** — verified media: `POST /media/presign {checkinId, kind, contentType, sha256, bytes, capturedAt, lat, lng, durationS?, pairedWith?}` → `{media, upload:{url, method:'PUT', headers}}`; PUT the bytes with exactly those headers; `POST /media/:id/commit` re-hashes and checks window (check-in → departure + 10 min) and 150 m. `GET /media?checkinId|sessionId`. Codes: `MEDIA_HASH_MISMATCH`, `MEDIA_OUT_OF_WINDOW`, `MEDIA_TOO_FAR`.
- **v0.10.0** — `POST /sessions/:id/end { steps? }` then poll `GET /sessions/:id/recap` → `{status:'pending'|'ready', recap}`. Recap: thinned `route`, `segments` (walk/bike/vehicle/subway), `newTiles` in route order, `footKm`, `stops` with best capture and review state, `xp.items` breakdown, `planCompleted`, `fullParty`.
- **v0.11.0** — dev only: `GET/POST /dev/clock` (shift server time), `POST /dev/tags {kind, placeId?}` → a working tag URL (render as a QR to test scanning without stickers).
- **v0.11.1** — dev affordances require `x-dev-token` on deployments.
- **v0.12.0** — friends and IRL streaks: `POST /taps {url, lat, lng, accuracy}` (venue tag → check-in; personal tag → `waiting` then `friends`/`hangout`/`already_today`), `GET /taps/pending?friendId=` (poll during the 2-minute timer), `POST /me/tag {url}` (bind your sticker). Streak object: `{weeks, lit, endsThisWeek, hangouts, since}`. Check-in responses now list venue co-check-in `hangouts`.
- **v0.13.0** — score: `GET /score?userId=` (30-day Score, `delta7d`, 30-bar `sparkline`, `expiring`, friend and campus `ranks`), `GET /leaderboard?scope=friends|campus`, `GET /tiles?userId=` (you or a friend: zoom-18 tiles, bounds, `manhattanPct`, per-borough), `GET /stats` (your stats sheet only).
- **v0.14.0** — posts: `POST /posts {sessionId?, mediaIds, includeRoute, caption?}` (type inferred: recap / clip / photos; `status:'pending'` until the safety check), `GET /posts?authorId=&cursor=`, `GET/DELETE /posts/:id`, `POST /reviews {checkinId, again, text?}` (text → Review post), `POST /reports {postId|userId, reason}`, `POST /blocks {userId}`, `DELETE /blocks/:userId`. Post cards carry `stamp` (Verified IRL), `counts {been, going}`, media with `ambientUrl`.
- **v0.14.1** — media renditions: after commit the worker makes a 720p H.264 clip + poster, a ≤1440 px JPEG, or an AAC ambient clip on the CDN; `renditionUrl`/`posterUrl` and post media `url` switch to it. Clip posts stay `pending` until their rendition exists (a few seconds).
- **v0.15.0** — feed: `GET /feed?lat&lng` → `{cards, unseenLeftToday}`; cards are `{kind:'post', post}`, `{kind:'plan', plan, action:'join'|'request'}` (every fifth card) and a final `{kind:'end', title, action:{type:'plan_from_saved'}}`. `POST /feed/seen {postIds}` as cards become visible (30 unseen a day).
- **v0.16.0** — profile: `GET /profile/:id|me` (header, Score row, streak with you, last check-in unless ghost mode, counts), `GET /friends`. Saves: `POST /saves {type, refId, folderId?}` (someone else’s plan is copied: `copiedPlanId`), `DELETE /saves {type, refId}`, `GET /saves?type&folderId`, folders CRUD + `POST/DELETE /folders/:id/items`. `POST /plans/from-saved {lat, lng}` (feed end card). Verified IRL: HTML at `/verify/:hash`, JSON at `GET /credentials/:hash` (only for posted captures).
- **v0.17.0** — plan membership: `GET /plans/:id/name-suggestion`, `POST /plans/:id/save {name?, visibility, inviteeIds}`, `/invite {userIds}`, `/join {token?}`, `/decline`, `/request`, `/requests/:userId/approve|deny`, `GET /plans/by-token/:token` (share links `/p/:token` open the app or a Safari page). Social mode: `GET /social?bbox` → `{friendsOut, friendPlans, openPlans, refreshAfterS: 30}`. Push (Expo) for invites, joins, requests and approvals: register with `POST /me/push-token`; `data.kind` is `plan_invite|plan_join|plan_request|plan_approved` with `planId`.
- **v0.17.1** — campus ranks count every verified student on the campus with all their XP (including XP from before they verified). No shape change.
- **v0.17.2** — behaviour fixes, no shape changes: a text review no longer uses up the visit's photo (it can still go in a Photos/Recap post); a clip post whose video cannot be processed becomes `rejected` instead of staying `pending`; the share-link token no longer joins open (Find someone) plans, which always need the host's approval; deleting an account takes its posts down. HEIC photos are supported.
- **v0.18.0** — ghost pins. `GET /ghosts?after=<placeId>|lat&lng&at?&exclude=id,id` (while dropping pins) and `GET /plans/:id/ghosts?afterStopId?` (timed from that stop's departure) → `{items: GhostPin[≤3], anchor, at, sunsetAt, weather, rankedBy: gemini|code, fadeAfterSec: 10}`. A `GhostPin` has `place`, `category`, `label` (≤6 words), `walkMin` (the dotted-line label), `distanceM`, `arriveAt`, `score` and `factors {pref, time, transition, novelty}`. Tap one with `POST /plans/:id/ghosts/accept {placeId, afterStopId?}`, which returns the Plan with the stop inserted after that stop. Ghosts that fade untapped can optionally be reported with `POST /ghosts/skip {placeIds, planId?}`; the planner's memory uses them.
- **v0.19.0** — AI button, expanded: `POST /plans/:id/ask {prompt | chip}`, where chip is `add_dinner|rain_proof|best_weather_day|cheaper` and you send exactly one of the two. It returns `{plan, message, sources, via: backboard|gemini|code}`. The suggested edits are in `plan.ghostChanges` (kinds `add_stop|remove_stop|move|set_mode|set_start`, each with a `label`), and nothing is applied until you call `/plans/:id/changes/apply` (all of them, or `ids` one at a time) or `/changes/dismiss`. Show `sources` (Google Maps links) right under `message`; changes informed by Maps also carry `sources`. Accepting a `set_start` that moves the plan to another day moves `endBy` along with it. Limit: 30 asks an hour. `/health` now lists `backboard`. A review with `again: false` and `POST /ghosts/skip` become planner memories.
- **v0.20.0** — Find someone matching. Open plans (`visibility: find`) now go only to matched students: verified, Open to plans on, on the host's campus, last seen within 3 km (when known), free at that time, not blocked, no disliked stop, 21+ where a stop needs it, and a taste that overlaps. Matching is a `$vectorSearch` over preference vectors; the checks after it run in code. This applies to `GET /social` `openPlans`, the feed's plan cards, `GET /plans/:id` and `POST /plans/:id/request`; unmatched students get 403 on request. Newly matched students get a push with `data.kind: 'plan_match'` and `planId`. New field `Plan.matchCount`: for the host of a find plan it is the number matched so far, otherwise null. Fix: a pending request no longer moves an open plan into `friendPlans` with action `join`; it stays in `openPlans` with action `requested`.
- **v0.21.0** — C2PA Content Credentials. The worker embeds a signed manifest (in-app capture, place, time, check-in tier, attestation, original sha256) in a copy of each verified original. `VerifySchema.credential` gains `signer` and `inspectUrl` (a contentcredentials.org link), and `manifestUrl` is that credentialed file. `/health` lists `c2pa` as `c2pa` or `read-only`.
- **v0.22.0** — Profile photos and review of reported posts.
  - **Photos:** upload with `POST /me/photo`, sending the raw image as the body with `Content-Type: image/jpeg|png|heic|webp`, up to 12 MB. It returns `Me`. An image whose Content Credentials declare AI generation is refused with 422 `PHOTO_REJECTED`. With Reality Defender on, `Me.photoReview` is `{status: 'scanning'}` until the scan finishes. Meanwhile `photoUrl` keeps showing the old photo. When the scan finishes the photo goes live, or `photoReview` becomes `{status: 'rejected', reason}` and a push is sent with `data.kind: 'photo_rejected'`.
  - **`PATCH /me`:** `photoKey` is now ignored. Before this change a client could point it at any stored file.
  - **Reports:** a reported post is reviewed by Reality Defender (its first photo, or a clip's poster frame) when that is configured, and otherwise by Gemini again. The post is removed if the media is flagged as manipulated, if it fails the Gemini check, or once 3 different people have reported it.
  - **`/health`** lists `detector`.
- **v0.23.0** — The plan's iMessage group (Photon).
  - **`Plan.textGroup`:** `{recipients, body, bound}` for the host when the agent is configured, otherwise null. Open Messages with expo-sms using these recipients and body, then add friends.
  - **The agent:** it reads the link token in the body, binds that thread to the plan and posts the plan card. After that it counts "in" replies, posts one line per check-in on the plan, and ends with the recap link when the host's session finishes.
  - **`/health`** lists `messenger`.
- **v0.24.0** — Notifications.
  - **Weekly nudge:** at most one push a week, on Friday at 3 PM New York time. It leads with the streak closest to lapsing, as `data {kind: 'streak_nudge', friendId}` ("Your 8-week streak with Maya ends Sunday"). The app opens a new plan with that friend invited: `POST /plans`, then `/save {visibility: 'invite', inviteeIds: [friendId]}`. With no streak at risk it sends `{kind: 'xp_expiring'}` ("40 XP expires Sunday. Plans?"); with nothing to say it sends nothing.
  - **Review reminder:** if any checked-in stop of a session is unreviewed, one push goes out at 10 AM the next morning with `{kind: 'review_reminder', sessionId}`.
  - **Dev:** `POST /dev/nudge {userId?}` sends the weekly nudge now for rehearsal and returns a preview.
- **v0.25.0** — `GET /posts?placeId=` lists a place's posts, newest first, for the place sheet's grid at full height (everyone's, minus blocked authors and posts you reported; add `authorId` to narrow it). Paged with `cursor` like the profile grid.
- **v0.25.1** — `GET /places/:id` `reviewSummary` is now filled: two short lines summarizing that place's text reviews (only ones that passed moderation, newest 20), written by Gemini. It refreshes a few seconds after a review goes live or is removed; `null` until a place has a text review. No shape change.
- **v0.25.2** — dev only: `POST /dev/clock` now shifts the worker too (it follows within 2 s), so jobs such as the recap and review reminders see the same time. No shape change.
- **v0.26.0** — Social map for the hermit-crab design.
  - **`friendsOut[].active`:** blink that place. True when they checked in within the hour, or it is the latest stop of an outing they are still on. Still check-ins only, never live location.
  - **`routes[]`:** friends' plans as lines: `{planId, name, host, status: planned|active|completed, style: dotted|solid|mixed, line: [{lat,lng}], doneThrough, startAt, completedAt}`. Planned → dotted; completed in the last 7 days → solid, through the stops they checked in at; under way → solid through `doneThrough`, dotted after. Lines join stops, never GPS traces. Completed routes hide while the friend is in ghost mode.
  - **`spriteUrl`** (UserCard, Me, plan members) is deprecated and always null: everyone is the same hermit crab, bundled in the app. The field stays so nothing breaks.

## Additions beyond the plan's data model

The plan implies these without listing them; they are part of the contract:

- `sessions` (Action-mode session + recap), `media` (capture records), `edu_codes`, `feed_seen`, `blocks`, `reports`, `saves`.
- Tiger: `checkins.id` column (check-ins are referenced by id from media and reviews), `movement_daily` continuous aggregate.
- Streaks follow the later spec (pp. 25–26): friendship holds `hangouts`, `streakWeeks`, `lastHangoutWeek`; one hangout per pair per day.

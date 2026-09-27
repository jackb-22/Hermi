> ARCHIVED PROTOTYPE RECORD — superseded on 2026-09-26. Use [Hermi schema](HERMI_SCHEMA.md), [user tests](test.md), and [progress](PROGRESS.md). Statements below about branding, commit restrictions, backend availability and Xcode describe an earlier checkpoint, not current instructions.

# Cairn frontend integration

This is the initial API inventory. The current behavior, user decisions, and test process are defined in [FRONTEND_TRUTH.md](FRONTEND_TRUTH.md). Treat this file as a dated integration snapshot.

Reviewed against backend commit `3f546af` and the 46-page **Unified Truth.pdf** in the parent Divhacks folder. This is a frontend integration review, not a claim that deployed providers have been tested. Backend development is concurrent; recheck these findings before enabling blocked features.

## Product requirements

- Home pill: Feed / Map / Profile; Map selected initially. Action mode replaces it with Directions / Camera; feed is unavailable until the session ends.
- One reusable sheet with peek, half, and full heights and a small navigation stack. Bookmark means Save, never Like.
- Pixel map, sprites, and large numbers; legible native-style body text, lists, and controls. NYC bounds, borough-to-block zoom limits, sparse labels.
- Pins open nearby discovery; selecting an explicit venue and adding it creates a plan stop. User clarification supersedes the earlier placeholder interpretation; frontend plans contain no unresolved slots. Ordered stops form a dotted route. The server owns schedule arithmetic, XP, verification, and social matching.
- AI changes remain suggestions until accepted. Scheduling is supported; free-text planning is blocked below.
- Score is XP earned in the last 30 days and may decrease. Exploration tiles are lifetime progress. Posting, saving, and reviewing earn no XP.
- The requested cairn stack accompanies Score. The user confirmed that it shrinks with rolling Score and delegated the initial scale. See the framework for the proposed thresholds; do not introduce levels or a second reward system.
- Onboarding: explain, taste, Apple identity/student verification, profile. Collect taste locally before authentication, then submit it after sign-in. Request device permissions only when needed.
- Friends are added only through reciprocal in-person tag taps. No remote friend search, likes, DMs, or live friend locations.

## Supported API integration

Use `/v1`, bearer authentication, and the schemas in `packages/shared/src/api`. Do not duplicate backend score, dwell, schedule, or eligibility logic.

| Frontend flow | Existing contract | Client behavior |
| --- | --- | --- |
| Identity and onboarding | `/auth/apple`, `/auth/edu`, `/auth/edu/verify`, `/me`, `/onboarding/deck`, `/me/taste` | Preserve pending taste choices through sign-in; show verification errors; persist tokens securely on device. |
| Map and place sheet | `/places`, `/places/near`, `/places/:id` | Query visible bounds and zoom-derived radius; cancel or ignore stale responses. Null hours/review summary means unavailable, not closed/no reviews. |
| Plan editor | `/plans`, `/plans/:id`, `/plans/:id/stops` | Send the full ordered stop list and retain existing stop IDs; display returned times, leg sources, issues, and XP preview. |
| AI scheduling | `/plans/:id/schedule`, `/changes/apply`, `/changes/dismiss` | Show suggested changes and their source links; require explicit accept/dismiss. |
| Plan sharing | `/plans/:id/save`, `/invite`, `/join`, `/decline`, `/request`, `/requests/:userId/approve`, `/requests/:userId/deny` | Respect host/member controls and verification restrictions. Share the returned URL through the OS. |
| Social map | `/social` | Poll every 30 seconds only while visible; show deliberate check-ins, never continuous friend tracking. |
| Action mode | `/sessions`, `/sessions/active`, `/sessions/:id/points`, `/sessions/:id/end` | Track only during active sessions; upload genuine OS fixes in batches of at most 500; restore active sessions after restart. |
| Check-ins and tags | `/checkins`, `/taps`, `/taps/pending`, `/me/tag` | Use real position and accuracy; show server error codes; handle the reciprocal two-minute timer. Never simulate proof in live mode. |
| Camera | `/media/presign`, signed PUT URL, `/media/:id/commit`, `/media` | In-app capture only, SHA-256 of exact bytes, capture-time location and timestamp, current check-in. Send only returned upload headers to storage. |
| Recap and posting | `/sessions/:id/recap`, `/posts`, `/reviews` | Poll pending recaps; render server XP breakdown; allow capture selection and skippable reviews. Distinguish pending moderation from published. |
| Feed | `/feed`, `/feed/seen` | Finite feed; mark only actually visible posts seen; pause off-screen video/audio. |
| Profile | `/profile/:id`, `/score`, `/tiles`, `/stats`, `/friends`, `/leaderboard` | Never show private routes, saves, or personal stats on other users' profiles. |
| Saved items | `/saves`, `/folders`, `/folders/:id/items` | Mixed-type folders; saving someone else's plan can return a new copied plan ID. |
| Safety/settings | `/reports`, `/blocks`, `PATCH /me`, `DELETE /me` | Report/block controls; ghost mode and open-to-plans use server state. Confirm account deletion. |

## Backend blockers and gaps

| Gap at reviewed commit | Evidence | Frontend treatment |
| --- | --- | --- |
| Expanded AI/free-text planner is absent | PDF pp. 10, 32 calls for `POST /plans/:id/ask`; registered routes and shared contracts do not provide it. | Do not wire Rain-proof/Add dinner/free-text controls to an invented endpoint. Scheduling remains available. |
| Ghost-pin recommendations have no contract | PDF pp. 7–8 describes preference/time/novelty recommendations; place endpoints return ranked places but no next-pin proposals. | Do not invent AI recommendations or walking-time claims. Keep ordinary category discovery working. |
| Profile photo upload and sprite generation are absent | `PATCH /me` accepts `photoKey`; user views read `spriteKey`, but no profile upload/generation route is registered. Media presigning requires a verified check-in. | Name and username editing can work. Do not misuse verified-capture upload for profile photos or fabricate a generated avatar. |
| Place-specific post grid has no filter | `PostsListQuery` supports `authorId` and `cursor`, not `placeId`. | Do not present a global feed as a place's posts. Request a backend-supported place filter. |
| Historical visits and route listing are incomplete | Tiles and top-place stats exist; no user visit-history endpoint or completed-plan-to-session lookup is exposed. | Colored tiles can render. Full visit drill-down and posting an old unposted completed plan need a session ID lookup contract. |
| C2PA signing is not implemented in the reviewed media worker | `processMedia.ts` transcodes; verification returns `credential.c2pa` from optional stored metadata. | Verified IRL may describe server-verified presence. Do not claim a signed C2PA credential unless the API reports one. |

## Configuration and device gates

- No backend URL or demo credentials were supplied. A live end-to-end test needs a running API, databases, worker, and seeded places; storage/provider configuration is separate from frontend code.
- Apple identity, associated domains, App Attest, background location, push, camera, and Live Activities require appropriate device/build configuration. The backend has development affordances; these must not silently become production identity or proof.
- The backend push provider accepts Expo push tokens. A SwiftUI-only client requires a compatible push strategy and cannot send raw APNs tokens to the existing provider.
- Full Xcode is not installed in `/Applications` on the current Mac; `xcodebuild -version` fails because command-line tools are selected. Native simulator/device build verification is currently unavailable.
- The PDF specifies Expo SDK 57. Verify actual registry availability and compatible versions before installation; do not install a guessed SDK.

## Decisions and development process

The user selected SwiftUI with a viewable native preview, a youthful restrained palette, a cairn that shrinks as Score expires, and PDF behavior over outdated Miro details. The full framework and incremental acceptance process supersede the earlier open-decision list.

Full iPhone validation remains blocked by the native toolchain/configuration. A Mac SwiftUI preview can be compiled with the installed tools. This does not validate iPhone behavior.

Only frontend files and this integration documentation belong to this branch. Missing backend features remain flagged for the backend owner. No further commits or pushes are authorized.

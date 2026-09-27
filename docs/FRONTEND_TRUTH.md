> ARCHIVED PROTOTYPE RECORD — superseded on 2026-09-26. Use [Hermi schema](HERMI_SCHEMA.md), [user tests](../test.md), and [progress](../PROGRESS.md). Statements below about branding, commit restrictions, backend availability and Xcode describe an earlier checkpoint, not current instructions.

# Cairn frontend: logic and design framework

Status: framework draft for user review. Feature development is paused. Existing SwiftUI code is an exploratory first pass, not accepted implementation. No further commits or pushes are authorized.

This document defines intended frontend behavior. [Acceptance tests](FRONTEND_TESTS.md) define how to verify it. [Increment ledger](FRONTEND_INCREMENTS.md) records what may be worked on and what the user has tested. A successful build does not make a feature accepted.

## 1. Sources and change rules

| Source | Authority |
| --- | --- |
| User decisions in this conversation | Explicit overrides and working instructions. Record each decision here before implementing it. |
| `../../Unified Truth.pdf` | Product behavior and scope. Remains the underlying product specification. |
| Backend routes and `packages/shared/src/api` | What the frontend can actually call and which response shapes exist. A mismatch with the PDF is a blocker, not permission to invent functionality. |
| [Miro board](https://miro.com/app/board/uXjVHiXJRq4=/) | Visual and layout inspiration. Outdated activity counts and star ratings do not override the PDF. |
| Current frontend code | Implementation to evaluate against these sources. It does not establish requirements. |

Backend reviewed at `3f546af`. Before each live integration increment, record the backend revision or deployed version and recheck the affected contracts. Do not modify backend code to make a frontend test pass. Conflicting backend responses are logged for its owner.

Confirmed user decisions:

- Use SwiftUI if the user can see the work during development. A native Mac preview is available; full iPhone validation requires Xcode and a device/simulator.
- Colors should feel youthful, fun, restrained, and somewhat muted. Avoid a brown/aged visual treatment and excessive simultaneous color.
- The cairn follows the rolling Score and can shrink. A light wind effect may carry away an expiring stone. The frontend developer chooses the initial stone scale from actual XP rewards.
- The PDF governs behavior; Miro primarily governs visual inspiration.
- Development proceeds one testable component or feature at a time. The user tests each increment before advancement.
- No more commits or pushes until the user explicitly authorizes them. Existing local commits remain intact.
- School verification is mandatory before entering the product; the earlier proposed skip path is rejected.
- Plan items are explicit selected places only. Dropping a pin starts nearby discovery and does not add a plan item; only choosing a place and adding it changes the plan. No undecided destinations appear in a plan.
- Plans require at least one item and have no product-level maximum. The existing backend limit of 12 is a contract conflict to resolve with its owner.
- Timing issues are advisory. Users can proceed despite them, edit manually, or use supported AI scheduling/revision. Timing issues alone must not disable Start.
- Denying location prevents tracked outings and GPS check-ins. NFC check-in at the event must remain available despite denied location permission (user-confirmed exception). Successful location-free NFC check-in conflicts with the PDF/backend's location requirement and is blocked until the specification and backend support it. Do not substitute a successful scan for an accepted check-in.

Unconfirmed choices remain labeled **proposed**. Do not silently convert a proposal into an accepted design. New creative choices outside these decisions go to the user before implementation.

## 2. Product invariants

| ID | Rule | Source |
| --- | --- | --- |
| R01 | Verified presence is required for earned XP, reviews, and public captures. Client animations never award XP. | PDF pp. 1, 14–16 |
| R02 | Score is the server's last 30 days of XP. Exploration is lifetime progress and does not disappear when Score falls. | PDF pp. 15–17 |
| R03 | Home has Feed, Map, Profile. Map is the initial panel. Panels change by tapping the pill. | PDF pp. 2–3 |
| R04 | During an active outing, the pill contains Directions and Camera only. Ending leads to Recap, then Home after Post or Later. | PDF pp. 2, 11–13 |
| R05 | One reusable sheet owns Place, nearby results, Plan, and supported AI views. It has peek, half, full, dismissal, and back navigation. | PDF p. 3 |
| R06 | Save uses a bookmark. No likes, comments, remote friend requests, DMs, badges, global ranks, or live friend locations. | PDF pp. 3, 18, 22, 28–29 |
| R07 | Seven activity categories: Food, Shopping, Nature, Culture, Drinks, Sports, Music. All is a filter, not an eighth activity type. | PDF pp. 6–7 |
| R08 | Server schedules, issues, suggestions, check-ins, scores, and membership results are authoritative. Unknown or missing fields are not zero, false, or success. | API contracts; PDF pp. 9–10 |
| R09 | AI suggestions are visibly provisional and require acceptance. Never silently apply them. | PDF pp. 1, 9–10 |
| R10 | Permissions are requested when needed. Tracking is tied to an active outing, not to a visible view. | PDF pp. 5, 13 |
| R11 | Only captures made in the app at a qualifying visit can be posted. No camera-roll import for posts. | PDF pp. 12, 15 |
| R12 | Friends see permitted tiles, places, and public content. They never receive private routes, Saved, or personal people-most statistics through the UI. | PDF pp. 20–21 |
| R13 | The feed ends. Seen means actually visible; loading or prefetching is insufficient. Posting/saving/reviewing earn zero XP. | PDF pp. 16, 19 |
| R14 | A preview is labeled sample data and cannot mutate live accounts, create proof, or award real XP. | Frontend implementation requirement |

## 3. Responsibility boundaries

| Owner | Owns | Does not own |
| --- | --- | --- |
| SwiftUI views | Layout, gestures, accessibility, form validation, display of pending/loading/error states | Server reward arithmetic, business eligibility, provider credentials |
| Feature state | Navigation, drafts, in-flight requests, cancellation, pending operations, reversible display state | Fabricated success, missing backend features |
| API adapter | Typed request/response decoding, error-code mapping, authentication, timeouts, contract version checks | Quietly coercing invalid responses into useful-looking data |
| Device services | Genuine location, camera, microphone, motion, App Attest, system permission state | Simulated proof in live mode, continuous tracking after End |
| Backend | Identity verification, eligibility, dwell validation, XP, persistence, scheduling, moderation, matching | Frontend layout and interaction |
| Preview fixtures | Deterministic examples, network-free states, boundary values | A substitute for live or device validation |

Target separation: `DesignSystem`, `Navigation`, `API/Models`, `Features/*`, `DeviceServices`, `PreviewFixtures`, and `Tests`. These are intended responsibilities, not a requirement to rename every file immediately. Extract one feature at its increment rather than performing a broad rewrite.

Each feature has its own request state. A slow unrelated request must not freeze the entire app. Shared mutations that affect the same plan are serialized or explicitly superseded. Any response must still match the current user, selected object, session, and request before it changes the UI.

## 4. Navigation and state transitions

### Account

`explain → taste collected locally → Apple sign-in → school verification → profile → home`

Apple sign-in alone must not skip remaining onboarding. Cancellation preserves taste choices. A returning user resumes incomplete onboarding from persisted/server state. Verification failures remain on verification with a specific recovery action. School verification is mandatory before Home. The prototype's skip control is rejected and must be removed in its account increment. A returning account whose school verification cannot be confirmed does not silently enter Home.

Signing out or changing API/account clears user-specific cached views, credentials, and pending account-bound navigation. An active outing must be explicitly resolved before switching accounts. Never upload one user's retained outbox with another user's token.

### Map and sheets

`map → drop discovery pin → nearby results → select explicit place → Add to plan → plan`

Canceling discovery or place inspection leaves the plan unchanged. Empty results or a failed nearby request do not create a stop. The discovery pin is temporary search context, separate from numbered plan stops.

`plan → place → back to the same plan`

Closing a sheet preserves the map position and draft plan. Peek keeps the map interactive. Map gestures never become panel gestures. The pill hides while the map moves and returns about 300 ms after motion ends.

A new region/category request invalidates the previous request. Responses for the previous region cannot overwrite current markers. No results, failed load, and loading are distinct states. Unknown hours are not “closed”; missing reviews are not “0% would go again.”

### Plan

`draft → saved/planned → active → completed`, using returned server states.

A plan must have more than zero items and has no product-level maximum. The current 12-stop backend cap is a blocker for this requirement. Timing warnings allow an explicit choice to proceed, edit, or revise using supported AI functionality.

Every user-facing plan stop has an explicit chosen place. The frontend submits place-based stops, never unresolved category slots. The backend supports slots, but that capability does not define the product experience. This user clarification supersedes the earlier interpretation of the PDF as allowing placeholders in plans. Handling a pre-existing server plan containing slots remains an integration decision; do not silently discard stops or present it as ready to start. Editing a stop preserves its ID. Default/AI stay lengths are not converted into user overrides merely because the stop is reordered. Changing one leg affects that leg; changing the overall mode follows the backend's reset behavior.

Schedule responses replace displayed times and issues. Suggested changes remain separate until accepted. A failed request preserves the last confirmed plan and shows the unsaved state; it does not leave optimistic data looking saved.

### Outing and recap

`idle → requesting permissions/start → active → flushing route/end pending → ending → recap pending → recap ready → home`

Start failure keeps the user in Home. Repeated Start must not create multiple active sessions. End stops new tracking after the server confirms the transition. Buffered points must be resolved before finalization; failures keep a clear retry state.

Persist the session ID and pending end/recap state locally. `GET /sessions/active` returns active sessions only, so it cannot recover an ending session by itself. App termination during ending must resume polling the retained session ID.

Camera/Directions changes and sheets do not destroy the tracker or its outbox. OS permission denial, suspension, foreground return, and app termination have explicit recovery states. No client state can claim a successful check-in before the server response.

### Capture and publication

`capture with visit context → private local capture → presign → upload → commit → verified private media → selected for post → pending moderation → live/rejected`

Bind check-in ID, capture time, coordinates, bytes, and hash to each capture. A later shutter tap cannot overwrite another capture's metadata. Retry does not turn an old photo into a new capture. Failed uploads remain recoverable; they do not disappear behind a success toast.

A successful upload is not a published post. A pending post is not live. C2PA claims require a credential reported by the backend. A generic Verified IRL badge cannot imply unavailable signing.

## 5. Shared design system

The following tokens are **proposed for the first design increment**, using the user's approved direction. They are not yet visually accepted.

| Role | Proposed token | Use |
| --- | --- | --- |
| Ink | `#243C37` | Primary text, main filled action, navigation selection |
| Surface | `#F8FAF3` / white | App and sheet backgrounds |
| Green | `#447F65` | Navigation accents, exploration, success with text/icon |
| Lime | `#D5EB93` | Primary pin action, small highlights |
| Lake | `#86BAC7` | Water and occasional category detail |
| Coral | `#E58771` | Food/category accents and small social highlights |
| Lavender | `#B4ADD6` | Culture/category accents |
| Secondary text | `#6C7E72` | Supplemental labels only, subject to contrast testing |
| Divider | `#DFE5D8` | Borders and separators |

Map colors carry geography. UI surfaces remain quiet. Limit an individual card to one dominant accent; category colors are functional, not decoration. Errors use an icon and text in addition to color.

Typography: legible system body text, Dynamic Type support, and a pixel display face for the map headings/large game numbers required by the PDF. The prototype's rounded large digits are a draft, not a settled exception to the pixel-type rule. Select and review the display font in increment 01.

Layout: a 4-point spacing base; 16–24-point page gutters; at least 44×44-point interactive targets on iPhone. Sheets/cards share a small radius scale. Dense details appear after an explicit expansion. Long place names wrap rather than collide with controls.

Map: real geography in the live app, low-resolution MapLibre rendering in a native web view, crisp POI controls, sparse neighborhood text, visible attribution, NYC bounds, borough-to-block zoom. Offline illustration is permitted only as labeled preview art. It must not masquerade as actual nearby geography.

Every reusable component has default, pressed, selected, disabled, loading, and error behavior where applicable. Screen readers must retain individual marker/button labels. At larger text sizes, content may grow and scroll; core actions remain reachable.

Animation: use restrained motion and stepped pixel-map effects. Reduce Motion substitutes opacity or immediate state changes. Animation never changes server state or hides an error. No mandatory sound, flashing, or repeated wind animation on every render.

## 6. Cairn and Score

The user authorized choosing a scale and using a shrinking stack. Initial scale for testing:

`XP threshold for n stones = 25 × n × (n + 1) / 2`

| Stones | Required rolling Score | Additional XP for this stone |
| --- | ---: | ---: |
| 1 | 25 | 25 |
| 2 | 75 | 50 |
| 3 | 150 | 75 |
| 4 | 250 | 100 |
| 5 | 375 | 125 |
| 6 | 525 | 150 |
| 7 | 700 | 175 |
| 8 | 900 | 200 |
| 9 | 1,125 | 225 |
| 10 | 1,375 | 250 |

Reward basis from `packages/shared/src/xp.ts`: GPS 10; tag 15; first visit +10; new tile 2; foot/bike km 5; completed 2+ stop plan 20; full party 25; first completed plan with someone new 20. Posts, reviews, saves, and streaks add zero.

Illustrative outing: two new tag visits (50), 2 km on foot (10), 10 genuinely new tiles (20), completed plan (20) = 100 XP. This is a reasoning example, not a client estimate of what a live user will earn. The server awards the actual total.

A first new tag visit earns one stone. Repeated outings are needed for a tall stack. Stones are a rendering of Score, not a separate currency or unlock system. Show the exact Score even between thresholds; optional next-stone progress derives only from that same value.

At a downward threshold crossing, the removed top stone may move sideways with a brief wind trace. Explain the decrease with the server's expiring-XP information. A decrease that does not cross a threshold does not remove a stone. Refreshing an unchanged Score does not replay wind. Reduce Motion does not move the stone across the screen.

Large-score presentation is to be reviewed in increment 17. It must preserve the true stone count and keep the stack readable; silently capping the visible stack at 16 is not accepted. Negative or malformed server Score values are a contract error; defensive rendering must not quietly conceal that error.

## 7. Cross-feature logic rules

- Each data surface distinguishes loading, loaded-empty, loaded-content, refreshing, failed, and unavailable. Authentication and permission failures have specific next steps.
- Errors are classified by API code. User-facing copy is concise and actionable. Do not depend on matching the backend's prose.
- Reads may retry with a bound and cancellation. Non-idempotent writes must not retry automatically after an ambiguous outcome without checking server state.
- User actions never create duplicate posts, plan stops, or uploads because a button was tapped twice.
- Local dates/times use the user's locale for display. Send ISO timestamps to the API. Streak week semantics come from the server, using the PDF's America/New_York rule.
- Accessibility, long text, small screens, offline transitions, and account changes are part of each component's test scope.
- Missing backend features are omitted from the live interaction or explained at the point of use. No fake successful control, hidden placeholder endpoint, or silent fallback to fabricated data.
- Typed feature models distinguish optional values from invalid required values. The exploratory generic JSON accessors need review because they currently turn some missing values into zero/empty/false.

## 8. Backend and environment gates

The existing [integration review](frontend-integration.md) is a dated API inventory. These blockers remain open until rechecked:

| ID | Gate | Effect |
| --- | --- | --- |
| B01 | No deployed API URL supplied | Live contract and end-to-end tests cannot be claimed as passed. |
| B02 | Full Xcode/iOS runtime unavailable | Mac preview works; iPhone build, touch behavior, permissions, background execution, and device tests remain unverified. |
| B03 | No expanded `/plans/:id/ask` contract | Free-text/chip planning remains blocked; supported scheduling can proceed. |
| B04 | No next-ghost-pin recommendation contract | Do not invent recommendation output. |
| B05 | No profile-photo upload/sprite-generation route | Name/username can proceed; photo and sprite generation are blocked. |
| B06 | No place-specific posts filter/visit-history contract | Full place post grid and historical visit drill-down are blocked. |
| B07 | No completed-plan-to-session lookup | Reopening older unposted recaps requires a backend lookup or a known persisted session ID. |
| B08 | Existing push provider accepts Expo tokens | Native APNs delivery needs a backend-compatible plan; no backend implementation in this branch. |
| B09 | C2PA signing not present in reviewed worker | Do not advertise signed provenance before a real credential is returned. |
| B10 | Device signing/domain/App Attest configuration not supplied | Universal links and strict attestation need configuration and real-device verification. |
| B11 | Backend `CreatePlanBody` and `PutStopsBody` cap stops at 12 | Conflicts with the user's positive-count/no-maximum requirement. Do not silently cap or split the plan, or modify the backend in this branch. |
| B12 | NFC/tag check-in requires coordinates and proximity within 150 m | Conflicts with the user-confirmed NFC exception when location permission is denied. Specification alignment and backend support are required; frontend code cannot fulfill this independently. |

Apple Intelligence is not a replacement for backend planning. The user's original mention was an idea; no device-model feature is added without a concrete approved use and compatibility plan. Live Activity remains a separate later increment after the core outing loop is validated.

## 9. Advancement rule

One increment at a time: describe it → implement only its scope → run its logic and boundary checks → present a testable build and a short user checklist → record user results → address failures → advance after the user's confirmation.

Existing prototype code may be reused only after it passes the increment's acceptance criteria. A blocked integration test is recorded as blocked, never passed. An increment may be visually reviewed before live testing, but remains incomplete for live use.

Framework review is increment 00. No additional feature development begins until this framework and the next increment are agreed. Review feedback updates these documents before code.

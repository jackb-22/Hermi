# Hermi approved frontend revision plan

Approved 2026-09-27. Frontend branch: `codex/cairn-frontend`. No pushes. Current work: **Step 5**, authorized after Step 4 acceptance with a category-gesture correction. User confirmed horizontal swipe/hold-to-drag and hidden map controls at full panel height. Source: user's approved technical plan and latest schema amendments. Preserve unrelated legacy prototype changes.

## Architecture and decisions

- Explicit HomeTab/SheetRoute/FeedQuery/ActionSessionState routing; per-screen toolbar intents. Native semantic buttons, minimum 44-point targets; navigation hold gestures originate only inside the pill.
- Typed map bridge commands/events with stable pin IDs and request IDs; convert into web-view coordinates before unprojecting. Stable MapLibre marker instances, cancel stale query results, versioned NYC land mask including water exclusions.
- DiscoveryPin stores ID, category, geographic coordinate and radius in miles, exposing meters for geographic calculations. DiscoveryFilters stores independent optional citywide category plus pins and selected pin ID. Union category-wide matches with each category-and-radius match; deduplicate places. Zero filters retains general discovery. New citywide selection replaces only that selection. Miles UI, 0.1–4, logarithmic, initial 1. Tap placed pin selects radius/X; X removes; invalid move restores prior coordinate.
- Native compact/medium/full sheets separate route from presentation state. Reusable feed/detail components explicitly distinguish global, place-specific and own-post context. Own-post context excludes friends' content.
- Shared palette/icon tokens across SwiftUI and web map. Pixel category icons on all pins, one sticky extra category indicator per visible category.
- Separate active draft, saved plans, saved items/folders and synchronization state. Stable plan/stop IDs; atomic local persistence, debounced text edits, 50-change durable local Undo per plan, account-scoped storage. Undo restores previous content as current state. No multi-device conflict resolution claims without a server contract.
- New-plan Save Plan dialog: name, folder existing/new, Solo/Friends(selected)/Public. Friends explicitly Save & invite. Existing saved plans autosave with no redundant Save button. Later edits never resend invitations; partial failures preserve draft and explain retry.
- Saved drawer scrolls horizontally independently of timeline. A saved plan appends explicit stops in order; skip already-present place IDs and report result. Unlocated images cannot create unresolved stops.

## Delivery checkpoints

Every checkpoint: build, relevant behavioral checks, same-device screenshots, compare with board and last accepted output, user tests in test.md, feedback corrections, explicit acceptance before advancing. Small early checkpoints stay separate.

| Step | Implementation | User acceptance sequence |
| --- | --- | --- |
| 0 | Consolidated schema, baseline/evidence, contract ledger, rating issue | Reproducible launch, clearly labeled fixtures, available test instructions. Documentation accompanies Step 1; rating issue still pending. |
| 1 | Immediate taps, Map/Feed/Profile, hold help, pill-only scrub, outside cancellation | Quick repeated taps; stationary hold without navigation; hold/slide; release outside; map pan/pinch and Feed scroll; accessibility. |
| 2 | Brighter palette, unified icons, full-screen composition, remove wordmark | Compare three screens, edges/safe areas, smaller simulator. Approve tokens before propagation. |
| 3 | Single pin drop/move/radius/X, land validation | Valid drop, radius, reposition, invalid water/outside drop, cancellation and remove. |
| 4 | Multiple pins and combined filters | Harlem Food + Brooklyn Nature + citywide Food; toggle citywide off; duplicate categories, independent radii, zoom clutter. |
| 5 | Native sheet and contextual Feed | Compact/medium/full, vertical content and horizontal media, close/reopen, camera/filter preservation, main Feed unchanged. |
| 6 | Full Plan timeline and Go entry | Add/remove, reorder, edit times, advisory overlap warning, place/attendee detail, empty/nonempty Go. |
| 7 | Saved drawer, mixed folders, Save Plan | Bookmark independent of plan, horizontal drawer, append itinerary, duplicates, existing/new folder, cancel, restart. |
| 8 | Saved-plan autosave/Undo/share | Edit without Save, Undo, restart, offline/retry, selected-friend confirmation, no duplicate invites or unsupported Public success. |
| 9 | Feed audience/content filters, Profile Settings/Saved/privacy | All filter combinations, vertical paging, independent save/add, own-post isolation, settings persistence and real effect. |
| 10 | Action states and integration | Go/return, location denied/granted/interruption, real iPhone camera capture/cancel/upload, ending, NFC last. |

Camera/create is Action only. Rating prompts/schema are backend-owned; user authorized a GitHub issue for backend work, not implementation. Zero-stop plans cannot start; no product cap. Timing warnings do not block proceeding. Live tracking/GPS check-in require location; supported NFC must remain possible without it.

## Backend gates

Inspected remote contract baseline: `1dfeef52ab432dbd03e46436ec78fc3fbe4d995f`; do not merge backend changes into the frontend branch without need. Recheck read-only at integration checkpoints.

- Server max 12 stops conflicts with product no cap; stay-duration range also differs. Report accurately; do not fix backend or silently truncate.
- No scalar rating/prompt schema: create issue covering scale, verified check-in eligibility, timing, idempotence, legacy reviews and response contract. No frontend collection yet.
- Feed audience/content query support incomplete: fixtures can test UI; incomplete client-side filtering cannot claim complete server results.
- Existing find/matching visibility is not automatically Public taste-based publishing.
- Granular presence/route audience controls exceed ghostMode; unavailable live controls must not imply enforcement.
- Saved types place/post/plan exist; standalone image save is unsupported. Mixed folders can use supported references.
- Attendance is currently plan-level; do not label it stop-level confirmed attendance.
- Autosave concurrency, notifications, capture upload, NFC and AI revision need verified contracts before enabling live claims.

## Evidence, commits and recovery

Persist deterministic fixture screenshots at each boundary; compare same viewport and camera. Record expected/actual differences, classify remaining later-step work. Use recordings for gestures and measured device performance for 60fps, not still images. User acceptance remains separate from automated checks.

Keep implementation commits small and compiling; separate feedback fixes and checkpoint documentation. Stage explicit frontend paths only; no pushes. Update PROGRESS.md and test.md with results, evidence paths, next action and blockers before stopping. Local commits do not constitute off-device backup.

## Step 3 feedback amendment — 2026-09-27

User supersedes the prior editor layout: recommendations use small category-colored dots; only discovery uses a pin. Tap empty map deselects without deleting the pin or recommendations. Selected pin exposes a small attached X and a background-free bottom-right radius slider above zoom/home. Those controls track compact/expanded panel height. Visual backgrounds shrink while touch targets remain. Direct vertical swipes on the source pin choose category with no menu; name below, decorative pixel chevrons at either side. User confirmed minimum 0.1 mile and retained maximum 4; default remains 1 mile. Remove sample-place map banner; fixture status remains documented in the test guide. Alignment amendment: all right-side tools share a fixed centerline (42 points from the right edge). No sideways shift. Contextual panel expansion reserves vertical space for the full rail; full-page My Plan is unchanged. Water/NYC validation unchanged. This amendment supersedes conflicting earlier control/radius wording.

Step 5 clarification: horizontal source-pin swipes choose categories; hold ~0.3 seconds then drag places a pin. Handle-only compact/medium/full transitions keep content scrolling separate. Full panel hides map controls; collapse restores their original right-side centerline. Place-scoped posts remain in the current panel. Media/reviews remain integration gates; no fabricated rating values.

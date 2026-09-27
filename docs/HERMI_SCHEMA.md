# Hermi unified design schema

Revision 2 · 2026-09-26 · Confirmed product decisions consolidated. Initial gallery composition rejected; map-first revision 01b is under review.

## Authority and mission

Hermi encourages going outside, discovering places with friends, and meeting new friends. The name draws on Hermes and the hermit crab: coming out of your shell. Use `Hermi` in prose and an exploratory lowercase `hermi` wordmark. The existing rock-stack Score remains confirmed; the name change does not replace it with a new reward system.

This schema consolidates the user's decisions, `../../Unified Truth.pdf`, and confirmed Miro details. It is the frontend implementation reference. Explicit user amendments take precedence, followed by the PDF, then consistent Miro detail. The local `../../My First Board.pdf` is the user's Miro layout export and must be visually inspected when composing screens. `../../map visual/images.jpg` and `pixel-europe-map-stockcake.jpg` supply aesthetic inspiration. Miro's older activity types and star ratings do not override the PDF's seven categories and binary verified reviews. Backend code defines available integration, not desired product behavior. Existing prototype code establishes no requirements.

Each future change must name its requirement below. A conflicting product request becomes a recorded amendment before implementation. Do not add features simply because an API supports them. DeepSpace is excluded by PDF pages 32, 36 and 45.

## Confirmed invariants

| ID | Rule |
| --- | --- |
| AUTH-01 | Explain → taste choices → Apple sign-in → school verification → profile setup → Home. Verification is mandatory; no skip or guest product entry. Restore the first incomplete step. |
| NAV-01 | Home has Feed / Map / Profile; Map is initial. Switch by tapping the pill, never by swiping panels. Hide the pill during map movement/feed paging and restore about 300 ms after motion ends. |
| NAV-02 | Action mode has Directions / Camera only, entered through Start or Head out. End leads to Recap; Post or Later leads Home. Feed is unavailable during Action. |
| SHEET-01 | One sheet system supports peek, half, full, dismiss, and nested back. Peek leaves the map interactive. Dismiss preserves map and draft. |
| MAP-01 | Real NYC geography with sparse labels, low-resolution terrain, crisp sprites and attribution. Solo initially; social data represents permitted check-ins/plans, never live friend tracking. |
| MAP-02 | Categories are Food, Shopping, Nature, Culture, Drinks, Sports, Music. All is a filter. Age eligibility affects adult venues. |
| PLAN-01 | Drop pin → inspect nearby places → select place → Add. Only Add inserts an explicit destination. Discovery, empty results, cancel, and errors never insert a placeholder. |
| PLAN-02 | A plan requires one or more explicit places and has no product maximum. Zero-item local editing is an empty state; Save/Start require a place. Legacy server slots are a compatibility error, not ready destinations; preserve their data. |
| PLAN-03 | Timing warnings are advisory. Proceed, edit manually, or revise with supported AI. Preserve stop IDs, per-leg modes and stay-source semantics. Overall mode changes follow the server contract. |
| AI-01 | Suggestions remain provisional until accepted. Show supplied source links. Discard responses that refer to an obsolete draft. Never silently apply an AI edit. |
| SOCIAL-01 | Save visibility: just me, invited friends, all friends, find someone. Open matching requires verified users, public venues and host approval. Friendship requires in-person pairing. No in-app DMs or remote friend requests. |
| LOCATION-01 | Ask permissions when needed. Denied location blocks tracked outings/GPS check-in. NFC at an event must remain possible with location denied; current backend conflict is tracked separately. |
| LOCATION-02 | Foreground-only permission permits starting with a clear limitation. OS suspension/permission loss may leave gaps; do not fabricate continuity. |
| TRACK-01 | Losing internet never ends an active outing. Durably retain original timestamped observations, including stationary observations, and actual motion/step data when available. Upload chronologically. Do not manufacture fresh points from an old fix. |
| TRACK-02 | Explicit End stops new location/motion recording immediately and preserves the actual local boundary and pending data. Verified recap/XP waits for backend processing. Accurate offline end-time support is a backend dependency. |
| TRACK-03 | After 60 stationary minutes away from a planned stop, ask “Are you still outside?” Continue or End are explicit choices. No response never auto-ends. |
| CHECKIN-01 | Only server-confirmed presence awards XP or unlocks verified review/public capture eligibility. GPS dwell, tag acceptance and cooldown are backend-authoritative. NFC-specific integration is tested late. |
| MEDIA-01 | Action camera: tap photo plus three seconds of ambient audio; hold video capped at 15 seconds. QR detection shares the viewfinder. In-app captures only; no camera-roll import for posts. Capture context is immutable. |
| MEDIA-02 | Captured → private pending upload → uploaded → verified/rejected → selected for post → moderation pending → live/rejected. These are distinct states. No public credential claim without backend evidence. |
| RECAP-01 | Route replay, new tiles and XP come from the server. Route card and best media per stop are deselectable. Post or Later; yes/no reviews and optional text are skippable. Screen actions award zero XP. |
| SCORE-01 | Score is rolling 30-day XP; exploration is lifetime. Show exact Score, seven-day delta, 30 bars, expiry and friend/campus ranks. No global rank. |
| SCORE-02 | Stone threshold n = 25*n*(n+1)/2. A downward threshold crossing can blow the top stone away. Unchanged refreshes and decreases within a threshold never replay removal. Preserve large counts rather than cap at 16. |
| FEED-01 | Finite vertically paged feed: verified photo/clip/review/recap cards and eligible open plans. Only active media plays; prefetch is not seen. Place and bookmark actions; no likes/comments. The end offers planning from Saved. |
| PROFILE-01 | Own profile: Score, explored map, Posts/Plans/Saved, private stats, editing and settings. Friends cannot see private traces, Saved or private people-most stats. A deliberately published recap route is separate from private trace access. |
| SAFE-01 | Report/block, ghost mode, open-to-plans, notifications and account deletion follow confirmed server state. Account switching cannot reuse another account's credentials, drafts or upload journal. |
| PREVIEW-01 | Sample mode is clearly labeled, deterministic and network-free. It cannot award XP, verify presence or mutate a live account. Visual acceptance and integration acceptance are separate. |

## Navigation and decision framework

Launch resolves authentication/onboarding first, then active session, pending finalization/recap, then Home. Retain a pending deep link through required onboarding; resolve only when authorized. An unavailable destination has a recovery screen rather than disappearing.

Every screen defines: user objective, entry, primary action, content order, state, API/device dependencies, back/cancel, persistence, accessibility and acceptance case. Every data surface distinguishes initial loading, loaded-empty, content, refreshing, failed and unavailable. A failed refresh preserves last confirmed content. Unknown hours and missing reviews remain unknown, not closed or 0%.

Home → discovery → place → Add → explicit plan → edit/schedule/save/share → Start → Directions/Camera → End → synchronization → recap → publish/review/Later. Parallel Home branches are finite Feed and Profile. Head out enters Action without a plan. Shared plans enter through auth-gated links or Social/Feed. NFC/personal tags have late device gates.

## Visual schema

### Confirmed correction: composition first

The user rejected the gallery-led interface for missing the board's form: “The 3 button pill. Map center visual. ... maximizing the visual not content/info/text.” Home must open as an edge-to-edge map with a floating Feed / Map / Profile pill at the bottom, Map centered and selected. Category discovery and Social controls sit along the right edge. There is no landing-page headline, tagline, horizontal category strip, persistent card or developer toolbar occupying the main map. Details are disclosed in a compact bottom sheet after interaction. My plan appears once planning/discovery begins; its content still contains explicit added places only. Testing controls move to a small preview menu; the old component gallery is a secondary lab, not the product landing screen.

Feed composition is media-first with a compact place/action overlay. Profile retains a large map area with compact identity/Score controls. These review shells do not imply that feed playback, pagination, historical stats or social integration have passed their later gates. Revision01b is corrective work within the first visual review, not acceptance of increments02–07.

Pixel-game treatment applies throughout custom UI: terrain, icons, sprites, large numbers/headings, card edges, controls, progress, charts and empty states. Preserve native gestures, scrolling, text input and system dialogs. Use readable system body text and inputs. Do not rasterize body text or permission dialogs. Use a restrained youthful palette with one dominant accent per component, ample quiet space, and no antique parchment/borders.

Initial review tokens: ink #243C37; paper #F8FAF3; green #447F65; lime #D5EB93; lake #86BAC7; coral #E58771; lavender #B4ADD6. Four-point spacing, minimum 44-point targets, 16–24-point gutters. Pixel sprites align to integer grids. All meaning remains available to VoiceOver and without color. Large text can scroll. Reduce Motion removes travel/bounce effects. Audio follows user/system preferences.

Use media placements from the beginning: photo, video poster/play affordance, avatar, route card, loading and failed media. An illustrated placeholder says it is sample media; it never pretends to be a verified real photo. Actual media plumbing follows the capture/feed increments.

Each reusable component includes applicable default, pressed, selected, disabled, loading and error states. Exact appearance is reviewed in increment 01. Later components reuse accepted tokens and primitives, with new creative decisions reviewed in their increment.

## Frontend architecture

SwiftUI on iOS, with a native Mac design preview and iPhone simulator/device testing. Keep the previously explored CairnKit prototype untouched unless a feature is being reviewed. The first accepted foundation is an isolated `apps/ios/HermiPreview` Swift package containing reusable HermiDesign and independent preview entry points; it has no dependency on the legacy store/network stack. Later accepted features can adopt this library incrementally.

Separate design system, navigation coordinator, feature state, typed repositories, device adapters, durable journals and sample scenarios. Feature models own UI state on MainActor; serialized actors own related writes/persistence. Internal models remain stable while backend adapters change. Optional values stay optional; invalid required fields produce a contract error. No silent zero/false fallback.

Use /v1 and typed Codable DTOs, error codes, bearer tokens in Keychain, ISO UTC timestamps and contract units. Cancel superseded reads. Check response generation/account/object before applying. Serialize writes to a plan. Disable duplicate in-flight actions. Reconcile ambiguous writes before retry. No unbounded retry or fake success. Keep credentials, tag secrets and precise routes out of logs.

MapLibre in WKWebView uses bundled/pinned scripts and styles, typed JSON messages and escaped data. Events: ready/failure, movement, bounds, marker selection, discovery drop. Native overlays remain crisp and accessible. Dynamic geofence selection respects iOS's monitoring limit without capping plan length.

Outing journals are account/environment/session-scoped, atomic and durable. Preserve raw observation times, local start/end, motion readings, upload progress and pending end/recap IDs. Upload batches <=500 in chronological order before server End. Never delete unacknowledged observations. Tracking belongs to session state, not a transient screen. Camera upload context binds bytes/hash/check-in/time/location once. Private originals and pending operations survive interruptions.

## Backend review and gates

Remote Hermi inspected at de17d60 (2026-09-26), read-only through GitHub. Local backend remains 3f546af; no pull/merge has occurred. Review the affected adapter against the latest agreed backend revision before live integration. Do not modify backend code.

Now implemented in remote source, still needing integration/configuration tests: ghost recommendations (v0.18), expanded AI asks (v0.19), matching (v0.20), C2PA signing (v0.21), profile photos/report review (v0.22), Photon iMessage payload (v0.23), reminders (v0.24), place-specific post grids (v0.25). Profile sprite generation and historical visit/recap lookup are not established by those additions. External messaging is a user-initiated handoff, not in-app DMs or autonomous sending.

Open gates: backend plan cap12 (defer to plan integration); NFC without location; offline End's true timestamp; GPS-to-tag upgrade vs cooldown; Head-out auto visits currently finalized only at End; historical check-in/recap recovery; native APNs vs Expo transport; real provider deployment and API URL; domain/signing/App Attest and real iPhone validation. Xcode 26.3, iOS/macOS SDK26.2 and simulator runtime26.3 are now installed, superseding the old “Xcode absent” blocker.

## Development and recovery

One active increment. Implement → automated verification → scoped local commit → runnable handoff → user feedback → fix commits → explicit acceptance → advance. Granular visual boundaries first; complete journeys later. User tests behavior and appearance; the agent tests state/contract boundaries. No backend changes, pushes, or merges to main. All frontend commits remain on codex/cairn-frontend until deliberately renamed. Current folder names are technical paths, not product branding.

Save files continuously. Record progress, known failures and exact next action in `PROGRESS.md` at meaningful checkpoints. Keep `test.md` as the user's entry point. Local commits preserve history but are not off-device backup. Never reset, clean or overwrite unrelated work to make a build pass.

Review feedback is pending until recorded; silence is not approval. Build success is not visual or device acceptance. Stable components retain regression coverage while later reviews become broader.

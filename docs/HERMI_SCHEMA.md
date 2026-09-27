# Hermi unified design schema

Revision 10 · 2026-09-27 · Step 5 accepted; Step 6 implemented for review.

## Authority and mission

Hermi encourages going outside, discovering places with friends, and meeting new friends. The name draws on Hermes and the hermit crab: coming out of your shell. Use `Hermi` in prose and an exploratory lowercase `hermi` wordmark. The existing rock-stack Score remains confirmed; the name change does not replace it with a new reward system.

This schema consolidates the user's decisions, `../../Unified Truth.pdf`, and confirmed Miro details. It is the frontend implementation reference. Explicit user amendments take precedence, followed by the PDF, then consistent Miro detail. The local `../../My First Board.pdf` is the user's Miro layout export and must be visually inspected when composing screens. `../../map visual/images.jpg` and `pixel-europe-map-stockcake.jpg` supply aesthetic inspiration. Miro's older activity types and star ratings do not override the PDF's seven categories and binary verified reviews. Backend code defines available integration, not desired product behavior. Existing prototype code establishes no requirements.

Each future change must name its requirement below. A conflicting product request becomes a recorded amendment before implementation. Do not add features simply because an API supports them. DeepSpace is excluded by PDF pages 32, 36 and 45.

## Confirmed invariants

| ID | Rule |
| --- | --- |
| AUTH-01 | Explain → taste choices → Apple sign-in → school verification → profile setup → Home. Verification is mandatory; no skip or guest product entry. Restore the first incomplete step. |
| NAV-01 | Home has Map / Feed / Profile, in that order; Map is initial. Switch by tapping the pill or holding/sliding horizontally within the pill and releasing. No global horizontal page gesture: map pan/zoom and vertical Feed paging remain independent. Hide the pill during map movement/feed paging and restore about 300 ms after motion ends. |
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
| FEED-01 | Finite vertically paged feed: verified photo/clip/review/recap cards and eligible open plans. Only active media plays; prefetch is not seen. Place action plus two stacked lower-right controls: bookmark saves for later, + explicitly adds the displayed place to the plan. Saving never adds; adding never silently saves; Add is a membership toggle: tap + to add, tap its selected check to remove. Toggling never changes Saved; no duplicate stops. No likes/comments. Camera/Create belongs exclusively to Go!/Action mode, not Feed. The end offers planning from Saved. |
| PROFILE-01 | Own profile: Score, two icon tabs only: Adventures and Posts. Adventures shows only own geographic route history. Its info icon opens visit counts (ascending), percentage of New York covered, steps, most/least visited borough and neighborhood. The account header has Friends | Score | Rank; Friends is the entry to friend profiles/routes. Posts is a three-column media grid; a tile opens its place’s own media/review and friends’ posts/reviews if available. Saved belongs in Plan, not a third Profile tab. Private stats, editing and settings remain separate. Friends cannot see private traces, Saved or private people-most stats. A deliberately published route is separate from private trace access. Adventures provides Private/Friends/Everyone sharing controls, private by default; publishing requires explicit user action and backend confirmation. |
| SAFE-01 | Report/block, ghost mode, open-to-plans, notifications and account deletion follow confirmed server state. Account switching cannot reuse another account's credentials, drafts or upload journal. |
| PREVIEW-01 | Product fixtures are clearly labeled and deterministic. The geographic preview may fetch public OpenFreeMap tiles; no Hermi account/backend requests or sensor access occur. It cannot award XP, verify presence or mutate a live account. Visual acceptance and integration acceptance are separate. |

## Navigation and decision framework

Launch resolves authentication/onboarding first, then active session, pending finalization/recap, then Home. Retain a pending deep link through required onboarding; resolve only when authorized. An unavailable destination has a recovery screen rather than disappearing.

Every screen defines: user objective, entry, primary action, content order, state, API/device dependencies, back/cancel, persistence, accessibility and acceptance case. Every data surface distinguishes initial loading, loaded-empty, content, refreshing, failed and unavailable. A failed refresh preserves last confirmed content. Unknown hours and missing reviews remain unknown, not closed or 0%.

Home → discovery → place → Add → explicit plan → edit/schedule/save/share → Start → Directions/Camera → End → synchronization → recap → publish/review/Later. Parallel Home branches are finite Feed and Profile. Head out enters Action without a plan. Shared plans enter through auth-gated links or Social/Feed. NFC/personal tags have late device gates.

## Visual schema

### Confirmed correction: composition first

The user rejected the gallery-led interface for missing the board's form: “The 3 button pill. Map center visual. ... maximizing the visual not content/info/text.” Home must open as an edge-to-edge map with a floating Map / Feed / Profile pill at the bottom, Map at left and initially selected. Category discovery and Social controls sit along the right edge. There is no landing-page headline, tagline, horizontal category strip, persistent card or developer toolbar occupying the main map. Details are disclosed in a compact bottom sheet after interaction. Plan (notched chevron) and Social are permanent upper-right controls, including before any pin is dropped. Plan includes Saved and explicit added destinations; saving alone never adds a destination. Testing controls move to a small preview menu; the old component gallery is a secondary lab, not the product landing screen.

Feed composition is media-first with a compact place/action overlay. Profile retains a large map area with compact identity/Score controls. These review shells do not imply that feed playback, pagination, historical stats or social integration have passed their later gates. Revision01b is corrective work within the first visual review, not acceptance of increments02–07.

### Revision 01c: geographic map and corrected controls

User's six corrections: (1) continuous geographic pan in both axes and zoom in/out, not moving a bounded illustration; (2) shared pixel geometry for pins and action icons; (3) map/media backgrounds extend behind system safe areas with controls kept reachable; (4) compact colored ballpoint pin, hold ~300ms for selection haptic, vertical slide temporarily reveals categories, release commits choice, hold/drag horizontally onto map drops at the projected coordinate; (5) Adventures and Posts icon tabs, three-column post grid and place-specific modal, Saved within Plan; (6) permanent upper-right Social and Plan controls. Default Adventures. VoiceOver supports category adjustment without a drag. Simulator cannot establish physical haptic quality.

Clarification: remove friends maps from own Adventures. Friends is accessed from the account header. Social mode on Home Map includes past places, planned/wanted places and ongoing-trip status. Ongoing status does not establish permission for live location tracking. Confirmed privacy amendment: completed routes/places are private by default and shared only by user choice. Profile Adventures has a persistent left-side Social/sharing icon opening Private / Friends / Everyone (public). Friend views and Social must respect this audience; an ongoing trip status does not expose live coordinates. The preview saves only a local audience preference and never publishes. Friends currently has a no-data state. Sample own routes are explicitly marked, never claimed to be recorded GPS. Real profile history/media/review aggregation depends on backend integration.

Pixel-game treatment applies throughout custom UI: terrain, icons, sprites, large numbers/headings, card edges, controls, progress, charts and empty states. Preserve native gestures, scrolling, text input and system dialogs. Use readable system body text and inputs. Do not rasterize body text or permission dialogs. Use a restrained youthful palette with one dominant accent per component, ample quiet space, and no antique parchment/borders.

Step 2 review tokens: ink #203D39; paper #F8FAF3; green #23856B; lime #BFDE59; lake #69B7CC; coral #EF8067; lavender #A596DD. SwiftUI and the geographic web renderer share these tokens from HermiPalette; category colors use the same source. Four-point spacing, minimum 44-point targets, 16–24-point gutters. Pixel sprites align to integer grids. All meaning remains available to VoiceOver and without color. Large text can scroll. Reduce Motion removes travel/bounce effects. Audio follows user/system preferences.

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

## Revision 01c implementation dependencies

The MapLibre 5.6.0 JS/CSS renderer and license are bundled locally. Public geographic tiles come from OpenFreeMap; renderer pixelRatio 0.5 and nearest-neighbor canvas display provide low-resolution terrain while custom native/web pins share the same pixel matrix. This is no longer a network-free map preview. Sample place coordinates remain explicitly labeled fixtures and are filtered within 1.5km of a geographic discovery pin; public tiles do not supply Hermi recommendations or verified venues. Sources: https://openfreemap.org/quick_start/ and https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/.

Backend gates for the clarified Profile/Social remain: own timestamped route history; enforcement of private/friends/public route audience; past/planned/wanted/ongoing friend activity and permissions; place-scoped own/friend posts and reviews; visit counts; actual steps; agreed NY coverage denominator; borough/neighborhood aggregation and tie/empty-state semantics. Display unknown values as unavailable, never invented statistics. No backend code changed.

## Revision 01e: confirmed interaction amendments

- Feed: separate bookmark/save and +/plan-membership toggles; finite vertical paging, no likes/comments or camera entry. Feed Social filters friends/public without navigating to Map.
- Navigation: long hold on the bottom pill previews a destination; slide left/right and release to select. Gestures originating on map or Feed do not switch Home panels. This explicitly supersedes the previous tap-only invariant.
- Control explanations: desktop hover help; mobile long hold reveals a description without executing the short-tap action. Controls that already use hold (category, pill, reorder, eventual camera shutter) provide guidance within that interaction rather than replacing it with a competing gesture. Accessibility names/hints and reorder actions remain available.
- Plan: full page with collapsible state; editable per-place arrival/stay/reminder preferences along left timeline; hold/drag places to reorder by stable place identity; place tap opens the same detail view and Back restores its source. Timing warnings remain advisory. Saved is a separate page toggled by the Plan bookmark, grouped by category; Save never inserts a stop.
- Stop ellipsis: confirmed attendees plus invite-existing-friends flow. This is consistent with in-person-established friendship; it does not authorize remote friend requests or in-app DMs. Preview invitees are draft-only, distinct from confirmed attendees.
- Go!: requires an explicit nonempty plan. The local review exposes Directions/Camera-only Action layout; no real trip is started. End preview returns to Plan. Real Start/End, recap, camera permissions/capture and notifications remain future integration gates. Product End still follows NAV-02/TRACK-02, not the preview shortcut.
- Notifications/reminders requested: editing a reminder preference alone is not delivery. Real implementation must handle permission states, schedule/update/cancel by stable stop ID, timezone changes, stale reminders on reorder/removal, and backend/device duplication before enabling delivery. Current preview schedules none.


## Approved revision plan — 2026-09-27

The user approved [the incremental implementation plan](FRONTEND_IMPLEMENTATION_PLAN.md). Its current decisions supersede conflicting historical revision notes above. Implementation and acceptance are separate: the user authorized Step 2 while phone setup and Step 1 touch review remain pending.

- NAV-01 amendment: Map / Feed / Profile; quick release activates once, stationary hold explains without navigating, hold-and-slide selects a different segment on release. Releasing outside the pill cancels. Hold help persists briefly after release. Map/Feed gestures outside the pill never switch tabs. Each navigation button has a 64×48-point rectangular hit area, semantic button activation and selection traits.
- Visual amendment: brighter unified pixel palette, full-screen map/media, no user-facing top-left wordmark. These changes belong to Step 2.
- Discovery amendment: multiple geographic pins (including repeated categories), land-only NYC placement, independent optional citywide category filter; combine matches by union and deduplicate place IDs. Pins include category icons, with one extra floating category indicator per visible category. Tap a placed pin to edit its radius and expose an X; X deletes. This supersedes tap-to-delete. Radius is 0.1–4 miles, logarithmic, initial 1 mile (not midpoint); independent of zoom. Placed pins remain draggable.
- Sheets: native compact/medium/full presentation, X dismisses place details, contextual place Feed stays in the sheet rather than changing the main tab.
- Plans: explicit places only, nonempty to start, no product maximum. Save Plan opens name/folder/visibility inputs for a new plan; saved plans autosave edits and support Undo. Friends means selected existing friends and explicit Save & invite; autosave never resends invites. Public distribution must wait for a matching backend contract. Stable plan and stop IDs own scheduling state.
- Saved: mixed-content folders, separate horizontal drawer toggle in Plan, plus adds linked places or appends saved itinerary stops in order. Skip already-present places; unlocated images remain inspiration until tied to an explicit place. Saving is independent of plan membership.
- Feed: bookmark saves content and plus toggles active-plan membership. Social switches Friends/Public. Feed chevron filters plans/adventures instead of opening My Plan. Numerical ratings await backend schema; create the requested backend issue, do not implement rating prompts/schema now.
- Profile: Settings gear and Saved bookmark. Sharing/privacy controls move into Settings; live visibility is verified check-in presence, not continuous GPS. Own post detail excludes friends' content. Own Adventures remains own routes; friend routes require opt-in sharing.
- Go!/Action: accessible from a nonempty Plan, Directions/Camera only. Location denial blocks tracking/GPS check-in; NFC alternative remains required and tested last. No fake live capability.

Backend gaps, persistence defaults, checkpoint order and screenshot acceptance are recorded in the implementation plan. No later checkpoint is authorized to bypass user testing just because its code compiles.


### Step 2 review amendment

The user authorized progressing to Step 2 because Mac interaction testing is difficult. This is authorization to implement, not evidence that Step 1 gestures passed on a physical phone. Keep both checklists pending until reviewed. The default top-left preview menu/wordmark is removed; developer controls are available only in a Debug launch with `--hermi-lab`. Attribution and honest sample-data notices remain visible. Existing shared pixel glyph geometry is preserved; Settings glyph is prepared for the later Settings checkpoint. Pin interior/category behavior still belongs to Steps 3–4.

## Step 3 implementation checkpoint (2026-09-27)

The isolated preview now implements a single persistent geographic discovery pin with an internal category glyph, drag/move, radius editor and explicit X removal. Radius uses miles (0.1–4, logarithmic, initial 1), independent of map zoom. NYC land/water validation rejects invalid placements without deleting a valid existing pin. Replacing one pin is a temporary checkpoint behavior, not a product limit: multiple pins, citywide/geographic union filters and one floating indicator per visible category remain Step 4. No live discovery, tracking or backend capability is implied. Tests and physical-device acceptance remain distinct; see test.md.

## Step 3 feedback amendment — 2026-09-27

User supersedes the prior editor layout: recommendations use small category-colored dots; only discovery uses a pin. Tap empty map deselects without deleting the pin or recommendations. Selected pin exposes a small attached X and a background-free bottom-right radius slider above zoom/home. Those controls track compact/expanded panel height. Visual backgrounds shrink while touch targets remain. Direct vertical swipes on the source pin choose category with no menu; name below, decorative pixel chevrons at either side. User confirmed minimum 0.1 mile and retained maximum 4; default remains 1 mile. Remove sample-place map banner; fixture status remains documented in the test guide. Alignment amendment: all right-side tools share a fixed centerline (42 points from the right edge). No sideways shift. Contextual panel expansion reserves vertical space for the full rail; full-page My Plan is unchanged. Water/NYC validation unchanged. This amendment supersedes conflicting earlier control/radius wording.

## Step 4 implementation checkpoint

Multiple geographic pins, including repeated categories, now persist as independent ID/category/coordinate/radius records. Legacy single-pin/coordinate snapshots migrate without changing valid IDs/radii or losing Plan/Saved data. Selection is transient; tap-away never deletes pins. Citywide category is independent of the source category being previewed: tap replaces or toggles the citywide choice, while swiping only chooses the next source pin. Matches are the union of citywide category and each pin's category/radius, deduplicated by place ID. No filters means general discovery.

Only one extra category glyph appears above a visible discovery pin in each category; the representative remains stable while visible and transfers when it leaves the unobscured map. Small category-colored dots represent recommendations. Step 3 fixed right-hand alignment and 0.1–4-mile range remain unchanged. Real backend recommendation completeness is not implied by these local fixtures.

## Step 5 confirmed amendments and checkpoint

Horizontal left/right swipes on the source pin choose category, superseding earlier vertical-swipe instructions. User explicitly selected hold (~0.3 seconds) then drag for placement, distinguishing it from a quick category swipe. A quick tap continues toggling the citywide category.

Contextual panels have compact/medium/full heights, independent of their place/nearby route. Handle gestures resize; vertical content and horizontal post media scroll independently. User confirmed map controls hide at full height and return on the same fixed right-hand line when collapsed. Full My Plan remains a separate route. A place popup closes with X; it does not navigate to the main Feed. Place-scoped fixture posts never include another place's IDs. Real media/reviews remain unconnected and no rating scale is invented.

## Step 6 implementation checkpoint

The local active plan stores optional arrival/stay/reminder values and sample invite drafts alongside its ordered explicit place IDs. Existing preview drafts migrate once on Plan entry. Reordering keeps metadata with the stop; removing a stop clears only its metadata and leaves Saved unchanged. This single-plan fixture still uses unique place identity; future multiple saved plans require plan/stop-scoped IDs before integration.

Timing overlap/backwards warnings remain advisory and do not disable Go. Times are optional; one or more valid explicit stops are required for Go. No travel-time estimate or AI timing repair is implied. Go enters the existing Directions/Camera preview, whose stop list follows plan order; ending returns to Plan. No tracked outing, camera capture, reminder scheduling or invitations are enabled. A place opened from Plan or Saved closes with X back to its source, superseding old Back-button wording.

# Hermi UI round 2 implementation plan

2026-10-12 · Active · 15 increments (R2.00–R2.14); R2.01 rendered on macOS, awaiting user review. iPhone verification remains unavailable.

## Scope and authority

Refine the recent implementation on `design/curated-ui-refresh`, starting from `8106846` or its subsequent documentation commits. Recheck branch, HEAD and working tree before starting. Preserve the approved brand work and round 1 changes; do not restart from the historical round 1 base.

Follow `HERMI_SCHEMA.md`, its latest amendments, and explicit user instructions. Preserve map-first composition, ordinary tap navigation, fixed right-hand controls, native rounded reading typography, pixel artwork, independent Save/Add semantics, stable plan identity, advisory warnings, provisional AI edits, privacy boundaries and truthful preview states. Reuse the currently approved shared crab exactly as implemented. Do not resolve conflicting historical mascot descriptions by changing its artwork.

This plan responds to the second-round critique. The user has authorized implementation one increment at a time. No backend expansion, publishing, push, merge, external messages or new dependencies are authorized.

## Evidence and priorities

The critique reviewed recent source and recorded October 12 renders. Fresh current-build interaction acceptance remains incomplete: the open desktop app came from Cairn; the Hermi macOS target built, but Launch Services failed and direct execution failed during the review. An existing Simulator Plan was inspected without establishing its exact revision; later UI calls timed out. Round 1 test results and screenshots remain historical evidence.

| Finding | Evidence class | Priority |
| --- | --- | --- |
| Feed line limits can hide text below the 150-character disclosure threshold | Confirmed source logic; missing rendered reproduction | P1 |
| Plan devotes separate regions to disabled Undo and reorder instructions | Recorded compact render and source | P1 |
| Compact Place shows incomplete post content below its larger header | Recorded long-title render | P1 |
| Saved large-text cards remain in two columns | Source-supported risk; populated render pending | P1 verification, P2 correction |
| Saved repeats its page title | Recorded empty render and source | P2 |
| Expanded Nearby retains a small horizontal carousel | Recorded render and source; sparse fixtures contribute | P2 |
| Profile has fixed top overhead and a notice overlapping map info | Recorded render and source | P2 |
| Plan-shaped control opens Plan on Map but filters Feed | Confirmed role ambiguity; user impact unmeasured | P2 |
| In My Plan toggle does not visibly explain removal | Contextual tradeoff; user impact unmeasured | P2 |
| Assistant category choices show rounded outer chrome around pixel surfaces | Confirmed macOS appearance; iPhone unverified | P3 conditional |
| Place/Feed/Profile imagery is dominated by placeholders | Observed fixture limitation; engagement unverified | P1 evidence |

P1 resolves content access or acceptance gaps. P2 improves task clarity and composition. P3 proceeds only after reproducing the issue on the target platform. Predicted engagement and retention benefits require user evidence.

## Execution and commit rules

Work on one increment at a time. Each implementation commit must build, have scoped verification, and be independently reviewable. Commit only named files for that increment; exclude unrelated `.DS_Store` files. Never use broad staging, reset, clean or discard to obtain a clean tree.

For each increment: capture before, make the smallest coherent change, run appropriate checks, render and exercise it, then commit with evidence. Record requirement IDs, commit, exact viewport/platform/text size, preview/live mode, results and limitations in the existing `PROGRESS.md` and a per-increment `REVIEW.md`. Store round 2 evidence under `docs/frontend/design-reference/2026-10-12-curated-ui-round-2/` when execution begins. Update `test.md` to point to the active handoff.

Open a runnable preview and give concrete test steps after each increment. The existing project workflow requires explicit user approval before starting the next increment. A fix to the active increment can be a separate commit before re-review. Silence is not approval. A unavailable rendering environment permits preparatory work but cannot close a visual gate; do not advance merely because a build passes.

Suggested commit messages below are boundaries, not a requirement to produce empty commits. Split a genuine regression correction from unrelated styling. Evidence may accompany its code commit; use a separate docs commit when capture arrives later. Do not add tests that merely assert styling constants.

## Increment sequence

### R2.00 — Restore current-checkout launch and establish the baseline

**Files:** existing macOS/simulator launch scripts and `Sources/HermiDesktop/main.swift` only if diagnosis warrants changes; evidence and progress documents.

Reproduce launch failures, distinguish bundle/executable problems from environment permissions, and use the existing launch mechanisms. Avoid global OS changes. Record the checkout revision, executable origin and launch arguments so an older Cairn process cannot count as Hermi acceptance. Build and render the current target at an ordinary and constrained size. Capture the primary journey before changing layouts.

**Acceptance:** current Hermi build identified; Map → place → Add → Plan exercised; baseline includes long-title Place, Plan, Saved, Feed and Profile. State missing device checks explicitly.

**Commits:** `fix: restore current Hermi preview launch` only if a repository defect exists; `docs: capture Hermi round 2 baseline` for evidence. Environment-only blockers get a documented diagnosis, not speculative script rewrites.

### R2.01 — Make review fixtures deterministic

**Files:** DEBUG fixture setup in `HermiMapPreview.swift`, existing scenario list and relevant fixture/state tests.

Diagnose why populated Saved was cleared. Ensure empty, populated, long-name and folder scenarios survive initialization without touching normal persisted data. Cover shorter captions that overflow at large text, missing media, many stops and long profile names using existing fixture paths. Keep all account APIs and sensors inactive in fixtures.

**Acceptance:** repeated fixture launches yield the same intended content; normal launch retains the user's state; populated Saved and a folder can be inspected. Add a focused test only for the initialization/persistence boundary actually changed.

**Commit:** `fix: make Hermi review fixtures deterministic`.

### R2.02 — Restore complete Feed text access

**Files:** `FeedPager.swift`, `LiveFeedPager.swift`, existing `FeedCaptionSheet` definition.

Remove character-count gating as the sole way to access text. Recommended initial solution: provide a quiet full-text action for each nonempty caption/description where the card limits lines. This avoids uncertain text measurement. An overflow-only action is an alternative if native measurement proves reliable across text sizes without introducing layout loops. Keep the existing sheet, paging and action placement.

**Acceptance:** captions shorter than 150 characters, long text, wide glyphs and accessibility sizes remain fully accessible; close returns to the same page; Save/Add and finite Feed completion remain correct. Live presentation uses the same rule; fixture verification is not live acceptance.

**Commit:** `fix: keep full Feed captions accessible at every text size`.

### R2.03 — Give Place detents intentional content

**Files:** `HermiMapPreview.bottomSheet`, `PlaceDetailHeader`, `PlaceSheet.swift`, place-feed presentation only as needed.

Compare two actual compositions with the same long title and content: fixed peek showing identity/actions with explicit expansion, versus a content-adaptive height that accommodates the header. Recommend fixed peek with complete groups and scroll/expansion for additional content, unless measured header height makes essential actions inaccessible. Do not expose a lone author or half post control as the settled bottom of peek. At accessibility sizes stack actions when required and allow complete scrolling.

**Acceptance:** short/long titles at peek/medium/full; actions reachable above navigation; complete group boundaries; close restores Map/Nearby/Plan/Saved source; Save and Add remain independent; expanding does not lose selection or draft.

**Commit:** `fix: keep Place details complete across sheet sizes`.

### R2.04 — Reduce Plan utility overhead

**Files:** `PlanPreviewPage.swift`, its reading-scroll helper; shared tokens only if reuse is justified.

Group Undo with header utilities instead of giving disabled Undo a separate large region. Show reorder guidance only for two or more stops; keep a discoverable accessible help action. Preserve saved-plan identity and My draft access. Rebalance spacing using existing 4/8/12/16/20/24-point roles; preserve body and metadata sizes. Measure the scaled time column before changing its width. Avoid introducing another persistent instruction panel.

**Acceptance:** empty, one-stop, many-stop, warning and long-name plans; Saved row open; AI suggestion present; default and accessibility text. More useful itinerary is visible without smaller text. Go stays reachable, warnings remain advisory, and editing/reorder/Undo preserve stop metadata.

**Commit:** `style: prioritize the itinerary in My Plan`.

### R2.05 — Remove duplicate Saved page hierarchy

**Files:** `SavedGrid.swift`, owning header in `PlanPreviewPage.swift`.

Make the page container own the Saved title. Keep item count, New folder and folder path in the collection. Preserve the crab empty state and existing bookmark behavior.

**Acceptance:** Saved entered from Plan and Profile has one primary title; folder name/back/count remain distinct; zero-item and populated states have coherent reading order.

**Commit:** `style: give Saved one page heading`.

### R2.06 — Adapt Saved to reading width

**Files:** `SavedGrid.swift`, `SavedThumbnail` only if layout requires it.

Render populated long-content fixtures first. Compare a single-column card with a thumbnail list at constrained/large-text sizes. Recommend thumbnail list when it improves title measure and mixed-item scanning; retain the existing grid at ordinary sizes. Choose the transition from available width and text size, with one clear layout rule. Keep contextual actions and explicit Add semantics.

**Acceptance:** mixed places/posts/plans, long folder titles, unavailable references, empty folders and accessibility sizes. No clipped badges/actions; open does not Add; appending an itinerary stays ordered and duplicate-safe; folder operations do not alter membership or visibility.

**Commit:** `style: adapt Saved collections for large text`.

### R2.07 — Make expanded Nearby useful

**Files:** `HermiMapPreview.nearbyContent` and panel-level presentation.

Retain horizontal browsing in peek. Use a vertical list or adaptive grid in medium/full with real available context and consistent alignment. Start with a list for text comparison; keep imagery if real fixtures support it. Unknown distance/hours remain unknown. Preserve filter unions, selected-pin scope and deduplication.

**Acceptance:** zero, one and many results; long names; every detent; category filtering stays on Map; opening/closing Place returns correctly; no accidental Add; full height adds useful content instead of only whitespace.

**Commit:** `style: use expanded Nearby space for result browsing`.

### R2.08 — Distinguish Feed filtering from Plan navigation

**Files:** Feed controls in `HermiMapPreview.swift`, existing `PixelIcon` glyph definitions only if necessary.

Preserve Map's Plan glyph. Choose a distinct established filter/content glyph for Feed and position a compact visible state label near its control using the existing Public/Friends and content state. Avoid a new permanent Map label. Keep audience and content filters independent.

**Acceptance:** Map control opens Plan; Feed control changes content without opening Plan; all filter combinations retain correct state; accessible names match visible vocabulary; controls remain at least 44×44 points.

**Commit:** `style: distinguish Feed filters from My Plan`.

### R2.09 — Rebalance Profile and clear map notices

**Files:** Profile presentation in `HermiMapPreview.swift`, actual corresponding live presentation if separate.

Replace fixed 135-point top overhead with safe-area/tool-aware layout. Preserve labeled Adventures/Posts tabs and metric actions. Reduce tab surface mass only if it improves hierarchy in rendered comparisons. Position the sample-route notice away from the info button and bottom navigation. Keep private route and own-post boundaries.

**Acceptance:** long identity, missing metrics, Adventures/Posts, default/large text, compact phone. Map/history has more room; tools and notices never overlap; metric/detail sheets and return preserve state. Do not fabricate metrics or public sharing.

**Commit:** `style: give Profile history more room`.

### R2.10 — Clarify planned-place reversal

**Files:** `PlaceDetailHeader` and its shared action labels.

Compare current “In My Plan” with a concise explicit removal label, using the same selected state. Recommend “Remove from Plan” with a check/state cue if it fits clearly; use a stacked or adapted action layout when needed. The change must preserve immediate reversible toggling. If review favors the existing label, record the tradeoff and omit a code commit.

**Acceptance:** sighted and VoiceOver users can identify membership and the next tap's effect; removal leaves Saved unchanged; repeated taps do not duplicate stops; all label states fit.

**Commit if selected:** `style: clarify removal from My Plan`.

### R2.11 — Correct Assistant chrome only if reproduced on iPhone

**Files:** category-picker button style in `PlanAssistantView.swift`.

Inspect native iPhone first. If rounded/shaded outer controls compete with pixel panels, use one shared pixel surface and plain/native pressed feedback. Preserve category colors, labels and two-column accessibility layout. This P3 increment may be closed with evidence and no source change.

**Acceptance:** seven distinct readable choices, 44-point targets, visible pressed feedback, sensible VoiceOver order; no category-request or provisional-apply changes.

**Commit if needed:** `style: unify Assistant category button surfaces`.

### R2.12 — Review realistic imagery and media failure states

**Files/assets:** existing media renderers, Place/Feed/Profile/Saved thumbnails, existing owned photo/video assets and fixture manifest.

Use representative owned place photos, actual captions and permitted route/media samples. Verify provenance before including assets. Add local-only fixture assets only where their reuse is permitted; do not claim fixtures are actual user activity. Inspect crops, focal points, aspect ratios, image quality, caption contrast and loading/error states. Keep useful actions available when media fails. Split a crop/asset correction from a behavior correction if both are necessary.

**Acceptance:** bright/dark/detailed images, portrait/landscape, missing/failed media and long captions. Real content supports the established palette; placeholders do not look verified; full content/actions remain accessible. Engagement remains a hypothesis.

**Commits as needed:** `test: add representative owned media review fixtures`; `fix: preserve useful content when media fails`; `style: refine Hermi media crops`. Do not create these commits without a demonstrated need.

### R2.13 — Close accessibility and motion gaps

**Files:** only components with reproduced defects; existing shared controls and motion implementations.

Measure actual text/background pairs, including translucent overlays and selected states. Inspect VoiceOver reading order/actions, keyboard avoidance, touch targets, text scaling and non-color cues. Exercise reduced motion and interrupted sheet/assistant/brand transitions. Keep introduction skip and repeat-use behavior. Do not add decorative motion. Use separate small commits per reproduced defect rather than a broad audit refactor.

**Acceptance:** text contrast at least 4.5:1 for ordinary text and 3:1 for large text; primary controls remain reachable at accessibility sizes; no focus traps or obscured keyboard actions; reduced motion retains meaning; interrupted transitions settle; physical haptics/performance remain pending until device-tested.

**Commit pattern:** `fix: <specific reproduced accessibility or motion defect>`.

### R2.14 — Reconcile and record final acceptance

**Files:** evidence ledger, `PROGRESS.md`, `test.md`; narrowly scoped regression fixes if needed.

Repeat the complete local journey on the accepted build. Reconcile preview/live presentation where account access exists. Check first impression, voluntary exploration and repeated-use efficiency separately. Record unresolved integration dependencies and user review. No automatic publishing or merge.

**Acceptance:** no unresolved hidden content, clipping, blocked primary action, misleading status or brand regression in tested states. Full Swift tests and required bridge checks pass. Production acceptance remains separate from local visual acceptance.

**Commit:** `docs: record Hermi round 2 acceptance and remaining gaps`.

## Dependencies and verification

Execute R2.00 → R2.01 → R2.02 → R2.03 → R2.04, then collection and secondary-surface increments in order. R2.12 needs permitted representative assets; R2.11 needs iPhone evidence. R2.13 checks occur within every increment as well as at the end. R2.14 depends on all applicable gates. Findings disproved by current renders should be closed with evidence rather than implemented.

No new package dependencies are planned. Keep `HermiTypography`, `HermiSpacing`, `HermiPalette`, `PixelPanel`, shared icon geometry and current mascot. Change semantic tokens only when multiple rendered components demonstrate the same problem. Reuse existing licensed map/media infrastructure. Production service/sensor checks require a configured account, device and existing backend capability; do not fabricate them or silently expand this design scope.

For layout changes, build the relevant target, inspect before/after at default and accessibility XXXL text, and exercise affected controls. Use 375×667, 390×844 and 430×932 point layouts; record actual device dimensions rather than treating a Mac window as an iPhone. Check keyboard open, long names, empty/populated/error and interrupted states where applicable.

From `apps/ios/HermiPreview`, run `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox` for changed state boundaries and at final acceptance. Run `node scripts/test-map-bridge.cjs` if renderer/bridge contracts change. Use existing build/preview scripts and `git diff --check`. Do not repeat a passing broad suite without new edits or a remaining concern. Record tests run now separately from round 1's historical 118-test result.

## Open acceptance limits

Current-build native launch and hands-on journey, populated Saved, target-size matrix, native Dynamic Type, VoiceOver, physical touch/haptics, actual-image contrast, assistant keyboard/cancellation and motion feel remain open. Authenticated feed/profile, permission denial, offline outing recovery, verified check-in, capture/upload and production recap require separate live evidence. The plan does not claim these have passed.

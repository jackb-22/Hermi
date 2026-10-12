# Hermi curated UI implementation plan

2026-10-12 · Status: increment 1 implemented and desktop-verified; awaiting user review. Native iPhone verification pending.

User review gate: after every increment, open a preview for hands-on testing, give specific test instructions and expected results, and wait for explicit approval before beginning the next increment. See the [increment 1 checkpoint](design-reference/2026-10-12-curated-ui/01-typography/REVIEW.md). The user authorized proceeding from the baseline on October 12; native iPhone checks remain pending.

## Objective and authority

Improve typography, composition, and interaction clarity while retaining Hermi’s native, map-first identity. Prioritize the journey from discovering a place to adding it to a usable plan. This is a refinement of the approved direction, not a new brand or feature expansion.

[`HERMI_SCHEMA.md`](HERMI_SCHEMA.md) remains the product authority. Use the approved shared crab from `HermitBrand.swift`, including its Empire State Building shell and Statue of Liberty torch. Preserve its orientation and appearance. Keep one mascot per composition, avoid repeated slogans, and reuse existing ballpoint pins, pixel icons, and native rounded typography. Do not introduce another font family, asset library, frontend framework, or backend capability.

Implementation must start from `3ed866a291f2953cb7ceecfefeab391ee90ebec7` on `fix/approved-hermi-brand`, which includes the approved brand fixes. GitHub `main` was checked on October 12 and remains at `19d50fd869d7b6708df1a11c8ed5fb3be7e7f0f3`; starting from main alone would omit those fixes. Recheck repository state before implementation. Keep unrelated `.DS_Store` files out of commits.

## Evidence and limits

Inspected source includes `DesignSystem.swift`, `HermitBrand.swift`, `HermiMapPreview.swift`, `MapControls.swift`, `PlaceSheet.swift`, `PlanPreviewPage.swift`, `SavedGrid.swift`, `PlanAssistantView.swift`, and the preview/live feed implementations under `apps/ios/HermiPreview/Sources/HermiDesign`.

Inspected rendered evidence:

- [September 27 Plan screen](design-reference/2026-09-27-aesthetic/plan.png).
- [October 8 empty Plan screen](design-reference/2026-10-08-brand/empty-plan.png).

These are historical captures. Simulator inspection timed out on October 12; no fresh interactive device inspection was completed. Treat the observations below as source and historical-render findings until increment 0 supplies a current baseline.

| Finding | Evidence | Proposed response |
| --- | --- | --- |
| Schedule metadata is difficult to read | Plan uses 9-point date/duration labels and a fixed 64-point time column | Semantic text sizing; adaptive time layout at large text sizes |
| Long place names compete with actions | Place header has a single-line title alongside close, Save, and Add | Let the title wrap and give actions predictable space |
| Empty Plan has excessive overhead | Draft status and reorder help precede the empty state in saved captures | Show reorder instructions only when applicable; consolidate status |
| Some actions depend on discovering a hold | Plan bookmark opens Save options through a long press | Expose existing options with an explicit accessible control while preserving normal bookmark navigation |
| Assistant menus constrain large text | Two views cap Dynamic Type; category labels shrink | Reflow controls and allow scrolling instead of limiting text growth |
| Secondary surfaces vary in density | Small badges, truncated folder names, and dense feed overlays appear in source | Apply shared hierarchy after the primary journey is verified |

Baseline verification completed October 12: **116 Swift tests passed**, and all map bridge checks passed. This confirms the existing tested contracts, not visual or physical-device acceptance.

## Curated references and direction

Two sources from the curated skill register were inspected in the browser on October 12. Use their composition principles; do not copy their artwork or import their code.

| Reference | Observed detail | Principle and Hermi adaptation | User benefit |
| --- | --- | --- | --- |
| [Built by Designers](https://builtbydesigners.com/) | Narrow category rail, consistently aligned directory rows, small icons, light separators | Group through alignment and spacing rather than a border around every item. Apply to nearby results and Saved lists, retaining Hermi’s readable colors | Faster scanning with less visual clutter |
| [Matthew Yu](https://matthewyu.dev/) | One central sketchbook illustration, spacious background, quiet navigation | Let one authored visual carry the identity. Hermi’s map and colored pins lead; the crab supports selected intro/empty states | A recognizable experience without competing decoration |

Only the settled desktop compositions were inspected. Page-turn interaction, mobile behavior, and performance were not evaluated. Neither reference justifies importing animation effects, blurred typography, serif type, or browser layout into SwiftUI.

**Direction: a city field guide.** Keep the map generous, use crisp category artwork to orient people, and make sheets feel like clear, compact pages. A plan’s category pins and aligned time column provide its distinctive visual rhythm. Cream surfaces, restrained separators, and strong reading hierarchy create space around those details.

### Typography, color, and layout contract

- Use native semantic SwiftUI text styles with the existing rounded design. Reserve pixel lettering for established brand headings and special numbers; use native text for reading and actions.
- Suggested roles: `.largeTitle` for the intro; `.title2` for sheet titles; `.headline` for sections; `.body` for important content; `.subheadline` for supporting labels; `.footnote` for metadata. Confirm their rendered hierarchy before broad adoption. Do not hard-code these roles to fixed point sizes.
- Use tabular digits for schedule alignment. At large text sizes, move supporting time information below the main row rather than compressing it into a fixed column.
- Keep the existing palette: paper `#FAF7F0`, control surface `#FFFDF8`, ink `#29343F`, secondary text `#626975`, line `#DCDAD5`, and established category accents. Category color supplements labels and shapes.
- Calculated contrast against paper is approximately 11.84:1 for ink and 5.17:1 for secondary text. The softer banner color `#738078` is approximately 3.86:1; do not reuse it for small app text. Validate actual foreground/background combinations, including disabled and translucent states. Target at least 4.5:1 for ordinary text and 3:1 for large text.
- Use the four-point spacing scale: 4, 8, 12, 16, 24, 32. Start with 16-point constrained gutters and 20–24 points where width permits. Avoid oversized empty regions created by fixed heights.
- Keep controls at least 44 points in their interactive dimensions. Preserve safe-area clearance, map attribution, and integer-aligned pixel artwork. Scale layout with available width and text size.

## Incremental implementation and commits

Each increment is a separate reviewable commit after its checks pass. Record before/after captures, changed requirement IDs, and remaining limitations in `PROGRESS.md`. Do not claim future checks as completed. Split an increment if it cannot be reviewed or verified coherently.

### 0 — Capture the current experience and lock the brief

Create an implementation branch from the approved-brand base. Capture Map, nearby discovery, Place, empty/populated Plan, Saved, Assistant, Feed, Profile, and Action/Recap where supported. Inspect the user's board and local map references required by the schema before composing new layouts. Use current captures to confirm or revise the findings above.

Create deterministic long-name, empty, loading, failure, and populated fixtures using the existing preview mechanisms. Preview fixtures must remain labeled and must not call account APIs or sensors. Store evidence under `docs/frontend/design-reference/2026-10-12-curated-ui/`, with a subdirectory per increment. Record exact device, viewport, text size, and preview/live mode.

Gate: primary journey and current controls observed; baseline images captured at constrained and ordinary widths; fixture gaps documented. If Simulator remains unavailable, resolve capture access before claiming visual acceptance.

Commit: `docs: record Hermi UI baseline and refinement brief`.

### 1 — Establish shared typography and spacing

Add semantic type/spacing helpers in `DesignSystem.swift` only where they reduce repetition. Apply them first to one representative sheet, checking title, body, metadata, control, and error roles together. Keep brand artwork unchanged. Establish pressed, disabled, focus, and accessible label conventions for shared controls.

Gate: readable hierarchy at default and accessibility text sizes; no clipped controls; existing colors verified on actual surfaces; native target builds. Pure styling does not require tests that merely repeat token values.

Commit: `style: establish Hermi semantic typography and spacing`.

### 2 — Refine Map and discovery composition

Refine `HermiMapPreview.swift` and `MapControls.swift`: align permanent Plan/Social controls, balance the category pin and navigation pill, and clarify selected categories without adding a persistent information panel. Check discovery sheet clearance and attribution. Preserve the established category hold/slide/drop gestures and VoiceOver adjustment; improve their discoverability within the existing compact control system.

Requirements: NAV-01, SHEET-01, MAP-01, MAP-02, PREVIEW-01.

Gate: ordinary tap navigation, independent map pan/zoom, projected pin dropping, sheet detents, and approximately 300 ms navigation return remain correct. Run map bridge checks for map/bridge changes. Verify gesture interactions in the app; physical haptic quality requires a device.

Commit: `style: refine map controls and discovery hierarchy`.

### 3 — Make Place details and Add clearer

Refine `PlaceSheet.swift` and nearby result rows. Give long titles room to wrap, group secondary information, and make Add distinct from Save. Provide concise success/failure feedback through existing state. Preserve unknown hours/reviews as unknown and explicit selection before insertion.

Requirements: PLAN-01, SHEET-01, MAP-02.

Gate: long names, missing metadata, empty nearby results, failed refresh, repeated taps, and dismiss/reopen. Add inserts the selected place once; Save never inserts it. Failed refresh preserves confirmed content. Add focused regression tests only if changed state behavior warrants them.

Commit: `feat: clarify place actions and adaptive detail layout`.

### 4 — Improve Plan reading and editing

Refine `PlanPreviewPage.swift`: simplify header/status hierarchy, remove irrelevant reorder help from empty plans, adapt schedule columns, and make existing save options discoverable. Keep bookmark navigation to Saved. Preserve drag reordering and provide an equivalent accessible action using existing reorder semantics. Consolidate advisory warnings without reducing their meaning.

Requirements: PLAN-01, PLAN-02, PLAN-03, NAV-02, SHEET-01.

Gate: empty, one-stop, many-stop, long-name, warning, undo, reorder, and large-text plans. Advisory timing warnings never disable Go for a plan containing an explicit place. No stop IDs, per-leg modes, or timing-source information are lost. Verify meaningful changed reorder/save/navigation behavior with focused tests.

Commit: `feat: improve plan hierarchy and accessible editing`.

### 5 — Bring Saved into the same hierarchy

Refine `SavedGrid.swift`: wrap folder/place titles appropriately, replace unnecessarily tiny labels, align category indicators, and distinguish folder navigation from place actions. Keep Saved separate from destination insertion and preserve visibility rules.

Requirements: PLAN-01, SOCIAL-01, PROFILE-01, PREVIEW-01.

Gate: empty and populated folders, long titles, large text, back navigation, and private/sample data labels. No automatic Add or changed sharing behavior.

Commit: `style: align Saved typography and collection layout`.

### 6 — Make Assistant states and controls readable

Refine `PlanAssistantView.swift` and its menu/chat surfaces. Remove text-size caps in favor of reflow and scrolling. Clarify suggestion, Apply, Discard, loading, cancellation, retry, and unavailable states. Preserve source links, draft context, and keyboard-safe actions. Avoid placing a second crab alongside an existing mascot.

Requirements: AI-01, PLAN-03, SHEET-01, PREVIEW-01.

Gate: long requests, long suggestions, keyboard open, accessibility text, failure/retry, cancellation, and responses arriving after a draft edit or navigation. Suggestions remain provisional; obsolete responses cannot apply. Run relevant assistant state tests and add coverage only for newly changed contracts.

Commit: `feat: improve assistant accessibility and state clarity`.

### 7 — Unify Feed and Profile composition

Apply the established hierarchy to preview/live feed overlays and Profile. Keep media and the profile map dominant; align identity, place, Score, and actions. Ensure long captions and large text have a usable expansion or scrolling path without hiding primary controls. Share presentation helpers where appropriate without conflating sample and live data.

Requirements: NAV-01, PROFILE-01, PREVIEW-01.

Gate: finite feed completion, one active media player, paging/navigation independence, empty/failure states, long content, large text, and privacy labels. Split Feed and Profile into separate commits if the change grows beyond a small coherent review.

Commit: `style: unify feed and profile reading hierarchy`.

### 8 — Refine Action/Recap and audit motion

Apply shared type and spacing to existing Directions/Camera and Recap surfaces, preserving lifecycle and server-confirmed status. Audit motion across all changed screens; prefer the existing native transitions. Do not add a brand animation to ordinary task transitions.

Requirements: NAV-02, LOCATION-01/02, TRACK-01/02, CHECKIN-01, RECAP-01, PREVIEW-01.

Gate: offline active outing, denied permissions, pending synchronization, end confirmation, and truthful verification status. UI changes cannot stop recording or fabricate completion. Validate existing lifecycle tests when touching related presentation/state code.

Commit: `style: refine outing states and accessible motion`.

### 9 — Complete visual and journey acceptance

Run the full matrix below, fix remaining regressions in small commits, and update the evidence ledger. Reconcile preview and live presentation where live access exists; document unavailable integration checks separately. Compare every changed screen against the approved brief and baseline.

Gate: no unresolved task-blocking behavior, clipping, inaccessible primary controls, misleading data, or brand regression. All required tests/builds pass. Aesthetic review alone cannot establish integration acceptance.

Commit: `docs: record curated UI verification and remaining dependencies`.

## Interaction and motion contract

| Interaction | Purpose and trigger | Timing and interruption | Accessibility/failure behavior |
| --- | --- | --- | --- |
| Control press and Add feedback | Confirm an intentional action immediately | Use the native pressed state; confirmation follows actual successful insertion. Rapid taps cannot queue duplicate additions | Label and state announcement; failure leaves selection available and provides recovery |
| Sheet presentation and nested back | Retain spatial context over the map | Preserve existing native transitions; allow dismiss/back without losing draft or map state | Accessible dismiss/back actions; Reduce Motion uses minimal movement |
| Navigation pill return | Restore navigation after map/feed movement | Preserve approximately 300 ms idle return; renewed movement resets return | Ordinary tap and VoiceOver navigation; no hover or horizontal global swipe dependency |
| Reorder and assistant updates | Show the actual state change | Preserve stable item identity; interruption or stale response cannot overwrite newer state | Move actions and readable status; Reduce Motion avoids travel/bounce |

Do not change durations simply to make the interface feel busier. Validate interruption, reduced motion, and performance before adding any custom transition.

## Verification matrix and acceptance

- **Sizes:** constrained 375 × 667, ordinary 390 × 844, and large 430 × 932 point viewports where available; record the actual simulator/device configuration. Include default text and accessibility extra-extra-extra-large. Use scroll/reflow rather than shrinking important content.
- **Visual states:** initial loading, empty, populated, refreshing, failed, and unavailable; long titles/captions, missing metadata, many stops, keyboard open, and advisory warnings. Check safe areas, attribution, overlapping controls, separators, and pixel edges.
- **Interaction:** Map → drop pin → nearby → Place → Add → Plan → reorder/save → Start → Directions/Camera → End → Recap → Home. Also verify dismiss/back preservation, Saved without Add, assistant Apply/Discard, finite Feed, and Profile access. Unsupported live stages must be marked pending, not simulated as successful integration.
- **Accessibility:** VoiceOver labels, order, values, actions, category adjustment, reorder equivalent, 44-point targets, text scaling, contrast, Reduce Motion, and information conveyed without color alone. Verify on a device where sensory feedback matters.
- **Engineering:** from `apps/ios/HermiPreview`, run `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox`; run `node scripts/test-map-bridge.cjs` when map contracts change. Build and launch with the existing simulator scripts. `scripts/check.sh --no-pull` is the combined check; avoid its default pull during a staged change. Use `scripts/ci-shots.sh` and existing shot scenarios where appropriate, extending fixtures only when needed.

For every increment record: requirement IDs, implementation commit, before/after captures, exact test results, inspected states, device checks, and open limitations. Distinguish **implemented**, **rendered**, **interactively verified**, and **live integration verified**. Do not repeat a broad suite after it passes unless new edits or failures justify it.

Commit only the increment’s source, relevant tests, and evidence/docs. Do not merge into main automatically. Push the implementation branch when publishing the completed work within the user's authorized scope; report its branch and commit range. This planning commit does not claim implementation, fresh Simulator inspection, or a completed visual redesign.

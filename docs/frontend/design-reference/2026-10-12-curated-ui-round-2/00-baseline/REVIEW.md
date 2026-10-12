# Round 2 increment 0: baseline and launch diagnosis

2026-10-12 · Partial · No product source changes.

## Build and preview identity

Branch: `design/curated-ui-refresh`. Current code revision: `666e3e398a8b910a1d4304fdd434e1b0fb5e7a22`; later commits through `8106846` and `e785652` changed documentation only. The active preview's map document loaded from this checkout's `.build/arm64-apple-macosx/debug/HermiPreview_HermiDesign.bundle/Resources/map.html`. The desktop executable timestamp was 06:32, after the last code-source mtimes and before the later documentation-only commits. The active process was therefore built from the current code tree, although its original launch arguments are unavailable.

`sh scripts/mac-preview.sh --build-only` succeeds. Fresh Launch Services launch fails with `kLSNoExecutableErr` even though `Contents/MacOS/HermiDesktop` exists and is executable. Running the executable directly did not provide a reliable fresh, fixture-controlled window. Adding bundle metadata and ad-hoc signing to an ignored generated app did not fix Launch Services; no speculative launcher source change was made.

The iPhone 16e simulator build was attempted with `--hermi-saved-review=empty`. It failed before build/launch because CoreSimulatorService disconnected and Xcode/SwiftPM could not write user-level cache/log paths. This is an environment failure, not a product UI result.

## Rendered baseline

Captures are from the existing Hermi Preview desktop window at its compact 375 × 667 logical layout, ordinary text size, local sample account. It is not a fresh simulator build or an authenticated session.

- [Map](observed-map.png): real geographic tiles loaded. Pixel category pin, Columbia landmark, right-side tools and bottom Map/Feed/Profile navigation form a clear focal hierarchy. The captured screen did not exercise a complete discovery-to-Add journey.
- [Empty Plan](observed-plan.png): direct empty-state instruction is clear. The title and bookmark sit above a large disabled Undo region; Go and the local-preview notice sit near the bottom. This confirms the utility-space concern on the compact composition.
- [Feed](observed-feed.png): media placeholder dominates as intended, with author/caption, bookmark/Add and place strip visible. Fixture copy explicitly marks sample media. Real imagery and captions remain necessary for assessing final media treatment.
- [Profile Adventures](observed-profile-loading.png): Profile metrics and labeled tabs remain visible, but its map displays “Loading map…” while the main Map has loaded tiles. The issue was still present when switching to Posts; a transient load is not ruled out.
- [Profile Posts](observed-profile-posts.png): nine sample media placements appear as colored blocks, not photographs. No verified real posts are represented.
- [Empty Saved](observed-saved-empty.png): the outer page says “Saved” and the content header repeats “Saved” above the count. The crab empty state is centered and readable.

Existing round 1 long-title Place and populated Plan evidence remains available under `../2026-10-12-curated-ui/`; it is historical capture evidence, not a newly launched round 2 fixture.

## Findings for the next increment

1. Resolve deterministic review fixture launch and preserve the normal user's local state. Current Saved empty state could be actual persisted state; it cannot establish whether the populated fixture was seeded or cleared.
2. Investigate why the Profile Adventures map remains loading when the main Map is loaded. Reproduce in a fresh controlled launch before assigning a cause or editing renderer code.
3. Keep the confirmed Saved duplicate heading and Plan utility spacing for their planned increments; no design code changed here.

## Acceptance state

Rendered: Map, empty Plan, Feed, Profile Adventures/Posts, empty Saved. Interactively navigated Map → Plan → Map → Feed → Profile Posts → Saved. Main map tiles loaded; Profile Adventures did not settle during observation.

Not verified: fresh launch, command-line fixture application, populated Saved/folder, current Place long-title flow, complete discovery → Add → Plan, iPhone target sizes, Dynamic Type, VoiceOver, real media, authenticated integrations, physical touch/haptics, motion preference behavior.

R2.00 remains partial. Do not treat this as approval of subsequent increments.

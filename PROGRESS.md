# Hermi frontend progress

Updated: 2026-09-27. Branch: codex/cairn-frontend. No pushes authorized.

## Current checkpoint

### Step 2 — visual review and physical-phone setup

User asked to test on connected iPhone, otherwise authorized Step 2. Device discovery (outside sandbox) returned no devices; no valid signing identity/development team configured. Opened the standalone Xcode project and saved concise setup in docs/IPHONE_TESTING.md. Physical-iPhone unsigned compilation passed; cannot install until user pairs/signs.

Implemented brighter shared palette; unified native/web marker colors and map terrain/CSS through HermiPalette injected at WK document start. Removed default wordmark/developer menu on all Home pages; Debug --hermi-lab retains tools. Shared pixel glyphs retained and Settings glyph prepared for later wiring. No backend changes. 20 package tests, Mac build, large-iPhone build/launch and JS syntax pass. Large Map/Feed/Profile screenshots captured. Smaller iPhone 16e build/install/launch and Map/Feed/Profile screenshot review passed; controls remain within the screen and media/map fill the viewport. Step 1 touch acceptance and Step 2 aesthetic acceptance remain pending. Next: user phone setup plus test.md feedback, then correct this increment before Step 3.

Opening Xcode caused a scheme-format/version rewrite; preserve it unstaged as incidental project state rather than include it in the visual change.

### Approved plan Step 1 — navigation implementation ready for user test

2026-09-27: user approved the revision plan and requested only Step 1. Consolidated approved decisions in docs/FRONTEND_IMPLEMENTATION_PLAN.md and schema revision 5. Replaced the pill-level high-priority recognizer with button-scoped exclusive tap/hold handling; Map / Feed / Profile order; rectangular 64×48 hit areas; stationary hold help without navigation; held slide commits a different destination only inside pill bounds; cancellation preserves current page. Accessibility activation and selected traits retained. Other controls' existing help recognizers remain outside this navigation-only change.

20 package tests passed; iPhone build/install/launch and Mac build passed. Simulator accessibility click navigation to Feed/Profile succeeded. Saved before/after screenshots under docs/design-reference/2026-09-27-step-1. Physical tap timing, hold/scrub/cancel, larger text, VoiceOver and map/Feed gesture isolation await user test; no user acceptance claimed. Coordinate click attempts were inconclusive. test.md has the active six-step checklist. Next: receive Step 1 feedback, fix/retest as needed; do not start Step 2 yet. The backend rating issue remains pending Step 0 follow-up; no backend code changed, no pushes.

### Active correction: 01e — Feed gestures, full Plan and Action entry

User requests Add/remove toggle, long-hold explanations, notched Plan icon, vertical Feed, hold/slide Home navigation without intercepting map pan, full Plan timeline with reorder/time/reminders/attendees, separate Saved, and Go!/Action. Implemented local preview: 4 finite Feed cards plus end, two-card Friends filter; Save/Add independent toggles; hold helpers; pill-only long-hold selection; full/compact Plan, separate grouped Saved; time/duration/reminder draft persistence; stop drag/drop plus accessibility reorder; participant draft with explicit no-send semantics; Go enters Directions/Camera-only Action preview, no sensors/capture/tracking. Camera/invites/reminders/live directions remain integration gates.

Mac/iPhone initial builds and 19 state tests passed. Simulator reported user interaction during agent inspection, so clicks stopped. Read-only screenshot exposed cramped held-category labels; fixed width/alignment in source. Final Mac/iPhone build-only checks passed without restarting user's Simulator. Latest help/pin-label refinements are compiled and will install on the next simulator-preview.sh launch. Next: user exercises the four checklist groups in test.md; record results before advancing. No acceptance or pushes.

### Previous correction: 01d — supplied board comparison

User reports Feed/full-screen and missing Camera/Create/two controls. Three supplied screenshots reviewed in the conversation; comparison saved in docs/design-reference/2026-09-26-board/REVIEW.md with outstanding ambiguities. Temporary attachment copying was blocked by macOS; the existing board PDF remains local. Simulator inspection confirmed Feed media bands, Save-only control and wrong Feed Social navigation. Media crop corrected and inspected in Simulator; iPhone build passed. User clarified “feedback” means feedback to the agent; Feed has Save-for-later and Add-to-plan, Camera/Create only in Go!/Action. Implemented separate stacked pixel Save/Add controls and full-width place strip; actions reuse tested independent saved/plan state with duplicate prevention. Mac and iPhone builds passed. Simulator confirmed two controls, full-width strip, Add producing one stop and becoming disabled; the existing Saved state remained intact. Next: user checklist in test.md. Feed Social audience filtering and later Plan/place-detail layouts remain known gaps; no visual acceptance.

### Previous correction: 01c

User rejected bounded illustration, mismatched pin icons, safe-area white bands, category arrows, incorrect Profile tabs and conditional Plan. Implementing geographic MapLibre/OpenFreeMap with bundled pinned renderer, shared pixel ballpoint pins, hold/vertical selection, permanent Plan/Social, edge-to-edge backgrounds, Adventures/Posts with grid/modal and Saved in Plan. User clarified own Adventures only with stats/info; header Friends | Score | Rank leads separately to friend routes. Clarification implemented. Friend sharing confirmed opt-in: Private / Friends / Everyone via persistent left-side Adventures control. Implemented local preview preference with explicit Save; no live publishing or private friend access. Backend untouched. 16 state tests passed; Mac/iPhone builds passed, real tiles/zoom/layout and Profile grid/modal inspected. Fixed safe-area status overlap and UTF-8 attribution. Latest Profile/sharing revision is built for Mac/iPhone; user review in test.md is next. Full pin gesture/haptic/accessibility/offline/sharing-save checks remain pending; no visual acceptance. Simulator reported active user interaction, so agent UI control stopped. Latest build-only checks preserve the user’s running session; rerun simulator-preview.sh after user review to install any subsequent minor reset/pin-anchor corrections. No acceptance or pushes.

### Previous correction: 01b

The user rejected the text/card-led gallery as inconsistent with their Miro layout. `../My First Board.pdf` has now been text-extracted and visually inspected, including detailed main map and feed/plan regions. Current work replaces the launch view with a map-first composition, right-side category/social controls, bottom Feed/Map/Profile pill and contextual sheets. Component lab moves behind the preview menu. Default map is labeled illustration/sample, not live geography. Preserve prior work and do not advance to backend/device features.

Revision 01b is ready for user review. 14 local state tests passed; Mac and iPhone builds passed. Map and place-sheet composition inspected, explicit Add/duplicate prevention/My plan exercised. Feed inspection exposed an oversized media layout shifting controls offscreen; the media now has an explicit viewport frame. Simulator launch terminates the previous preview process before installing. No backend changes or pushes. Next: user checklist in test.md; do not advance until aesthetic acceptance.

### Previous handoff

- Increment 00: user reviewed the plan and supplied corrections. Consolidated into [unified schema](docs/HERMI_SCHEMA.md). Do not request the same review again.
- Increment 01: **ready for user test**. No visual acceptance yet; do not begin 02 without user acceptance.
- Delivered: isolated SwiftUI gallery with Places, Controls and Score specimens, photo/video placements, sample states, accessibility preview options, durable sample state and Reset.
- Commits: 65ba236 consolidates the schema/tests; 77ad3ef implements the foundation. Nothing pushed.
- Verification: 7 XCTest cases passed; Mac build and iPhone simulator build passed. Both apps launched; initial layouts inspected. Mac bookmark/Add/Remove/control feedback and 250→249 Score expiry exercised. Larger-text/VoiceOver and remaining hands-on scenarios await review.
- The UI reported user activity in Simulator and Mac preview; agent interaction stopped rather than competing for controls.
- User test entry point: [test.md](test.md).

## Repository state

Existing local commits 0d1c9b1 and a290d57 predate the Hermi schema. Many legacy prototype files remain uncommitted and unaccepted. Preserve them; stage only increment-specific work. New foundation lives in apps/ios/HermiPreview to avoid depending on unfinished features.

Remote repository is https://github.com/jackb-22/Hermi. Remote de17d60 reviewed read-only; local backend is still 3f546af. Origin still uses the old redirecting URL. No backend merge or remote configuration change is necessary for the isolated foundation.

## Recovery instructions

1. Read docs/HERMI_SCHEMA.md and this file before editing.
2. Check git status and preserve all unrelated changes.
3. Read test.md for active increment and user results.
4. Resume the recorded next action; do not advance before user acceptance.
5. Commit scoped changes after validation and record the actual outcome.

## Environment

Xcode: /Applications/Xcode.app (26.3). Use DEVELOPER_DIR per command; global xcode-select still points to CommandLineTools. Installed SDKs: iOS/macOS26.2; simulator runtime iOS26.3. Real-device signing is not configured. No live API environment has been accepted.

## Next action

Help complete iPhone pairing/signing, receive Step 1 touch and Step 2 visual feedback, and record it in test.md. Do not advance to Step 3 until reviewed. Reopen with `sh apps/ios/HermiPreview/scripts/simulator-preview.sh` from the repository root, or use the already-open Hermi Preview Mac window.

## Build notes

The simulator uses iPhone17 Pro Max, UDID 0EA96F52-7FA4-40B1-BEF0-B1CD5B9EBCB9, runtime iOS26.3. App identifier tech.hermi.designpreview. Initial simulator build exposed mismatched architecture selection; the standalone Debug app target now uses ONLY_ACTIVE_ARCH=YES and builds successfully. Its AppIntents metadata warning is non-blocking because this preview has no AppIntents dependency. Build artifacts/logs are ignored under apps/ios/HermiPreview/.build; no build cache was committed. The standalone package tests run with DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox.

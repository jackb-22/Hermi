# Hermi frontend progress

Updated: 2026-09-26. Branch: codex/cairn-frontend. No pushes authorized.

## Current checkpoint

### Active correction: 01b

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

Receive the user's revision01b feedback and record it in test.md. Fix only this increment and repeat relevant checks. Do not advance to live navigation/map integration until the user accepts this visual foundation. Reopen with `sh apps/ios/HermiPreview/scripts/simulator-preview.sh` from the repository root, or use the already-open Hermi Preview Mac window.

## Build notes

The simulator uses iPhone17 Pro Max, UDID 0EA96F52-7FA4-40B1-BEF0-B1CD5B9EBCB9, runtime iOS26.3. App identifier tech.hermi.designpreview. Initial simulator build exposed mismatched architecture selection; the standalone Debug app target now uses ONLY_ACTIVE_ARCH=YES and builds successfully. Its AppIntents metadata warning is non-blocking because this preview has no AppIntents dependency. Build artifacts/logs are ignored under apps/ios/HermiPreview/.build; no build cache was committed. The standalone package tests run with DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox.

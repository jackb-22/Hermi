# Hermi frontend progress

Updated: 2026-09-26. Branch: codex/cairn-frontend. No pushes authorized.

## Current checkpoint

- Increment 00: user reviewed the plan and supplied corrections. Consolidated into [unified schema](docs/HERMI_SCHEMA.md). Do not request the same review again.
- Increment 01: implementing the isolated SwiftUI visual foundation. No visual acceptance yet.
- Current work: component gallery, sample place/media placement, controls and Score specimen; local automated checks and simulator build next.
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

Finish increment 01, run HermiDesign tests and simulator build, inspect the rendered preview, commit its implementation, and hand the interactive build to the user. Leave status ready for user test, not accepted.

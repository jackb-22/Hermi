# R2.01 — deterministic review fixtures

2026-10-12 · Implemented and rendered on the macOS preview; user review pending.

## Change

`PreviewReviewArguments` now strips an optional `=value` suffix before identifying `--hermi-…-review` scenario flags. Previously, the bare `--hermi-saved-review` enabled the isolated fixture path, but common variants such as `--hermi-saved-review=empty` and `--hermi-saved-review=populated` did not. Those valued variants could fall through to ordinary saved-state restoration, which explains why the empty Saved capture could not establish whether a fixture had seeded.

The same parsed boundary now suppresses normal saved-state reads/writes and live-session restore or foreground reconnect during review fixtures. This keeps fixture scenarios repeatable and prevents a stored account token from replacing their sample state. No product data, network contract, or normal-launch state migration changed.

The Saved fixture setup also selected Profile after setting the Saved sheet; `switchPanel` clears the active sheet, so the seeded collection was hidden. Reordering those two operations now opens the intended Saved screen on launch.

## Verification

- Added tests for valued Saved/Plan/Place/Type review flags, combined Plan + AI scenario flags, and non-fixture demo/layout flags.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox`: **120 tests passed** on arm64 macOS 14.0 host.
- `sh scripts/mac-preview.sh --hermi-saved-review=populated --hermi-review-compact`: built and signed the current `HermiDesktop` bundle. Launch Services returned `kLSNoExecutableErr` inside the script; opening the prepared app from a separate shell displayed the changed build. See the launch limitation below.
- The accessibility tree showed **6 items** in populated Saved. Opening “Weekend ideas” showed its plan, post and place (**3 items**).
- `--hermi-saved-review=empty` opened with **0 items** and the intended empty-state copy/mascot.
- A no-flag launch opened Map; Profile → Saved remained at **0 items**. The earlier baseline also showed 0 items, so this confirms fixture launches did not introduce data in this clean preview domain, not preservation of an existing nonempty user library.
- `git diff --check`: passed before the follow-up patch; rerun before commit.

Captures use the macOS preview at a 375 × 667 logical content frame, ordinary text size, local sample account: [populated Saved](populated-saved.png), [populated folder](populated-folder.png), [empty Saved](empty-saved.png).

## Render and interaction status

The iPhone 16e preview script still fails before building because CoreSimulatorService disconnects and Xcode/SwiftPM cannot write user-level cache/log files. The macOS build's generated app is correctly signed in `/private/tmp`, but Launch Services sometimes rejects its first several opens with `kLSNoExecutableErr`; the same prepared bundle opens when the command is retried from a separate shell. The launcher now reports the prepared path and fallback instead of hiding this condition. It does not claim a fully automatic launch on every attempt.

The fixture states and folder interaction are **verified on the macOS preview**. The nonempty-user-data preservation case and iPhone rendering are still unverified. Follow the current checklist in `docs/frontend/test.md` and provide review before R2.02.

## Limitations

This verifies the fixture content and launch presentation in the macOS preview. It does not prove preservation of pre-existing nonempty data, account isolation with actual stored credentials, physical iPhone layout, Dynamic Type, VoiceOver or network behavior. The account restore guards were verified in source and compilation; an authenticated launch was not available.

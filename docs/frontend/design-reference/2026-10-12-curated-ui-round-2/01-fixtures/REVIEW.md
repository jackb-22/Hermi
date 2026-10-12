# R2.01 — deterministic review fixtures

2026-10-12 · Implemented; rendered acceptance pending.

## Change

`PreviewReviewArguments` now strips an optional `=value` suffix before identifying `--hermi-…-review` scenario flags. Previously, the bare `--hermi-saved-review` enabled the isolated fixture path, but common variants such as `--hermi-saved-review=empty` and `--hermi-saved-review=populated` did not. Those valued variants could fall through to ordinary saved-state restoration, which explains why the empty Saved capture could not establish whether a fixture had seeded.

The same parsed boundary now suppresses normal saved-state reads/writes and live-session restore or foreground reconnect during review fixtures. This keeps fixture scenarios repeatable and prevents a stored account token from replacing their sample state. No product data, network contract, or normal-launch state migration changed.

## Verification

- Added tests for valued Saved/Plan/Place/Type review flags, combined Plan + AI scenario flags, and non-fixture demo/layout flags.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox`: **120 tests passed** on arm64 macOS 14.0 host.
- `sh scripts/mac-preview.sh --build-only`: passed; built `HermiDesktop` from the changed source.
- `git diff --check`: passed.

## Render and interaction status

No changed-build render was obtained. The iPhone 16e preview script failed before building because CoreSimulatorService disconnected and Xcode/SwiftPM could not write its user-level cache/log files. The macOS app bundle built successfully, but reopening the rebuilt stable bundle failed with launchd error 162 (`Launchd job spawn failed`). The older open window is not evidence for the changed fixture behavior. No repeat-launch, normal-state preservation, populated Saved or folder interaction is claimed.

The implementation is source-complete but this increment remains **pending user review**. The next reviewer should follow the current checklist in `docs/frontend/test.md`. Do not advance to R2.02 until the current build opens and those fixture checks pass.

## Limitations

This verifies argument classification and compiles the code paths that isolate review launches. It does not prove view lifecycle ordering, actual fixture content, normal persisted-state preservation, account isolation in a launched app, visual layout, or iPhone behavior. Those checks require a current runnable preview.

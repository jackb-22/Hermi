# Hermi UI round 2 — implementation handoff

2026-10-12 · Snapshot of the source implementation pass before the Apple account was signed into Xcode. The later iPhone/simulator verification and two visual fixes are recorded in [the device review](../10-device-review/REVIEW.md); use it for current acceptance status.

## Implemented commits

- `53a1e35` — deterministic Saved review fixture launch, ordering fix, macOS evidence.
- `725e3ec` — full caption/description action for every nonempty sample/live Feed text.
- `e5b529a` — reserve more compact-panel height for Place identity and paired Save/Add actions.
- `b30efbe` — move Undo into Plan header utilities and show reorder guidance only for multiple stops.
- `220f198` — remove duplicate Saved heading from the collection body.
- `f353e55`, `12f6327` — use a thumbnail list for accessibility text or constrained content width; keep the grid at ordinary width and text size.
- `f1aeef9` — switch expanded Nearby to vertical result rows; retain horizontal cards in compact mode.
- `8e592f9` — give Feed content filtering a distinct pixel filter glyph and accurate accessibility wording.
- `c0a91ea` — make Profile top/bottom spacing and map notices safe-area aware.
- `b145f64` — label the selected Place action “Remove from Plan.”
- `780cd1b` — announce media loading/failure and show “Photo unavailable” when remote media cannot render.
- `22eb6ec` — give Feed full-text actions 44-point minimum height.

## Verification

- `sh scripts/mac-preview.sh --build-only`: passed after changed implementation components.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox`: **120 tests passed**, 0 failures, on arm64 macOS 14.0 host.
- `git diff --check`: passed before implementation commits.
- The R2.01 populated Saved, folder and empty states were rendered and inspected in macOS preview (375 × 667 logical content frame); captures are in [01-fixtures](../01-fixtures/REVIEW.md).
- For later increments, HermiDesktop builds passed. No current iPhone Simulator render or interaction acceptance was obtained. Opening the Xcode project and Simulator did not restore CoreSimulatorService; simulator boot/build failed, with user-level SwiftPM cache/log permissions errors.
- The standalone full-text sheet, Save/Add, Plan, Saved large text, expanded Nearby, Profile notice placement, VoiceOver, Dynamic Type and reduced-motion behavior have not been exercised in the changed build.

## Limits and decisions

R2.00 remains partial; its current-checkout/device baseline is not complete. R2.11 remains unverified and unchanged because its styling decision requires an iPhone render. R2.12 did not receive new representative place/feed imagery: the repository contains a capture artifact, but its provenance and permission for general UI fixtures are unclear. Its remote loading/failure fallback was improved without presenting sample media as real user activity. R2.13 received the definite Feed touch-target correction; broader contrast, VoiceOver and motion checks remain pending. R2.14 reconciles this handoff but does not constitute visual acceptance.

The script's Launch Services activation is inconsistent. R2.01 captures were obtained by opening the prepared macOS bundle from a separate shell. Later commits have build evidence only. Do not infer visual correctness from compilation or model tests.

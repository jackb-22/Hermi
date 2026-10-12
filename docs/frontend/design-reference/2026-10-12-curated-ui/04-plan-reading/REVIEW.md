# Increment 4 — Plan reading and editing review

2026-10-12 · Implemented and desktop-verified; awaiting user review. Native iPhone verification remains pending.

## Open the preview

The native **Hermi Preview** desktop app should be open on the populated My Plan with three sample stops. To relaunch from the repository root, quit the preview with Command-Q and run:

```sh
sh apps/ios/HermiPreview/scripts/mac-preview.sh --hermi-plan-review --hermi-review-compact
```

For the optional one-stop and empty states, use `--hermi-plan-review=one --hermi-review-compact` or `--hermi-plan-review --hermi-type-review=empty --hermi-review-compact`. These DEBUG fixtures are local. The standard fixture includes an advisory time-overlap warning.

## What to test and expected results

1. **Plan hierarchy:** the plan title and stop cards should lead. There should be no repeated “Current draft / On this device” strip. Undo remains available as a separate editing action, disabled when there is no edit to undo.
2. **Empty Plan:** open the empty fixture. The framed message should say the plan starts with an explicit place and explain Map, Feed, or Saved as sources. Reorder instructions should be absent. Go should remain disabled until Add adds an explicit place. No placeholder stop should appear.
3. **One stop:** open the one-stop fixture. The stop, time and reminder details should fit, with no overlap warning unless the times actually conflict. Go should be enabled.
4. **Many stops and warning:** in the standard fixture, scroll through all three stops. The conflict message should remain advisory and Go enabled. Edit a time and Undo; the previous time should return. Reorder a stop with drag or its accessible Move earlier/later action, then Undo; order and per-stop time/reminder/invite details should return with the stop.
5. **Saved plan context:** if an existing saved plan is available, open it. Its name and My draft action should stay together; My draft should restore the unfinished plan. Save options remain on the existing bookmark control and do not add a stop.
6. **Responsive/accessibility:** narrow the window or use the accessibility-size fixture. Stop names and schedule details should reflow/scroll. Check VoiceOver’s Move earlier/later actions and Save options. On iPhone, verify actual Dynamic Type and hold/drag behavior.

Please report any issue or explicitly approve increment 5. Work pauses here until review.

## Visual evidence

![Empty Plan with the streamlined first-step guidance](empty-plan-desktop.png)

![Three-stop Plan with advisory overlap notice and enabled Go](populated-plan-desktop.png)

Captures are native macOS desktop previews, not iPhone renders. The empty and populated states were visually inspected. Automation could not complete a clean one-stop capture after the preview session became unresponsive; the DEBUG scenario is available for user review.

## Verification and limits

- `sh scripts/mac-preview.sh --build-only` passed.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox`: 118 tests passed, zero failures; added focused assertions that empty plans cannot start and timing conflicts do not disable Go.
- `node scripts/test-map-bridge.cjs`: all map bridge checks passed.
- `sh -n scripts/mac-preview.sh` and `git diff --check` passed.
- Native mouse/keyboard reordering, the one-stop fixture, and actual iPhone accessibility/text scaling remain for hands-on review.

# Increment 1 — typography and spacing review

2026-10-12 · Implemented and verified in the native desktop preview. Awaiting user review. Native iPhone build/render/accessibility acceptance remains pending.

## What changed

Added native rounded title, heading, body, label, and metadata roles plus the four-point spacing scale in `DesignSystem.swift`. Shared styled buttons use the rounded body role. My Plan is the first full reading sample: rounded title and stop names, readable footnote-sized schedule/status text, tabular time digits, aligned gutters, and more separation between stops.

Schedule text no longer occupies a fixed 64 × 58-point box or uses 9-point text. Its width scales at ordinary text sizes; accessibility sizes stack the schedule above the stop card and scroll the entire Plan so growing headers and footers cannot squeeze away the stops. Long names wrap. Go uses a minimum size so its label can grow. Existing palette and owned pixel artwork are retained.

This increment refines type and the layout needed to support it. The later Plan increment still owns broader header simplification, Save discoverability, and empty-state composition. Product save/add/reorder/eligibility semantics were not changed.

Requirements: PLAN-01/02/03, SHEET-01, NAV-01, PREVIEW-01 and the schema's native-reading/pixel-art and accessibility rules.

## Open the preview

The native **Hermi Preview** desktop app is left open on My Plan with three sample stops. It contains sample times and an advisory overlap warning, allowing both readability and Go eligibility to be reviewed.

To relaunch from the repository root, first quit Hermi Preview with Command-Q, then run:

```sh
sh apps/ios/HermiPreview/scripts/mac-preview.sh --hermi-plan-review
```

Quit before switching scenarios; launch arguments do not update an already running process. The review launch recenters the desktop window so a previous maximized/offscreen frame cannot hide the preview.

Optional constrained-width scenario:

```sh
sh apps/ios/HermiPreview/scripts/mac-preview.sh --hermi-plan-review --hermi-review-compact
```

Add `--hermi-type-review=long` for the long-name sample, `--hermi-type-review=empty` for an empty plan, or `--hermi-type-review=xxxl` to exercise the accessibility layout. These are DEBUG review controls. They do not change the user's OS text-size preference; long-name data stays in the local review fixture and is not a verified business.

## What to test and expected results

1. **Reading hierarchy:** compare My Plan, the stop names, arrival times, dates, duration/reminder labels, and draft status. Titles and stop names should lead; supporting details should remain readable without competing for attention. Flag anything too small, heavy, or widely spaced.
2. **Time editing:** click Corner café's 12:00 PM schedule, inspect its editor, and Cancel. It should return to the same stop/time without changing the draft.
3. **Place details:** click a stop name and close its details. All three stops should remain in their original order. The name area and menu button should be independently usable.
4. **Reorder and Undo:** move a stop using the existing drag interaction or its accessible Move earlier/later action, then press Undo. Undo should restore the original order and preserve times.
5. **Warning and Go:** the overlap warning is readable and Go remains enabled with these explicit stops. Go opens the local Action preview. To return: End → End preview → Back to Map → My Plan. The draft should survive.
6. **Constrained width:** launch the compact scenario or narrow the standard window. Scroll the timeline to every stop. Dates, reminders, names, menu controls, warning, and Go should stay readable/reachable.
7. **Optional edge cases:** in the long-name scenario, scroll to the final stop: its complete title should wrap while its menu remains visible. In the empty scenario, the original crab appears and Go is disabled. In the accessibility-layout scenario, schedules appear above cards and scrolling reaches Go and the footer.

Send findings or explicitly approve increment 2. No work on increment 2 is authorized by elapsed time or by opening the preview.

## Visual and interaction evidence

| Capture | What it establishes |
| --- | --- |
| [Standard Plan](plan-standard-desktop.png) | Three-stop typography, time alignment, warning, Go, preserved original order after Undo |
| [Constrained Plan](plan-compact-desktop.png) / [scrolled](plan-compact-scrolled-desktop.png) | 375 × 667-point content viewport; timeline scroll reaches lower stops |
| [Long name](plan-long-title-desktop.png) | Complete long title wraps at constrained width without hiding its menu |
| [Empty Plan](plan-empty-desktop.png) | Readable instruction, unchanged approved crab, Go disabled |
| [Accessibility layout top](plan-accessibility-top-desktop.png) / [bottom](plan-accessibility-bottom-desktop.png) | Stacked schedule/card layout, full-page scrolling, reachable Go/footer |

Captures are unmodified desktop screenshots at 2×, including window chrome. Some include a maximized desktop host around a fixed 375 × 667-point review viewport; the actual viewport is not the host's full size. macOS does not render iOS Dynamic Type fonts identically: the XXXL captures establish the accessibility **layout branch**, not actual iPhone font-size acceptance.

Comparison sources are the [October 12 baseline](../00-baseline/REVIEW.md) and [September 27 populated Plan](../../2026-09-27-aesthetic/plan.png). Their content/date/window states differ, so they are hierarchy comparisons rather than an identical-data pixel diff.

Desktop checks performed: constrained timeline scrolling; accessibility-layout scrolling to Go/footer; long-name wrapping; empty-plan Go eligibility; time editor opening and Cancel; accessible Move earlier and Undo. Original stop order and times were restored before handoff. New behavior tests that repeat font/token values were not added; existing state-contract tests cover unchanged product semantics.

## Verification and limits

- Desktop build passed after the final source changes.
- Swift suite passed: 116 tests, zero failures.
- Shell syntax and staged whitespace checks passed.
- Existing text colors retained: ink/paper approximately 11.84:1 and secondary/paper approximately 5.17:1. Category cards keep dark ink; new date/duration text is on the paper surface. Native disabled states remain visibly disabled.
- iPhone build attempt failed before source compilation because Xcode's SwiftPM manifest diagnostics cache under `~/Library/Caches` is not writable from the sandbox. Redirecting Xcode's package cache did not redirect that manifest cache. Simulator services are also unavailable under the current sandbox. No fresh iPhone build or render is claimed.
- Pending: actual iPhone font scaling at default and accessibility sizes, VoiceOver focus order, physical touch/drag/haptics, Reduce Motion on a phone, and live integration. The review flags preserve native system preferences outside explicit DEBUG review launches.

User approval is required before increment 2 (Map and discovery composition). Any requested corrections to increment 1 will be fixed and previewed first.

# Increment 0 — baseline review checkpoint

2026-10-12. Source baseline: `418b642`, including approved brand base `3ed866a`.

Status: desktop baseline captured and preview available for user testing. Increment 0 is not fully accepted: fresh iPhone captures, constrained-size checks, and extended fixtures remain pending. No typography, layout, or product behavior changes have been made.

## Preview and user review

The current native desktop app is open at:

`apps/ios/HermiPreview/.preview/Hermi Preview.app`

To reopen from the repository root:

```sh
sh apps/ios/HermiPreview/scripts/mac-preview.sh
```

This is a native desktop fallback, not an iPhone acceptance surface. It uses local sample content in this inspected session. The map can fetch public basemap tiles; no real outing was recorded during inspection. The existing local draft contains one Corner café stop and was retained.

Try these before the next increment:

1. Switch Map → Feed → Profile → Map using the bottom pill.
2. Open My Plan, open Corner café, close it, and confirm the draft remains.
3. Tap the bookmark, open the full Saved list, and return to Plan.
4. Open and close the Hermi AI menu. Check whether its text and actions are clear.
5. Resize the window to its minimum width and compare the Plan header, time column, and actions.

User instruction: stop after each increment's preview and wait for explicit approval before implementing the next increment. Approval is not implied by elapsed time. This checkpoint does not waive the pending iPhone verification.

## Fresh evidence

Screenshots are unmodified Computer Use captures. The desktop window is approximately 430 × 900 points; the standard window screenshots are 860 × 1800 pixels at 2×, including native window chrome. Place uses a separate native sheet and a different capture extent. This is the default text setting, not an accessibility-size run.

| Capture | State and inspected behavior |
| --- | --- |
| [Map](map-desktop.png) | Geographic map, category pin, permanent Plan/Social, ordinary navigation |
| [Plan](plan-desktop.png) | One existing explicit stop; enabled Go; visible status and reorder helper |
| [Place](place-desktop.png) | Corner café, separate Save/Remove action, sample post media; dismissed back to unchanged Plan |
| [Saved entry](saved-row-desktop.png) | Bookmark reveals inline Saved row |
| [Saved](saved-desktop.png) | Empty full Saved list, original approved crab, return to Plan |
| [Assistant](assistant-menu-desktop.png) | Menu opened/closed without requesting or applying changes |
| [Feed](feed-desktop.png) | Media-led sample post, distinct bookmark/Add, finite-feed controls present; completion not exercised |
| [Profile](profile-desktop.png) | Sample identity, Score, Adventures/Posts, sample route |
| [Action](action-desktop.png) | Local Directions preview, one planned stop; map initially loaded then settled |
| [Recap](recap-desktop.png) | Explicit end confirmation followed by truthful local recap; returned to Map |

Visual findings: Plan spends substantial space on status/help before the stop; inline Saved adds another layer. The Assistant menu occupies much of the lower Plan but its default-size actions remain readable. Profile's map information control partly overlaps the sample-route label in the desktop capture; include this in increment 7. Place's short sample title fits; long-title behavior remains unverified. The crab remains consistent in Saved and Profile.

The user's board PDF was rendered read-only with native PDFKit and visually inspected on October 12. Its map-led composition, compact details, Plan timeline, and media-led Feed support the current direction; later schema amendments govern navigation order and privacy. Both local map reference images were also visually inspected. Retain crisp terrain/pins and geographic emphasis; do not adopt the reference's decorative antique frame or dark game chrome.

## Checks completed

- Native desktop build passed using `scripts/mac-preview.sh --build-only`.
- Fresh Swift suite: 116 tests, zero failures.
- Fresh map bridge suite: all checks passed.
- Desktop interactions exercised: navigation among Home tabs; Plan → Place → close; inline/full Saved → Plan; Assistant open/close; Go → end confirmation → local Recap → Map. These are baseline observations, not exhaustive acceptance.

Build/test logs remain ignored under `apps/ios/HermiPreview/.build/curated-ui-*.log`.

## Pending checks and fixture gaps

- Simulator service access fails inside the filesystem sandbox. The elevated Simulator launch was automatically rejected because permission escalation is disabled. Simulator Computer Use also timed out. Fresh iPhone build/launch/captures have not been verified this increment.
- Pending: 375 × 667 constrained phone, ordinary/large phones, accessibility XXXL, VoiceOver, Reduce Motion, touch gestures, and physical haptics.
- Existing fixtures cover populated Plan, inline Saved, map discovery, feed, and assistant loading/error/suggestion states. Source inspection found `--hermi-saved-review` seeds Saved content but opens `.plan`; do not label it a full Saved screenshot until the fixture is corrected and rendered.
- Empty Plan, long names, full populated Saved, direct Profile/Action/Recap launches, and failed place refresh need deterministic fixture coverage. Add only as needed for their implementation increments, then capture both baseline and changed surfaces before accepting those increments.
- Fresh discovery → selection → Add, assistant failure/stale-response behavior, finite-feed completion, and live integration have not been exercised in this checkpoint.

Next authorized work is finishing increment 0's pending preview verification. Increment 1 requires the user's explicit approval.

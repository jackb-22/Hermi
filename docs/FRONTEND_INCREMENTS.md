> ARCHIVED PROTOTYPE RECORD — superseded on 2026-09-26. Use [Hermi schema](HERMI_SCHEMA.md), [user tests](../test.md), and [progress](../PROGRESS.md). Statements below about branding, commit restrictions, backend availability and Xcode describe an earlier checkpoint, not current instructions.

# Cairn frontend increment ledger

Working rule: one active increment, one component/feature handoff, then user testing before advancement. No further commits or pushes. [Framework](FRONTEND_TRUTH.md) and [tests](FRONTEND_TESTS.md) define the acceptance criteria.

## Status definitions

- **Specification:** scope and tests are written; implementation is not accepted.
- **Implementing:** only this increment may receive feature changes.
- **Ready for user test:** relevant local checks passed; a reproducible component preview is supplied.
- **Changes requested:** user findings need resolution in this increment.
- **Accepted visually:** user approved appearance/interactions; outstanding integration/device checks remain listed.
- **Accepted:** all required checks and user review passed for the stated environment.
- **Blocked:** a named dependency prevents a specific test or implementation. Other work does not silently redefine the blocked scope.

All existing code is provisional. Only increment 00 is active, for framework review. No component has user acceptance yet.

## Sequence

| Increment | One reviewable scope | Depends on | User test focus | Main test IDs | Status |
| --- | --- | --- | --- | --- | --- |
| 00 | Logic/design framework and test plan | PDF, user decisions, API review | Correct rules, scope, source precedence, development cadence | Review documents | Ready for user review |
| 01 | Isolated component preview and design tokens | 00 | Palette, type, buttons, spacing, large text, fixture reset | G05–G06, G09 | Specification |
| 02 | Home navigation pill | 01 | Map launch, tap-only switching, selection, thumb targets | N01 | Specification |
| 03 | Shared sheet component | 02 | Peek/half/full, back, dismiss, map interaction | N02, G02 | Specification |
| 04 | Base pixel map | 01–03 | Geography, pixels, labels, zoom, pan, attribution, failure state | M02–M03 | Specification |
| 05 | Category dial | 04 | Seven categories, All, wrap, gesture discoverability | M01 | Specification |
| 06 | Pin drop and nearby results | 03–05 | Drop, radius, choose venue, empty results, stale responses | M02, M04 | Specification |
| 07 | Place sheet | 03, 06 | Counts, missing data, expansion, pinned Add action | P01–P02 | Specification |
| 08 | Plan stop editor | 07 | Add/fill/reorder/delete, modes, durations, limits | L01–L05 | Specification |
| 09 | AI scheduling and suggestion review | 08, supported API | Returned timing, red rows, accept/dismiss, sources | L06 | Specification |
| 10a | Explain and taste deck | 01, deck contract | Card decisions, age gate, resume/cancel | A01–A02 | Specification |
| 10b | Apple sign-in and session handling | 10a, native configuration | Cancellation, secure session, expired session | A01, G08 | Specification |
| 10c | Student verification | 10b, email provider | Domain/code errors, resend, verified state | A04 | Specification |
| 10d | Profile setup and editing | 10b–10c | Name/username, duplicate errors, finish onboarding | A03 | Specification |
| 11 | Save plan and membership | 08–10, API | Visibility, invited/joined/requested, host approval | L07 | Specification |
| 12a | Start outing and Directions | 08, 10b, device permissions | Start/failure, next stop, Apple Maps link, no Feed | N03, O01 | Specification |
| 12b | Tracking and durable outbox | 12a, real device | Lock/unlock, offline/retry, relaunch, End preparation | O02–O03 | Specification |
| 13a | GPS and venue-tag check-in | 12b, configured API | Waiting, server rejection, verified success, cooldown | C01–C03 | Specification |
| 13b | Personal tags and friend pairing | 10b, 13a, two devices | Reciprocal tap, countdown, timeout, existing friend | T01–T02 | Specification |
| 14a | Camera photo and ambient capture | 13a, real device | Permissions, one capture, visit binding, ambient audio | V01–V03 | Specification |
| 14b | Private capture upload and verification | 14a, storage/worker | Upload failure/retry, commit, private verified result | V04–V05 | Specification |
| 14c | Short video | 14a–14b | Hold/release, duration, interruption, playback | V02–V03 | Specification |
| 15 | End outing and recap | 12b–14b, worker | Flush/end/restart, pending→ready, actual XP/tiles | O04, Q01 | Specification |
| 16a | Recap publication | 15, moderation | Selection, route privacy, pending/live/rejected | Q02 | Specification |
| 16b | Verified review | 13a, 15 | Yes/no, optional text, retry, no XP | Q03 | Specification |
| 17 | Profile Score and cairn | 01, score API | Thresholds, progress, wind, large stack, expiry copy | S01–S03 | Specification |
| 18 | Profile exploration and ranks | 17 | Persistent tiles, stats, campus/friend rank, privacy | S04–S05 | Specification |
| 19 | Profile lists and Saved folders | 07–08, 16a | Own posts/plans, mixed saves, copied plans, folders | B01 | Specification |
| 20a | Feed card and media lifecycle | 07, 16a | Place/stamp/save, audio/video, viewed state | F01 | Specification |
| 20b | Finite feed and end action | 20a | Paging, open plan, daily end, saved-place plan | F02 | Specification |
| 21 | Social map and friend profile | 11, 13b, 18 | Polling lifecycle, public data, membership, privacy | R12, G03 | Specification |
| 22 | Settings, report/block, deletion | 10b, 20a | Failure recovery, privacy toggles, confirmations | F03, B02 | Specification |
| 23 | Full outing regression | Accepted core increments | Plan→go→check in→capture→end→post→Score | All core paths | Specification |
| 24 | Live Activity and compatible push | 23, native/backend support | Lock screen, action link, finish cleanup, real delivery | Device-specific tests to define | Blocked on configuration/support |

The first real outing gate follows increment 15: a plan must reach actual check-in, private capture, End, and a server-produced recap on a real walk before later feature work advances. Increment 23 is the later full regression, not a reason to postpone that first gate.

The order can be adjusted by the user. Parallel feature development is not assumed. A backend-blocked increment stays blocked; it is not replaced with mock functionality in live mode. The PDF's end-to-end loop gate still applies: later social enhancements do not displace completion of the core outing loop.

## Next handoff: increment 01, after framework review

Scope: a native component gallery with only the proposed colors, typography, buttons, and a sample card. A state selector/reset lets the user inspect each example independently. No new plan, camera, backend, or social features.

Manual checklist to provide with that build:

- [ ] The palette feels youthful and fun without too many competing colors.
- [ ] Body text is comfortable to read; the proposed pixel display type fits the map/game elements.
- [ ] Primary, secondary, disabled, and loading buttons are clearly different.
- [ ] At narrow width and large text, labels and actions remain visible.
- [ ] Error/status information is understandable without relying on color alone.
- [ ] Reset returns the gallery to the same starting state.

No boxes are checked in advance. User feedback will be recorded verbatim or summarized with confirmation; silence is not acceptance.

## Handoff record template

```
Increment:
Framework revision / date:
Frontend branch and build timestamp:
Backend revision (or fixture-only):
What changed:
Files changed:
How to open/reset this component:
Manual checks and expected results:
Automated logic/boundary results:
Known failures / blocked checks:
User feedback:
Status after review:
Next increment authorized:
```

## Existing prototype inventory

| Area | Current state | Must happen before acceptance |
| --- | --- | --- |
| Native Mac preview | Launchable broad first pass | Isolate increment fixtures; label build and fixture states. |
| Navigation and sheets | Broad controls exist | Verify all PDF gestures/heights/back behavior and state ownership. |
| Map | Illustrative fixture map plus draft live MapLibre web view | Real geography, bounds, zoom, gestures, clustering/density, and errors need testing. |
| Plans | Draft controls/API calls exist | Typed contracts, async race behavior, explicit-place selection, Start rules, and member access need testing. |
| Account | Draft onboarding/settings exist | Resume, mandatory verification, return shapes, account clearing, and native Apple flow need testing. |
| Outing/camera | Draft device adapters and outbox exist | Real-device lifecycle, attestation, capture context, ambient audio, retry durability, and permissions are unaccepted. |
| Feed/profile/recap | Draft layouts/API calls exist | Paging/seen handling, media lifecycle, route replay, visibility, and complete feature behavior remain unaccepted. |
| Cairn scale | Formula implemented; standalone boundary checks passed | Typography, wind transition, large values, accessible behavior, and user acceptance remain open. |

## Decisions needed before the affected increment

- School verification is now mandatory. Remove the prototype's skip path in increment 10c and test returning unverified accounts.
- Display font and exact color balance: review in 01 rather than fixing them across all screens now.
- Large cairn composition: review values above the ordinary 4–10-stone range in 17; do not silently truncate the count.
- Native push and signing/domain configuration: agree an integration path before 24. Backend work remains outside this branch.

## Latest user decisions

Mandatory school verification; plans require more than zero items with no product maximum; timing warnings allow proceeding or AI/manual revision. These are recorded in the framework. The backend's 12-stop cap is a blocker. NFC scanning remains available when tracking is declined, but successful NFC check-in without any location permission remains a PDF/backend conflict. Plan items are explicit selected places only: drop pin → nearby discovery → select place → Add to plan. Discovery never inserts an unresolved stop. No code changes are authorized by this documentation update.

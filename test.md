# Hermi user testing

This is the user-facing test entry point. Product reference: [unified design schema](docs/HERMI_SCHEMA.md). Resume/checkpoint: [progress](PROGRESS.md).

## Current review: 01b — map-first composition

User feedback on 01: the gallery did not follow `My First Board.pdf`; maximize the map/visual area and use the three-button pill. Revision01b implements that correction. The previous gallery remains behind **hermi → Component lab**. It is not the product home screen.

### Your revised checklist

1. Open the updated preview. The map should fill the screen; no large heading, introductory text or place card should cover it.
2. Check the single bottom pill: **Feed / Map / Profile**, with Map centered and initially selected. Tap each and return to Map; Feed should be media-first and Profile map-first.
3. Use the right-side arrows to change the activity category. Tap its icon to filter/unfilter sample markers.
4. Drag the category pin into the map. A small nearby panel and My plan control should appear, with **zero** places added.
5. Select a nearby place or map marker. Check the compact photo/video placements; only tapping **Add** inserts that place. My plan shows explicit places only.
6. Close the detail panel. The map should again dominate. Open My plan → select its place → Back; return to My plan.
7. Pan the map. The pill should hide during movement and return after it stops; panning never changes panels. Recenter with the location-arrow button.
8. Toggle the person icon between Solo and Social; the extra markers are sample friend check-ins, not live locations.
9. Open the small **hermi** menu to Reset preview or inspect the Component lab. Review settings should not consume the main screen.

The geography, media frames, feed/profile and social markers are composition fixtures. Real tiles, playback, full feed/profile data, sensors and backend writes remain later increments. These controls demonstrate layout and basic navigation without claiming those features are complete.

Status: ready for review. 14 local state tests passed; Mac and iPhone simulator builds passed. Map and compact place-sheet layouts inspected; selecting, adding, duplicate prevention, dismissal and My plan contents exercised on Mac. iPhone panel composition checked. Drag/pan, larger text and VoiceOver still need hands-on review. Your aesthetic acceptance remains pending.

The updated app is running in Simulator. Reopen from `apps/ios/HermiPreview` with `sh scripts/simulator-preview.sh`. The current SwiftUI canvas entry is `Sources/HermiDesign/HermiMapPreview.swift`.

## Previous review: 01 — component gallery

Status: **changes requested**. Implementation commit `77ad3ef`; schema consolidation `65ba236`. Verified 2026-09-26 on macOS15.7.3 and an iPhone17 Pro Max simulator running iOS26.3. The app uses sample data and does not contact the backend. No component is visually accepted yet.

Both the Mac preview and Simulator were opened for this handoff. Use the **Hermi Preview** window or the app already running in **Simulator**. Scroll to reach the complete place card and Add action. The sample state is saved separately in each environment.

To reopen the iPhone preview, run:

```sh
cd /Users/jia/Desktop/Divhacks/Cairn/apps/ios/HermiPreview
sh scripts/simulator-preview.sh
```

For the Mac window, use `sh scripts/mac-preview.sh` from the same directory. To inspect it in Xcode, open `HermiPreview.xcodeproj`; use the HermiPreview scheme and an iPhone simulator. The SwiftUI `#Preview` is in Sources/HermiDesign/HermiGallery.swift; the canvas itself has not been separately verified.

Reset returns to Places / Nature / Riverside Park, no saved or added places, name Alex, Score250, standard text and no forced reduced motion. The system Reduce Motion preference still takes precedence. Real camera/location/NFC acceptance requires an iPhone later.

### Your checklist

1. Open the supplied Hermi preview. Check the header, colors, pixel shapes and text: does it feel youthful, calm and game-like?
2. In Places, select different category icons. The selection must have a visible outline/label, not rely on color alone.
3. Inspect the media placement and place card. Tap the bookmark twice; saved and unsaved must be clear.
4. Tap Add to sample plan. Confirm only one item is added; remove it and confirm the original state returns.
5. Open the preview-state menu. Try Loading, Empty and Error; use their recovery action to return to Ready.
6. Open Controls. Try the editable name and the primary/secondary controls; disabled controls must not act.
7. Open Score. Try values immediately below/at a stone threshold and expire a stone. These are sample values, not earned XP.
8. Increase preview text size and enable reduced motion. Scroll through each specimen; actions must remain reachable.
9. Tap Reset. The category, saved item, plan selection, name, Score and preview controls return to the documented initial state.

Give feedback by checklist number or describe what feels wrong. The agent handles code-level checks; you do not need to inspect code, logs or network requests.

### Results

| Check | Agent verification | User result |
| --- | --- | --- |
| Clean build and local state tests | Mac and iPhone simulator builds passed; 7 XCTest cases passed, 0 failures | Not a user task |
| Interactive simulator / Mac | Both launched; initial screens rendered and inspected | Awaiting feedback |
| Palette, typography and pixel treatment | Initial Mac/iPhone layouts inspected; no visible overlap at default size | Awaiting aesthetic feedback |
| Clickable controls and reset | Mac bookmark, Add/duplicate disable, Remove, primary action, tabs and Score expiry exercised; complete reset/restoration covered in state tests | Awaiting remaining hands-on checks |
| Large text and reduced motion | Controls implemented; downward-only wind decision tested. Full visual/VoiceOver checks not yet completed | Awaiting feedback |

Agent interaction checks stopped when the UI reported user activity, to avoid competing with the user. Loading/empty/error recovery is covered by state tests; those screens still need the user-facing checklist. No backend, real-device capture, sensor, NFC or live-account tests were performed in this increment.

## Increment sequence and user tests

Only 01 is active. Each later handoff expands these steps with a starting scenario, exact controls and expected results. Every increment includes cancel/back, load/empty/error/retry, repeated taps, and relevant persistence/accessibility checks. Existing accepted primitives remain regression-tested.

| ID | Boundary and requirements | User test sequence |
| --- | --- | --- |
| 00 | Consolidated schema | Already reviewed; corrections consolidated. |
| 01 | Visual foundation; PREVIEW-01 | Follow current checklist above. |
| 02 | Home pill; NAV-01 | Launch Map → tap Feed/Profile/Map → pan without switching panels → observe pill hide/return. |
| 03 | Shared sheet; SHEET-01 | Peek → half → full → nested detail → back → dismiss → verify draft/map preserved. |
| 04 | Pixel geography; MAP-01 | Zoom borough to street → pan bounds → inspect labels/attribution → simulate load failure → retry. |
| 05 | Category dial; MAP-02 | Cycle all seven → wrap in both directions → select All → check selection without color. |
| 06 | Discovery; PLAN-01 | Drop pin → inspect results → move before loading completes → empty/error/retry → dismiss with unchanged plan. |
| 07 | Place detail; PLAN-01 | Expand place → browse nearby → cancel → reopen/Add → verify exactly one explicit destination. |
| 08 | Plan editor; PLAN-02/03 | Add three → reorder → edit durations/modes/time → delete to zero → restore one → proceed despite timing warning → relaunch draft. Live 13+ support is a deferred backend gate. |
| 09 | AI review; AI-01 | Schedule conflict → inspect sources → dismiss → accept individual change → edit during slow response → retry provider failure. Include newly implemented ask/chips only after adapter review. |
| 10 | Taste; AUTH-01 | Fresh explain/deck → choices → interrupt → resume → age-dependent content → authentication. |
| 11 | Account; AUTH-01 | Cancel Apple sign-in → retry → invalid/expired/resend/valid school code → duplicate/valid username → relaunch at each step. No unverified Home. |
| 12 | Save/membership; SOCIAL-01 | Save private → invite test account → join/decline → request/approve/deny → open link through onboarding → unavailable plan. |
| 13 | Start/Directions; NAV-02/LOCATION | Deny location → recover → foreground-only Start → repeated Start → Maps handoff → relaunch active session → Head out. |
| 14 | Recording; TRACK-01/02/03 | Start → walk offline → stay stationary → lock/reopen → reconnect → stationary prompt Continue/no answer → End offline → relaunch pending sync. |
| 15 | GPS and QR; CHECKIN-01 | Arrive → early rejection → eligible GPS success → venue QR → duplicate/cooldown → interrupted response. NFC deferred to 24. |
| 16 | Photo/audio/upload; MEDIA | Open camera → deny/recover permission → eligible capture → microphone denied case → consecutive captures → interrupt upload/relaunch → private verified result. |
| 17 | End/recap; RECAP-01 | Real walk/check-in/photo → End → pending/ready → inspect actual route/XP → Later → repeat offline End/relaunch. First real-walk gate before broad social/feed expansion. |
| 18 | Publish/review; RECAP/MEDIA | Deselect route/media → publish → pending/live/rejected → yes/no/text/skip review → return later where supported → verify no screen-action XP. |
| 19 | Score/profile map; SCORE | Threshold values → upward/downward crossing → unchanged refresh → large stack → reduced motion → lifetime tiles unchanged by expiry → friend privacy. |
| 20 | Profile/Saved; PROFILE | Save place/post/other plan → inspect copied identity → folder add/remove/delete → edit/retune → reopen supported historic recap. |
| 21 | Feed; FEED-01 | Page all card types → one active player → Place and back → prefetch not seen → finite end → plan from Saved → slow/failed media. |
| 22 | Social view; SOCIAL/PROFILE | Inspect permitted friend check-ins/public profiles/open plans → request → host approval → leave map/polling stops → ghost mode privacy. |
| 23 | Settings/safety; SAFE-01 | Toggle/relaunch → report/block → deletion cancel/failure/success on test account → account separation → resolve active outing before sign-out. |
| 24 | NFC/personal tags; CHECKIN/SOCIAL | Real venue tap → denied-location supported flow (backend gate) → personal tag bind → reciprocal pairing → timeout → repeated-day hangout/streak. Two accounts/devices for pairing. |
| 25 | Video/native extras; MEDIA | Hold/release → 15-second cap → interruption → upload/processing → real-device Live Activity/deep link/cleanup → native notifications after transport support. |
| 26 | Whole-product regression | Fresh verified account → discover/plan/invite → outing/offline/stationary → check-in/capture/End → review/post → Score/exploration/friend Feed → denied permissions/large text/VoiceOver. |

## iPhone testing, when the camera increment is ready

1. Connect your iPhone and open the development build installed with Xcode.
2. Open the supplied Action scenario and grant camera/microphone access.
3. Capture, inspect playback, then follow the private-upload checklist.

The handoff will provide exact device setup steps. A camera specimen is not proof of verified capture; real visit/API tests are a separate gate. NFC is near the end, not a prerequisite for early visual reviews.

## Handoff record

Each increment records schema revision, frontend commit/build, backend revision or sample-only status, launch/reset path, numbered tests, automated results, blocked checks, user feedback and acceptance. Never mark unrun tests as passed. No advance from silence.

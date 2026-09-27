# Hermi user testing

This is the user-facing test entry point. Product reference: [unified design schema](docs/HERMI_SCHEMA.md). Resume/checkpoint: [progress](PROGRESS.md).

## Current review: Step 3 corrections — lighter map controls

Build/install with the HermiPreview project, your iPhone selected, **⌘R**. The agent's latest phone check still reports unavailable; corrected build is running in Simulator. These steps replace the previous Step 3 checklist.

1. Swipe **up/down directly on the top-right pin**, without holding. Category/icon changes and its name stays underneath; no menu appears. Small pixel chevrons flank the pin. Tap still toggles category-only filtering.
2. Drag the category pin sideways onto NYC land. It is selected automatically. Recommendations are small category-colored dots, not pins. Tap a dot to open its place.
3. Check the **transparent slider at bottom right above +/−/home**, and the small **X attached to the placed pin**. Radius spans **0.1–4 miles**, logarithmically; new pins still start at 1 mile (no longer the midpoint). Zoom does not change radius.
4. Tap empty map: slider, X and radius overlay disappear; pin and recommendation dots remain. Tap the placed pin to edit again. Drag it to move. Water/outside-NYC drops still reject and restore the previous valid position.
5. Open/collapse/expand the panel: +/−/home move above it. On expansion the upper toolbar shifts slightly left to leave a separate control column, and the pin stays above the panel. Nothing should overlap or become unclickable. Close the panel and verify controls return down.
6. Check reduced visible button backgrounds with unchanged icon size; quick taps should remain easy. No “SAMPLE PLACES · REAL MAP” banner. Map attribution remains available.
7. Remove via the pin's X: Plan/Saved stay unchanged. Normal app restart retains valid pin/radius. Test navigation tap/hold and map pan/pinch for regression.

Send screenshots of selected/deselected/expanded-panel states; send a short recording for category swipes, drop, move or cancellation problems. This remains single-pin Step 3; no advancement to Step 4 yet.

Validation: 27 Swift tests pass; JavaScript bridge checks cover dots, deselection without deletion, radius endpoints, rejected moves and panel offset. Simulator build passes. Screenshots under [revision evidence](docs/design-reference/2026-09-27-step-3-revision/REVIEW.md). Real touch delivery, haptics, accessibility and frame pacing need your phone test. Content remains local fixtures; land validation is approximate. No backend changes.

Debug `--hermi-pin-review` seeds a selected pin without reading/writing normal saved state; remove that argument for persistence testing.

## Previous review: Step 2 — palette and composition

You authorized Step 2 while Step 1 touch acceptance remains pending. [iPhone setup instructions](docs/IPHONE_TESTING.md) are saved locally; Xcode is open to the correct preview project.

1. Open Map: the top-left wordmark/menu should be gone; geography fills the screen behind the status bar and bottom pill.
2. Compare brighter teal water, coral/violet markers and lime selection accents. Confirm the effect is fun but still visually calm.
3. Open Feed: media reaches every edge; Save and Add controls remain readable; the wordmark is gone.
4. Open Profile: check the same paper/ink/lime palette, crisp icons, and readable header/navigation. Profile content structure is intentionally unchanged until its later checkpoint.
5. On your phone, also run the Step 1 quick-tap/hold/scrub/cancel checklist below. Report layout with screenshots and gesture issues with a brief screen recording.

Checks so far: 20 package tests pass; Mac and iPhone 17 Pro Max/16e simulator builds pass; physical-iPhone compilation passes with signing disabled. Map JavaScript syntax passes. Main text contrast against paper is 11.16:1; ink on lime 7.72:1; white on green 4.53:1. These are static token checks, not a full accessibility audit. The user subsequently confirmed the Steps 1–2 build runs on their iPhone. Screenshot review is in [Step 2 evidence](docs/design-reference/2026-09-27-step-2/REVIEW.md).

To access developer-only preview tools, add `--hermi-lab` under Xcode's scheme Run → Arguments Passed On Launch. Default launches show no developer menu. This does not change app data.

## Pending touch review: approved plan Step 1 — navigation only

The updated build is installed in iPhone Simulator. To reopen from the repository root:

```sh
sh apps/ios/HermiPreview/scripts/simulator-preview.sh
```

1. **Quick taps:** tap Map → Feed → Profile → Map, then repeat quickly. Each short tap should switch once on release, without holding. Order must be Map / Feed / Profile.
2. **Hold help:** while on Map, hold Feed for about 0.35 seconds without sliding, then release. Stay on Map; Feed help remains briefly. Tap Feed normally to open it.
3. **Hold and slide:** begin on Map's button, hold until guidance appears, slide onto Profile and release. Profile opens once. A stationary hold must not act like a tap.
4. **Cancel:** hold and slide above/below or beyond either side of the pill, then release. The current page must remain; no edge-tab clamping or stuck highlight.
5. **Separate gestures:** pan/pinch Map and swipe Feed vertically outside the pill. Neither should change the selected Home tab.
6. **Accessibility:** enable VoiceOver and activate each named tab; selection should be announced. Check larger text for clipped help or unreachable controls.

Pass/fail and screenshot feedback: reply with the test number and what happened. For gesture bugs, a short recording is more useful than a still image. Step 2 was subsequently authorized by the user; Step 1 physical-touch acceptance remains pending.

Verification: 20 package state tests passed; iPhone build/install/launch and Mac build passed. Simulator accessibility click activation opened Feed and Profile. Unit tests cover segment ordering and off-pill/nonfinite cancellation boundaries. They do not validate physical gesture timing. Coordinate-only click attempts did not establish reliable physical tap behavior; quick finger taps, hold/scrub, VoiceOver, larger text and pan/pinch remain user acceptance tests. Screenshots: [Step 1 evidence](docs/design-reference/2026-09-27-step-1/REVIEW.md). No backend integration changes.

## Previous review: 01e — test these small groups in order

**A. Feed and explanations**
1. Tap Feed. Swipe upward over media: a new full-height sample post and place name appear. Swipe down to return. Four posts end at “You’re caught up”; Friends filter has two samples. This is layout/paging, not video playback.
2. Tap + twice: add, then remove. The bookmark must remain unchanged. Hold + or bookmark ~0.6 seconds and release: an explanation appears, with no change to membership.
3. Tap the top-right Social button while in Feed: remain in Feed and toggle its sample audience. Desktop hover also shows control descriptions.

**B. Navigation versus map gestures**
4. Hold the bottom pill ~0.35 seconds, slide left/right, release over a destination. Preview/highlight precedes switching. A tap still works.
5. Pan/pinch the map and scroll Feed outside the pill: Home panels must not switch. Hold the category pin: readable category choices appear without a competing tooltip.

**C. Plan and Saved**
6. Add at least three different Feed places. Tap the notched Plan icon: My Plan opens full page. Drag its handle down/up to collapse/expand; bottom pill remains available.
7. Tap a stop's time. Set arrival, duration and reminder preference; Save. Reopen and verify. Cancel an edit and check it was not applied. Reminders are not delivered by this preview.
8. Hold a place row and drag onto another row to insert before it. Names, times and reminder preferences must stay associated. Overlapping times warn without blocking Go. VoiceOver offers Move earlier/later.
9. Tap a place row: media/detail panel opens. Back returns to My Plan. Tap its …: see no-data confirmed attendees and a separate sample invite list. Save a draft, reopen; no invitation is sent or person marked attending.
10. Plan bookmark opens a separate Saved page. Tap it again to return. Open a Saved place and Back returns to Saved. Plan-membership toggling here does not unsave it.

**D. Go!/Action boundary**
11. With a nonempty plan, tap Go!: Action preview has Directions/Camera only, no Feed. Camera shows an explicit not-connected preview; no permission request or recording. End preview returns to Plan. Empty plans cannot Go.

Verification: initial Mac/iPhone builds passed; 19 state tests passed, covering toggle independence, reordering, Saved back navigation and pill selection boundaries. Gesture/render checks are pending user review: agent UI control stopped when Simulator reported user activity. Final Mac/iPhone build-only checks passed. The running session has the main 01e features; latest small help/pin-label refinements install on the next `sh scripts/simulator-preview.sh` launch, so your active session was not interrupted. No live trip, notification, camera or invite tests claimed.

## Previous correction: 01d — Feed and board comparison

Feed media crop corrected: the 4:3 source now fills the entire portrait viewport before clipping, eliminating solid-color bands. iPhone build passed and the crop was inspected in Simulator. Check Feed reaches all four screen edges, including behind the status area and pill, without shifting controls offscreen.

Clarification confirmed: “feedback” meant feedback to the agent. Feed has bookmark (Save for later) and + (Add to plan); Camera/Create is exclusively in Go!/Action mode. The two pixel buttons are now stacked lower-right above the full-width place strip. Mac/iPhone builds passed; Simulator Add inserted one stop, disabled repetition and preserved Saved. Layout inspected. The remaining save/remove round-trip is for user review.

1. In Feed, tap bookmark. Open Plan → Saved: the place appears there, but My plan remains unchanged.
2. Return to Feed and tap +. It changes to a check and disables repeat addition. Plan contains that place exactly once.
3. Remove it from My plan: it remains saved. Return to Feed: + is available again.
4. Unsave from Feed: the bookmark outline returns; this must not remove an existing plan stop.
5. Check the media fills the screen and both buttons/place strip stay above the bottom pill. No Feed Camera/Create control.

The full drawing comparison is in [board review](docs/design-reference/2026-09-26-board/REVIEW.md). Feed-specific Social filtering and later Plan/place-detail composition remain known gaps, not completed features. Visual acceptance remains pending.

## Previous review: 01c — geography, pin gesture and Profile

The updated app is in Simulator. Reopen from `apps/ios/HermiPreview` with `sh scripts/simulator-preview.sh`. Public map tiles need internet; account places, posts and routes are labeled samples. No Hermi backend writes or location permission.

1. **Map**: drag north/south/east/west; zoom out several levels, zoom back in and recenter. Use +/− or hold Option in Simulator to pinch. Geography should extend continuously, and map pins should stay at their coordinates. No top/bottom white bands; controls should avoid the status bar.
2. **Pin**: hold the upper-right ballpoint pin for ~0.3 seconds, slide up/down through categories, release. Only temporary options appear while held; the selected pin changes color. Tap to filter/unfilter. Hold again and drag left onto the map to discover at the dropped coordinate. Physical haptic feel requires iPhone; Simulator cannot validate it.
3. **Discovery**: dropping never adds a plan destination. Open a nearby sample place, explicitly Add, close and reopen Plan. Drop far from Columbia: no nearby sample results, no invented place.
4. **Permanent controls**: Social and Plan stay upper-right on Home panels. Open Plan before adding anything. Save a place, then find it under Plan → Saved; it must not silently enter My plan. Social markers are sample check-ins; full friend activity awaits integration.
5. **Profile header**: Friends | Score | Rank are separate entries. Friends has an honest no-data state. Score is a labeled sample; unavailable ranks stay blank.
6. **Adventures**: only your own map here. Tap the pixel info icon for visit counts ascending, NY coverage, steps and most/least visited borough/neighborhood. Real stats are unavailable rather than invented. The persistent left-side sharing icon opens Private / Friends / Everyone; choose and save a preview setting, reopen and check persistence. Dismiss without saving must preserve the previous choice. No route is actually published.
7. **Posts**: exactly one other icon tab. Check the three-column grid. Tap a tile: its place modal has your media/review and friends’ media/reviews sections, with no-data states. Close to return to the grid. No Saved/Profile third tab.
8. **Regression**: Feed remains media-first; pill selection/back/close work. Test larger text, VoiceOver category adjustment, Reduce Motion, and relaunch. Map failure should offer Retry while Plan remains available.

Verification: 16 state tests passed; Mac and iPhone builds passed. Geographic map render, zoom-out and safe-area layout inspected. Adventures and three-column grid/place modal inspected. Hands-on pan/pinch, held-pin drag, haptics, sharing-save/cancel, offline retry and accessibility acceptance remain pending. Agent interaction stopped when Simulator reported the user was interacting; the app was left available for user testing. Sharing is confirmed opt-in, private by default; only a local preview preference is implemented, with no publishing/private friend access.

## Previous review: 01b — map-first composition

Status: changes requested; replaced by 01c below the same visual review boundary.

### Archived 01b checklist

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

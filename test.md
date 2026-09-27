# Hermi user testing

This is the user-facing test entry point. Product reference: [unified design schema](docs/HERMI_SCHEMA.md). Resume/checkpoint: [progress](PROGRESS.md).

## Current review: skyscraper-crab branding

Build/run HermiPreview, then **Profile → Settings → Replay intro demo**. Simulator is ready with this build; the physical iPhone must be rebuilt/installed to get these changes.

1. **Visual sequence:** on a solid brand-paper background, the crab peeks out, makes one cautious step/pause, then crawls left → right with faint temporary tracks. It must fully exit before the larger logo and `hermi` wordmark fade in. Map follows at about 5.4 seconds. Skip always works.
2. **Launch boundaries:** normal returning-user launch goes straight to Map; users with existing preview data bypass the new intro too. A genuinely new install shows it once. Viewing or skipping consumes that first-open flag, so interruption never forces repeated intros. Active Action preview recovery takes priority. Do not erase your personal app data just to test first open; use a spare simulator. The model tests cover first-open, existing data, explicit demo and recovery rules.
3. **Demo replay:** from Settings tap Replay intro demo. It should dismiss Settings, return the underlying page to Map, play once and finish on Map. The command-line `--hermi-demo` flag forces playback on launch, independently of the seen flag; remove it to test normal launches.
4. **Reduce Motion:** enable iOS Reduce Motion, then replay. A static mark replaces the crawl/trails and transitions after about 0.8 seconds. Background/foreground the app: no duplicated intro should appear.
5. **Loading:** while map initialization is pending, a compact peeking/stepping crab appears with temporary tiny tracks. X dismisses the indicator; loaded navigation remains usable. The indicator clears on ready/error and times out after 15 seconds. It does not cancel network requests or claim backend progress. In the component lab, the loading sample also uses this component and its cancel returns to the ready sample.
6. **Motif/scaling:** inspect the small profile mark, an empty My Plan, empty Saved and Feed's empty/end screen. The crab stays static and does not occupy controls. Verify the skyscraper remains recognizable at those sizes and larger accessibility text remains usable. No surprise random easter-egg overlay has been introduced.
7. **Feedback:** send the logo reveal screenshot and a recording of one full replay, especially if pacing, trails or the shell silhouette need adjustment.

57 Swift tests pass; Simulator and unsigned iPhone builds pass. Screenshot frames checked for crawl, reveal and empty-plan layout; normal launch bypass and Skip were exercised. Physical-device motion, Reduce Motion and first-install acceptance remain open. [Evidence and source reference](docs/design-reference/2026-09-27-brand/REVIEW.md). This is branding in the preview, not an implementation or bypass of required sign-in/school verification. Home Screen app-icon packaging remains separate from the in-app mark.

## Previous review: Social map clarification and no hold explanations

Run the updated app with ⌘R in Xcode, with your connected iPhone selected.

1. Map → Social: see a green pixel-edged circle with two simple people inside at the sample current place, a pink heart at the sample loved place, a dotted green active-adventure route and a solid pink loved-adventure route. These are independent layers; a friend may have a shared place without a route. The sample-data label must remain visible above attribution.
2. Watch green: blink, blink, pause, repeat. Enable iOS Reduce Motion: it remains steady. Pink hearts and paths stay steady. Tap a friend/heart to see its sample identity/context; no text should appear just from holding it.
3. Switch Solo: all friend icons and both route kinds disappear. Switch Social back: they return without duplicating. Pan and zoom: icons remain tied to their geographic coordinates and the right toolbar stays aligned.
4. Hold ordinary buttons, including Social, Plan, add/save, Profile controls and discovery pins: no functionality-description popover appears. Quick taps still work. Intentional actions are retained: hold My Plan bookmark for Save Plan, hold/drag category pin, and hold/reorder plan stops.
5. Send a Social screenshot and a short recording if the blink timing or button behavior feels wrong.

55 Swift tests and expanded map bridge tests pass; Simulator and unsigned iPhone builds pass (final screenshot-label adjustment is HTML-only and included in refreshed Simulator). Real friends/current presence/loves remain unconnected. The backend currently provides recent check-ins, not proof a friend is there now, and lacks loved-place/loved-adventure fields. Do not treat sample icons as actual people or live tracking. [Screenshots](docs/design-reference/2026-09-27-social/REVIEW.md).

## Previous review: tap navigation + Step 10a Action lifecycle

**Run on your iPhone:** open `apps/ios/HermiPreview/HermiPreview.xcodeproj` in Xcode. In the top toolbar select **HermiPreview** and your **connected physical iPhone**, not an iPhone Simulator. Click the triangle ▶ or press **⌘R with Xcode active**. Keep the phone unlocked during installation. This is a new build; reopening the old phone app alone will not update it.

1. **Tap navigation:** briefly tap Map, Feed, Profile, then Map again. Each selects directly, without holding. Holding/sliding across the pill no longer selects another page or opens help. Map pan/zoom and vertical Feed paging stay independent. Saved bookmark hold and category-pin hold-to-drag remain intentional and unchanged.
2. **Go:** add at least one place, open My Plan and tap Go. Directions lists the current explicit stop order. Home tabs are inaccessible during Action; only Directions and Camera remain. Timing warnings still permit Go; an empty plan cannot start.
3. **Camera boundary:** tap Camera and Directions normally. Camera explains that capture is unavailable in this layout preview. No photo, microphone, location permission or upload begins. This is not the real camera acceptance test.
4. **End and cancel:** tap End. Dismiss the confirmation by tapping outside it (or Cancel/Keep exploring if shown by the OS): Action must remain open. Tap End again and confirm End preview. A preview recap lists planned stops, without inventing visited places, route, steps or XP. Tap Back to Map, open My Plan and confirm stops/times are unchanged.
5. **Recovery:** on a normal launch, start Action, choose Camera, quit/reopen. The same preview and mode should return. End it, quit/reopen before Back to Map: recap should return. Back to Map clears only the completed Action preview. Simulator review fixtures intentionally reset; remove `--hermi-plan-review` to test recovery.
6. **Feedback:** send screenshots of Directions and recap, plus a short recording if quick taps still feel wrong. Check on your phone at larger text size as well.

55 Swift tests pass (two obsolete scrub tests removed, four Action lifecycle tests added); Simulator and unsigned iPhone builds pass. Simulator exercised Go → Camera → End → recap → Map and Home navigation buttons. [Visual evidence](docs/design-reference/2026-09-27-step-10a/REVIEW.md). Physical touch timing and normal-run restart remain for user acceptance. This completes **10a only**: location permission/interruption, real camera/ambient audio/video, authenticated upload and server recap are still pending; NFC remains last.

## Previous review: Step 9 — Feed filters and Profile privacy layout

Run HermiPreview in Xcode with **⌘R** on your iPhone. Simulator is running the nonpersistent `--hermi-feed-review` fixture (one café stop); remove that argument for normal restart testing. From `apps/ios/HermiPreview`, the fixture command is `sh scripts/simulator-preview.sh --hermi-feed-review`.

1. **Four Feed combinations:** tap Feed. Tap the top-right Social button to switch Public/Friends. Tap the chevron below it to switch Posts/Plans. Exercise all four combinations: the other filter stays selected, no My Plan sheet opens, and the existing plan stays intact. Swipe vertically to page cards and reach the finite end; switch filters there and confirm matching content returns. Map discovery filters also scope sample Feed results; no matches gives a recoverable empty state.
2. **Post bookmark versus +:** in Posts, save a post with the bookmark. Tap + to add its place, then tap again to remove it. The bookmark stays selected. Unbookmark must not remove a plan stop. Open a post’s place strip: its content stays in the contextual panel, and X returns to Feed.
3. **Plan cards:** switch to Plans. Swipe the stop chips horizontally without accidentally paging vertically. Bookmark saves a private local copy without adding stops. The + appends only missing explicit stops in order, as one Undo action; repeated + does not duplicate or delete them. Open Map → My Plan to inspect order/Undo. The route illustration is sample art, not recorded GPS or directions.
4. **Profile rail:** Profile shows Settings gear above Saved bookmark, on the existing right-hand line. Bookmark opens full Saved with folders, including any Feed bookmarks. Adventures has its statistics icon but no separate sharing button; Posts remains the other of exactly two tabs.
5. **Settings:** open gear. Defaults are Private routes, location sharing off and Nobody live visibility (a prior explicit route preference may migrate). Choose Friends, then X: changes are discarded. Reopen, choose and Save preview preferences, then reopen: choices remain. Turning location sharing off resets live visibility to Nobody when saved. These are local preferences only, with no permission prompt or actual sharing.
6. **Own post isolation:** Profile → Posts → first tile. Confirm only your media and your review area appear, with X to close. No friends’ posts/reviews/social context appears. Unavailable reviews remain unavailable; sample captions are not fabricated scored reviews.
7. **Phone/restore:** check quick taps, hold explanations, larger text, VoiceOver names and horizontal chips versus vertical paging. In a normal run, quit/reopen and confirm filter preferences, bookmarks and privacy draft persist. Send screenshots of Feed Plans, Settings and an own-post popup; send a recording for gesture issues before the next increment.

Verification: **53 Swift tests pass**; Simulator build/launch and unsigned iPhone build pass. Simulator inspected all four filter combinations, Settings defaults/Cancel, Profile rail and own-post isolation. [Step 9 screenshots](docs/design-reference/2026-09-27-step-9/REVIEW.md). Physical-phone install/gesture acceptance and normal-run relaunch remain pending. Backend audience/content filtering, granular privacy enforcement and numerical ratings remain integration gates; no backend changes were made.

## Previous review: Step 8 — local saved-plan editing and Undo

Step 7 accepted for progression; the bookmark’s finger-hold timing remains unverified. Run HermiPreview with **⌘R** on your iPhone. Simulator currently uses the nonpersistent `--hermi-saved-review` fixture. Remove that argument when testing restart persistence. These are local editing tests, not cloud synchronization or invitation tests.

1. **Open versus append:** bookmark → horizontal Saved row → tap the **name** of Saturday loop to edit that saved plan. Its name and “Autosaves on this device” appear, with two stops. Tapping a saved plan’s **+** instead appends missing places to the currently active plan; it does not switch editors.
2. **Autosave:** reorder the stops, change a time, or add a place from Saved/Map/Feed. Close/reopen this plan from Saved. Edits remain, and the library still has one copy of this plan. The bookmark hold menu shows “Saved automatically” and “Sharing draft,” without a redundant Save action.
3. **Undo:** after each add/remove/reorder/time/invite-selection edit, tap Undo. Removing then undoing a stop must restore its time/reminder/invite draft together. Appending several stops from a saved plan is one Undo action. Repeating an add that inserts nothing does not consume another Undo. Up to 20 edits can be undone in the current editing session; changing plans clears that session’s history.
4. **Preserve draft:** tap “My draft.” Your original unfinished plan returns (the fixture’s café/gallery/gardens), and the saved plan remains in the library. Open a second saved plan and switch back to the draft: no stops from those plans should silently replace your unfinished draft. Saving a new unnamed draft binds it to the new saved plan; “My draft” then gives you a fresh draft.
5. **Empty boundary:** remove the final stop from a saved plan. It stays recoverable in Saved but Go is disabled. Undo restores the stop, or reopen the empty plan and add an explicit place. There is no frontend stop cap.
6. **Sharing intent:** while editing a saved plan, hold the bookmark → Sharing draft. Select Friends and specific sample friends. Keep draft preferences, reopen and check them. Cancel must discard unconfirmed changes. With no selected friend, Keep is disabled. “Save & invite” is unavailable; Public also saves only local preferences. No message, attendance confirmation or publishing occurs. Stop-edit Undo does not change audience preferences.
7. **Restart/offline:** in a normal run, make a saved-plan edit, quit/reopen, open My Plan and use Undo. Editing identity, stop data, prior draft and Undo history should survive together. Local editing can be tested without internet; map tiles may not load. Real server conflict handling, sync failure/retry and invitation idempotence are blocked and must not be marked passed.

Verification: **48 Swift tests pass**, Simulator and unsigned iPhone builds pass. Simulator exercised opening a saved plan, reordering, Undo, sharing draft selection/save and restoring the original draft. [Step 8 screenshots](docs/design-reference/2026-09-27-step-8/REVIEW.md). Send an edited-plan screenshot and any unexpected Undo/gesture recording before advancing. Phone drag, hold, restart and accessibility acceptance remain open.

## Previous review: Step 7 — Saved drawer, folders and Save Plan

Build/run HermiPreview with **⌘R** on your iPhone. For a seeded Simulator screen, from `apps/ios/HermiPreview` run `sh scripts/simulator-preview.sh --hermi-saved-review`; the fixture has three plan stops, two bookmarked places, a sample post and a two-item folder. It never overwrites normal local preview data. Run without that flag to test restart persistence.

1. **Single bookmark:** from My Plan, quickly tap the bookmark at top right. A horizontal Saved row appears **between My Plan and the timetable**; the timeline and Go remain on the same page. Tap the bookmark again to hide only the row. No separate Save Plan button or drawer chevron should appear.
2. **Horizontal row and full Saved:** show the row and swipe sideways through Place, Post and Plan cards while the timetable below scrolls vertically. Tap “See all” to open the full Saved page. Expand the “Weekend ideas” folder: it contains a saved plan and sample post. The two bookmarked places remain in All saved. Tap the bookmark there to return to My Plan; current stop order must be unchanged.
3. **Explicit add:** tap + on The book nook, then on the saved Saturday loop. Only missing places append to the current plan, in the saved order. Tap either + again: no duplicate stop appears, and the message says it was already present. A saved post’s + adds only its linked place. Bookmarks stay saved.
4. **Folders:** from full Saved, use a row’s folder icon to move a place into Weekend ideas; expand that folder and confirm it now contains Place, Post and Plan. Moving it must not add it to My Plan.
5. **Bookmark hold / Save Plan:** hold the My Plan bookmark about 0.4 seconds. The “Save current plan” option appears without opening/closing the Saved row. Tap it to open the Save Plan modal. Cancel with a partially entered name or folder; no new folder/plan should appear. Reopen by holding, name the plan, choose the existing folder or create a new folder, select Solo, then save. Find that snapshot in Saved. Name and folder have length checks; an empty plan cannot save.
6. **Audience draft:** save another plan with Friends and select specific sample friends; an empty friend selection disables Save Draft. Try Public too. Both save **local visibility intent only**; no invite or feed post is sent. Check the confirmation wording.
7. **Restore and visuals:** on a normal launch, save a plan/folder, force-quit and relaunch. Saved entries, active stop order and time data should return. Check quick taps, horizontal drawer versus vertical timeline, small iPhone layout and VoiceOver button names. Send screenshots of the drawer, expanded folder and modal, plus any gesture recording.

Automated verification: 42 Swift tests pass; iPhone 16e Simulator build/launch and visual inspection passed. Local Solo Save was clicked and confirmed. [Screenshot evidence](docs/design-reference/2026-09-27-step-7/REVIEW.md). The user’s physical-phone gesture/layout and normal-run persistence review remain open. Backend supports place/post/plan folder references, but not standalone image saves; Public feed distribution and invitations are not connected. Server still caps plans at 12 stops, contrary to product truth; this preview never silently truncates.

## Previous review: Step 6 — Plan timeline and Go

Step 5 accepted; Step 6 authorized. Build/run HermiPreview with **⌘R** on your phone. Simulator currently contains a temporary Plan fixture with three stops and an intentional time overlap. Normal launches persist your actual preview plan; the fixture does not.

1. **Plan entry/empty:** from Map or Feed, add places with + and open My Plan. It opens full page. With no stops, Go is visibly disabled. Add one explicit place and Go becomes available even without a time. Saved membership remains independent.
2. **Time editor:** tap a stop's left-hand time. Change arrival/date, stay length and reminder preference; Save, reopen and confirm. Change again and Cancel: previous values remain. Clear time removes scheduling data without deleting the stop. Reminders here are preferences only—no notification is scheduled.
3. **Reorder:** hold a stop row and drag to another row's upper half to insert before it, or lower half to insert after it (including the final stop). Its time/reminder/invite draft must stay with that place. Also check VoiceOver Move earlier/later.
4. **Timing boundary:** set café arrival 12:00 with 60 minutes, next stop 12:30: warning appears, but Go remains available. Change next to 13:00: the overlap warning clears. This checks stay overlap only; travel time/AI repair are not connected.
5. **Place and attendees:** tap a stop name; its place panel opens. X returns to My Plan with order/times intact. Tap …: see the no-data attendee state and sample existing-friend choices. Save draft then reopen to confirm; Cancel discards edits. No invitation is sent and no friend is marked attending.
6. **Remove:** in a stop's … sheet choose Remove stop from plan. Other stops and bookmarks stay unchanged; that stop's time/invite draft is cleared. Re-add it: no old reminder should silently reappear. Remove the final stop: Go disables again.
7. **Go round trip:** start a nonempty plan, including one with a warning. Action preview shows the stops in their current order and Directions/Camera only. End preview returns to the unchanged Plan. Camera remains a placeholder; no real trip, recording or permission request begins.
8. **Restore and layout:** in a normal run, relaunch and check order, times and invite drafts persist together. Open/close Plan from Feed and Profile as well; covered underlying controls must not activate. Check compact/full Plan, smaller text/large text and quick taps. Send timeline and Action screenshots plus a recording for drag problems.

Verification: 38 Swift tests pass (reorder metadata, remove/restore, timing boundary, stale editor rejection, snapshots and route return), plus existing map bridge checks. Simulator and unsigned device builds pass. Simulator confirmed place → X → Plan, attendee draft display, Go despite warning, and End preview → unchanged Plan. [Screenshot evidence](docs/design-reference/2026-09-27-step-6/REVIEW.md). Physical drag/reorder, time-editor cancel/save, empty-state UI and device restart still need user review. Backend blockers remain flagged, not fixed.

Fixture command: `sh apps/ios/HermiPreview/scripts/simulator-preview.sh --hermi-plan-review`. Remove the argument for persistence testing. Step 7 (saved drawer/folders/Save Plan) follows your review.

## Previous review: Step 5 — horizontal category selector and contextual Feed

Step 4 accepted apart from category gesture direction. User confirmed **horizontal swipe to choose, hold then drag to place**, and **hide map controls only while the contextual panel is full-height**. Build/run HermiPreview with **⌘R**, or run `sh apps/ios/HermiPreview/scripts/simulator-preview.sh` from the repo root. The current Simulator uses the nonpersistent multi-pin review fixture.

1. **Category gestures:** quickly swipe left/right across the source pin; category changes in the matching direction. Vertical swipes must not cycle categories. A quick tap toggles citywide filtering. Hold about 0.3 seconds, then drag onto land to add a pin; this must not cycle categories. Stationary hold must not add a pin. Check cancellation and water rejection.
2. **Open a location:** tap a recommendation dot or nearby place card. Its posts appear inside the current map panel. Map stays selected; the main Feed does not open. Place title, bookmark, +/− and X are visible; there is no misleading Back button. Discovery editing controls dismiss while browsing the place.
3. **Panel levels:** tap the handle to cycle compact → medium → full → compact, or swipe the handle up/down one level. Down from compact dismisses. Small interrupted drags should not change level. Medium retains the fixed right-side rail. Full hides map controls; collapse restores the same alignment. Close X works at each height.
4. **Two scroll axes:** at full height, scroll vertically through @alex, @sam and @lee at the selected place. Swipe a post's media horizontally to its other photo/video placeholders. Media scroll must not resize the panel, pan the map or change Home tabs. Vertical post scrolling must not collapse the panel; resizing is handle-only.
5. **Context:** close the panel and verify pins, radii, category filter and map position remain. Open a different place: the title and post IDs/media descriptions refer only to that place. Save/Add toggles remain independent. No camera, real video playback or rating submission is enabled here.
6. **Main Feed:** open the main Feed, scroll to another card, open its place strip, expand/scroll/close the place panel. You should return to the same global Feed card and audience. Map discovery remains intact when you return.
7. **Accessibility/smoothness:** test handle Expand/Collapse actions, larger text, Reduce Motion, quick taps and finger scrolling on iPhone. Watch for jumpy transitions or delayed swipes; send a short recording if present. Screenshots cannot certify 60fps.

Share compact/full/collapsed screenshots and any gesture recordings before Step 6. Validation: 34 Swift tests and map bridge checks pass; Simulator and unsigned physical-iPhone builds pass. [Screenshot review](docs/design-reference/2026-09-27-step-5/REVIEW.md). Automated panel expansion/collapse verified control visibility and preserved Map selection; automated scroll attempt was inconclusive. Posts/media remain explicit local placeholders, with no invented ratings or backend implementation.

## Previous review: Step 4 — multiple pins and combined filters

User authorized Step 4. Rebuild/run HermiPreview with **⌘R** on your selected iPhone, or run `sh apps/ios/HermiPreview/scripts/simulator-preview.sh` from the repo root. Normal launches preserve your saved data and migrate the earlier single pin. This is local discovery over a small sample set near Columbia, not complete NYC recommendations.

1. **Multiple pins:** drop Food near Columbia. Drop another Food nearby: both remain. Swipe the source to Nature and drop a third pin. Nearby shows the combined results; a café matched by two Food pins appears only once. No plan stops are inserted.
2. **Independent editing:** tap the first Food pin and set 0.1 mile; set the other to 4 miles. Switch between them: each retains its value, category and location. Tap empty map: every pin and matching recommendation dot stays, while X/slider/radius hide. Tap any pin to edit again.
3. **Move/reject/remove:** move one pin on land; others stay unchanged. Move it into water or outside NYC: restore only that pin. Invalid new drops preserve all pins. X removes only the selected pin. Plan/Saved stay unchanged.
4. **Citywide union:** choose Music by swiping the source, then tap it. Its label is underlined and nearby reads Music citywide alongside the pin count; Music samples join all geographic matches. Swipe to Shopping without tapping: Music stays active. Swipe back to Music and tap again to remove only that citywide filter. Tap Food instead to replace the citywide category; geographic pins stay. Shared places are not duplicated.
5. **Indicators/zoom:** zoom out until all three pins are visible. Each pin has its category inside, but only one visible Food pin has the extra floating Food glyph; Nature gets one too. Pan the Food representative offscreen: another visible Food pin gets the glyph. Recommendations remain small colored dots; zoom does not change any radius.
6. **Layout:** open/collapse/expand the nearby panel. Category, Social, Plan, slider and +/−/home keep one vertical right-side centerline. Switch Map/Feed/Profile and return; pins persist and old IDs do not affect another pin.
7. **Restart/boundaries:** relaunch the normal app and verify all pin coordinates/radii and the citywide category restore. Remove all pins while a citywide filter is active: citywide matches remain. Turn that off too: general discovery returns. Empty filter results are a valid state, not an error.

Share selected/zoomed-out/expanded screenshots, plus a recording of any selection or drag problem. Step 5 waits for this review.

Validation: 31 Swift tests pass, including unions/deduplication, independent edits, invalid placement, stale deleted IDs and legacy/new snapshot restoration. JS bridge tests verify stable markers, selected radius IDs, tap-away retention and visible-category indicator transfer. Simulator and unsigned physical-iPhone builds pass. [Screenshot review](docs/design-reference/2026-09-27-step-4/REVIEW.md). Full physical touch, accessibility and animation performance remain user checks. No backend changes; real multi-area recommendation completeness remains an integration gate.

Optional deterministic screenshot fixture: `sh apps/ios/HermiPreview/scripts/simulator-preview.sh --hermi-multipin-review` seeds two Food pins and one Nature pin. It does not read/write normal saved state; remove the argument for restart/persistence tests.

## Previous review: Step 3 corrections — lighter map controls

Build/install with the HermiPreview project, your iPhone selected, **⌘R**. The agent's latest phone check still reports unavailable; corrected build is running in Simulator. These steps replace the previous Step 3 checklist.

1. Swipe **up/down directly on the top-right pin**, without holding. Category/icon changes and its name stays underneath; no menu appears. Small pixel chevrons flank the pin. Tap still toggles category-only filtering.
2. Drag the category pin sideways onto NYC land. It is selected automatically. Recommendations are small category-colored dots, not pins. Tap a dot to open its place.
3. Check the **transparent slider at bottom right above +/−/home**, and the small **X attached to the placed pin**. Radius spans **0.1–4 miles**, logarithmically; new pins still start at 1 mile (no longer the midpoint). Zoom does not change radius.
4. Tap empty map: slider, X and radius overlay disappear; pin and recommendation dots remain. Tap the placed pin to edit again. Drag it to move. Water/outside-NYC drops still reject and restore the previous valid position.
5. Open/collapse/expand the panel: +/−/home move above it. All right-side tools stay on one fixed vertical centerline. Expansion leaves room for the complete control stack; the pin stays above the panel. Nothing should overlap or become unclickable. Close the panel and verify controls return down.
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

Verification update: Settings → Replay intro demo was invoked in Simulator and returned to Map automatically. Final unsigned iPhone rebuild passed after the returning-user migration adjustment.

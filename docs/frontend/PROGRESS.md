# Hermi frontend progress

Updated: 2026-09-27. Branch: frontend. Earlier 47-commit history pushed with user authorization; subsequent branding work is local for review.

## Current checkpoint

### Merge finalized handoff — development paused here

User authorized finalizing the merge in favor of incoming `e61193dea14a024a6dff1c053a99add9f7564903`. ProfileSettingsPage matches incoming ServerSettingsSection; the replay button is absent. The unfinished crab redraw/accelerating-walk revision was set aside and its two files restored to committed HEAD. Existing staged integration and iOS prototype work was preserved; .DS_Store was excluded locally.

Recovery snapshot: `/Users/jia/Desktop/Divhacks/merge-recovery-20260927-044820` contains staged/unstaged binary patches, parent IDs and the unfinished logo source/tests. Apply selectively in an isolated checkout, not blindly over subsequent work. The original committed branding remains; later artwork changes need separate review.

Verification: 62 HermiPreview Swift tests pass; unsigned iPhone build passes; no unresolved conflicts. Backend services and the separate legacy iOS prototype were not runtime-tested in this handoff. Do not resume development or push from this session without a new user instruction. The other editing session owns further work. Earlier checkpoints below are historical.

### Skyscraper-crab branding increment — implemented for review

Read Desktop/Divhacks/App logo.jpg. User confirmed retaining skyscraper shell and simplifying scenery. Implemented a code-native vector pixel mark, using coral/lavender/paper/ink, with separate shell/body/feet for scalable animation. Original reference is preserved in docs/design-reference/2026-09-27-brand/source-logo.jpg; source image was not modified. Updated small profile mark and static Plan/Saved/Feed empty/end motifs.

Intro: peep, cautious first step/pause, crawl across, faint tracks, clear screen, logo fade, Map at ~5.4 seconds. One-time local flag consumed on entry; existing preview users bypass it. Explicit --hermi-demo or Settings replay allows review; active Action recovery overrides the intro. Reduced Motion uses a static ~0.8-second reveal. Skip stays available. Reusable nonmodal loader added to map initialization and component-lab loading state; dismissal leaves loaded UI operable, readiness/error clears it, 15-second watchdog prevents a stuck indicator. No fake network delay or backend progress.

57 tests pass (first-open/demo/existing-user/recovery policy and animation boundary tests). Simulator and unsigned iPhone builds pass. Crawl, logo and empty-plan screenshots inspected; Skip and returning-user launch bypass exercised. Physical-phone pacing, Reduce Motion and fresh-install user review remain pending. Native Home Screen icon packaging is not part of this in-app mark increment. Source files/earlier personal signing work untouched; branding commits local, not pushed.

Next: user reviews replay and mark at small size; adjust artwork/timing before propagating further. Required authenticated onboarding and Action integration remain separate unfinished work.

### Social marker readability correction

User requested a simple circled people icon. Current-place marker now uses a 32-point pixel-edged green circle with a dark outline and two high-contrast head-and-shoulder silhouettes; existing 44-point tap target and blink/pause behavior remain. Map bridge checks pass. Simulator screenshot review records the revised icon in the Social evidence folder. No backend changes.

### Social map feedback — implemented for local review

User clarified shared current places (green blink–blink–pause), loved places (pink), active adventures (dotted) and loved adventures (solid). Replaced letter placeholders with geographic pixel sprites/hearts plus separate route layers. Social off removes all layers; Profile Adventures and Action do not inherit Home Social fixtures. Reduced Motion disables sprite animation. Taps show sample identity/context; no GPS or real sharing claims.

Removed generic hold-help recognizer/popovers throughout SwiftUI, and map-pin hold timers/tips. Accessibility hints remain. Intentional Save Plan, category drag and stop reorder holds remain. Expanded bridge tests verify route styles, supplied coordinates, Solo clearing, Reduce Motion and absence of hold tips; 55 Swift tests pass. Simulator and unsigned iPhone builds pass. Screenshot caught sample-label/attribution overlap, fixed label spacing and rebuilt Simulator. No backend changes or pushes.

Backend gap: SocialResponse friendsOut means check-in within 3 hours, explicitly not live location; friendPlans means upcoming shared plans, not confirmed active geometry; no loved-place/adventure collection. Live/current UX needs freshness and sharing enforcement before integration. All new visuals are labeled samples. Next: user reviews Social and no-hold behavior in test.md, then resume Action integration boundaries. Screenshot evidence in docs/design-reference/2026-09-27-social.

### Tap-only navigation correction and Step 10a — ready for user review

User removed pill hold/scrub navigation and authorized the next step. Replaced custom PrimitiveButtonStyle with ordinary semantic buttons (64×48 targets), removing hold-help/scrub recognizers and obsolete coordinate tests. Saved bookmark and category-pin gestures remain unchanged. Commit `c2a46a4`.

Implemented local Action lifecycle: immutable explicit-stop snapshot, one active preview, persisted Directions/Camera mode, guarded/idempotent end timestamp, confirmation, local recap and return to Map preserving plan. Underlying Home controls are hidden from accessibility and hit testing while Action is present. Normal state decoding restores active preview/recap; review fixtures intentionally reset. Commit `a775558`.

55 tests pass; Simulator and unsigned iPhone builds pass. Simulator exercised Go, mode switch, end confirmation, recap and Map return, plus Home button navigation. Screenshots: [10a evidence](design-reference/2026-09-27-step-10a/REVIEW.md). Physical phone install/touch and normal restart remain pending.

Read-only remote check: Hermi HEAD `4694b46685cccc1660ea4c14f4131806b297b44f` (2026-09-27). Session/media contracts still require server session/verified check-in integration; end request has steps but no client end timestamp. Preview has no authenticated session/check-in adapter and uses sample place IDs, so real start/capture/upload cannot safely be connected to these fixtures. No backend changes, merges or pushes. No sensors are active; no real privacy, upload or XP claims.

Next: collect tap-navigation and Step 10a feedback. Then 10b authenticated session/location permission and durable tracking integration, 10c real device camera/upload/recap, NFC last. Step 10 overall is not complete. Do not confuse preview recovery with production offline tracking recovery.

### Step 9 — Feed/Profile ready for local review

User authorized the next increment. Implemented independent Friends/Public and Posts/Plans filters, full-screen sample plan cards, per-post bookmarks, private local copies of bookmarked plans, duplicate-safe explicit append and one-action Undo. Filter changes preserve active plan and do not navigate to My Plan. Profile rail now has Settings/Saved; sharing controls moved out of Adventures. Own post detail excludes friends’ media/reviews. Optional Codable preferences preserve older snapshots; legacy route audience migrates without enabling location sharing.

53 Swift tests pass. Simulator build/launch and unsigned iPhone build pass. Visually inspected all four Feed filter combinations, Profile rail, local Settings defaults and own-post detail; Settings Cancel exercised. Evidence: [Step 9 review](design-reference/2026-09-27-step-9/REVIEW.md). Physical phone and normal-run restart tests remain open. Simulator fixture does not overwrite normal preview data.

Backend gates: Feed query has lat/lng but no requested audience/content filtering contract; PatchMe lacks route audience/location/live-visibility preferences; scalar review rating remains absent. Local fixture filtering/preferences do not prove server privacy enforcement or feed distribution. No backend edits or push. Frontend commits: `9094550` (state/tests), `0e9b6fd` (UI).

Next: user follows Step 9 in test.md and returns screenshots/gesture feedback. Correct this boundary before Step 10. Previous bookmark finger-hold acceptance remains open.

### Step 8 — local saved-plan editing ready; remote sync/share blocked

User accepted Step 7 for progression, leaving physical bookmark-hold timing pending. Implemented saved-plan reopening by name, editing identity, autosave of stop order/time/reminder/invite drafts, bounded 20-edit Undo, one-action append Undo, and preservation/restoration of the unfinished unsaved plan. All edit entry points (including Feed/Map and accessibility reorder) use the same model transitions. Existing JSON remains decodable. Saving a new plan binds the editor to it; returning to My draft then starts a fresh draft. Empty saved plans remain recoverable with Go disabled.

Added explicit local sharing-intent editor, selected sample friends, Cancel/Keep semantics, and unavailable Save & invite control. Removed competing generic hold-help recognizer from the bookmark; its own hold recognizer remains, with stable accessibility “Bookmark options.” No real invitation, cloud save or public post is sent. Backend read-only inspection found `/plans/:id/save` notifies the supplied invitee list on each call; `/plans/:id/invite` filters existing members but provides no explicit retry transaction contract. Stop replacement lacks a conditional revision check. These are integration gates, not backend fixes. Remote offline/retry/conflict and real invitation tests are blocked; local persistence/recovery can be reviewed now.

48 Swift tests pass, including six Step 8 boundary tests. Simulator and unsigned iPhone builds pass. Screenshots and interactions reviewed: opening saved plan, reorder/Undo, selected-friend draft and restored original draft. [Step 8 evidence](design-reference/2026-09-27-step-8/REVIEW.md). Simulator remains in a nonpersistent fixture; normal phone relaunch testing is pending. Next: user Step 8 review from test.md, then corrections; do not claim backend integration is complete.

### Step 7 — Saved drawer and Save Plan ready for user review

Feedback correction: the user clarified one bookmark in My Plan. Quick tap toggles a horizontal Saved row between header and timetable while the plan remains visible; hold offers Save current plan and opens the existing modal. “See all” in the row reaches the full Saved page. Removed the separate chevron and always-visible Save Plan button. Revised simulator screenshots are in the Step 7 review; quick-tap and accessibility Save-option paths were inspected. Physical hold and two-axis scrolling remain for user acceptance. This correction supersedes the initial Step 7 header behavior described below.

User authorized the next increment. Built the horizontal Saved drawer in My Plan, separate full Saved page with mixed Place/Post/Plan folder references, post bookmarks in contextual place content, duplicate-safe explicit append, and pixel-style Save Plan modal with name, existing/new folder and Solo/Friends/Public intent. Existing preview snapshots still decode; normal local state serializes saved plans, folder membership and stop time snapshots. Friends and Public are **local drafts** only; there are no invites or public posts. No standalone image saving is represented. No backend files were changed.

All 42 Swift tests pass, including four Step 7 state/migration cases. iPhone 16e Simulator builds and launches. Screenshots and visual notes: [Step 7 review](design-reference/2026-09-27-step-7/REVIEW.md). Simulator Solo Save was exercised. Physical touch, folder/gesture feedback and normal-launch persistence remain for user acceptance in [test.md](test.md). The preview should not be mistaken for authenticated backend persistence; server stop cap (12), image save, sharing/invitation delivery and public taste feed are unresolved backend gates. Preserve user-owned signing/project changes and unrelated Cairn prototype work; no push.

Next: collect user Step 7 screenshots/feedback and correct this increment before Step 8 autosave/Undo/share.

### Step 6 — Plan timeline ready for user review

User accepted Step 5 and authorized next phase. Completed durable per-place local timing/invite drafts in MapPreviewState, migration from legacy UserDefaults, validation, before/after reorder insertion, removal in attendee sheet with per-stop draft cleanup, advisory overlap warnings and nonempty Go guards. Place X now restores Plan/Saved origin. Action stop list preserves order and scrolls without a product count cap. No live trip/camera/notifications/invitations implemented.

38 tests pass; map bridge checks pass; Simulator and unsigned iPhone builds pass. Screenshot loop corrected covered map controls remaining accessible behind Plan and excessive Action directions-card whitespace. Screenshots under docs/design-reference/2026-09-27-step-6. Simulator verified place/X/Plan, attendee draft, Go with warning, End/Plan. Final underlying-page accessibility/hit-test guard extends coverage to Feed/Profile as well; no visual change. Preview open in nonpersistent --hermi-plan-review mode; normal launch needed for persistence tests. No Step 7 yet, backend edits, pushes or phone install claimed. Next: user checklist in test.md.


### Step 5 — ready for user gesture/visual review

User accepted Step 4 except category swiping direction and authorized Step 5. Confirmed horizontal swipe to select; hold then drag to place. Confirmed full-height panel hides map controls, restoring the same rail after collapse. Implemented exclusive category swipe/tap/hold-drag handling, three panel levels with handle-only resizing, scoped place posts and horizontal media inside vertical panel scrolling, compact Save/Add header and X close. Opening a place clears discovery editing without deleting filters/pins. Main Feed routing is unchanged.

34 Swift tests, map bridge checks, Simulator build/run and unsigned physical-iPhone build pass. Screenshot loop caught overly tall place header and covered map controls remaining in accessibility tree; both corrected. Final compact/medium/full screenshots saved in docs/design-reference/2026-09-27-step-5. Simulator confirmed full controls removed and restored on collapse. Automated scroll attempt inconclusive: finger gestures/scrolling/VoiceOver/frame rate remain test.md checks. Preview is open in nonpersistent --hermi-multipin-review mode. No Step 6, backend changes or pushes; no new phone installation claimed.


### Step 4 — multi-pin discovery ready for user review

User explicitly authorized Step 4. Implemented independent persistent pins, stable renderer markers, selected-pin editing/removal, repeated categories, citywide-category union with geographic matches and deduplication. Source swiping does not change active citywide filter; underline and summary indicate activation. Legacy pin/coordinate snapshots migrate; empty saved arrays cannot resurrect an old pin. Category indicators use one stable representative per visible category, transferring when it leaves the viewport. Step 3 right-side centerline remains fixed.

31 Swift tests and extended JS bridge checks pass; Simulator build/install/launch and unsigned physical-iPhone build pass. Screenshot review found an old sample garden coordinate in water; moved that fixture onto land and tested it. No backend edits. User test checklist is the new current section in test.md. Physical gesture/accessibility/performance acceptance remains pending. Step 5 has not started. Simulator citywide-filter activation preserved all three pins. Automated UI actions stopped when user activity was reported; preview remains open in nonpersistent --hermi-multipin-review mode. Expanded-panel review remains pending. Next: user review, corrections as needed; no pushes.


### Single right-hand column correction

User requested local rerun and a clean vertical stack. Removed the expanded-panel sideways toolbar shift; normalized upper toolbar, slider and zoom/home to the same 42-point right inset centerline. Contextual panel expansion reserves 460 points for the rail to avoid overlap rather than creating a second column. My Plan remains full-page. Simulator rebuilt/launched; compact, expanded and closed states inspected and saved under docs/design-reference/2026-09-27-step-3-alignment. JS bridge checks pass. Attribution moved below the map buttons after the closed-panel screenshot exposed overlap. Next: user reviews running local preview; no Step 4.


### Step 3 feedback revision — ready for re-test

User rejected the first Step 3 control layout. Implemented colored recommendation dots; tap-away deselection; transparent bottom-right slider; small pin-attached X; dynamic panel clearance for zoom/home; reduced visible button backgrounds with retained touch areas; immediate vertical category swipes with category label and side chevrons; removed sample-place map banner. User selected 0.1–4 miles; keep 1-mile default. Screenshot review caught an expanded-panel toolbar overlap; separated toolbar/control columns and reveal pin when panel height changes.

27 Swift tests and expanded JS bridge tests passed; Simulator build passed. Phone remains unavailable for install. Revised test.md is authoritative for this review; previous Step 3 screenshots describe the superseded version. No Step 4, backend changes, or push. Next: install when phone connects and collect revised Step 3 gesture/screenshots feedback.


### Step 3 — implementation complete; user review next

User confirmed the Steps 1–2 app works on iPhone and authorized continuing. Implemented one persistent category-icon pin, frame-correct drop projection, draggable placement, selected-pin vertical radius editor/X, logarithmic 0.25–4-mile radius (1-mile midpoint), visible radius geometry and category/radius filtering of fixtures. Invalid new drops preserve the current pin; invalid moves restore it. Stable MapLibre marker identity and request/ID guards prevent stale changes. The single-pin checkpoint deliberately precedes Step 4 multiple pins and union filters.

Bundled versioned NYC borough/hydrography land mask with water exclusions, source metadata and reproducible simplification script. Land validation is offline and approximate (~1 m simplification), not a property-access guarantee. No backend edits.

27 Swift tests and mocked JavaScript bridge checks pass. Mac, large/compact Simulator and unsigned generic iPhone builds pass. Selected-pin screenshots saved under docs/design-reference/2026-09-27-step-3. Touch/haptics/VoiceOver/performance acceptance remains pending; test.md contains the next user checklist. Do not claim 60fps from screenshots.

Phone setup is complete and the earlier build was installed and confirmed working. The device subsequently became unavailable; Step 3 is NOT yet installed on it. Reconnect/unlock and rerun the signed build/install when available. Personal signing/project and Xcode scheme changes remain user-owned and unstaged. Next: Step 3 phone test and feedback corrections before Step 4. Earlier touch/aesthetic acceptance is not inferred from “works on iPhone.”

### Step 2 — visual review and physical-phone setup

User asked to test on connected iPhone, otherwise authorized Step 2. Device discovery (outside sandbox) returned no devices; no valid signing identity/development team configured. Opened the standalone Xcode project and saved concise setup in docs/IPHONE_TESTING.md. Physical-iPhone unsigned compilation passed; cannot install until user pairs/signs.

Implemented brighter shared palette; unified native/web marker colors and map terrain/CSS through HermiPalette injected at WK document start. Removed default wordmark/developer menu on all Home pages; Debug --hermi-lab retains tools. Shared pixel glyphs retained and Settings glyph prepared for later wiring. No backend changes. 20 package tests, Mac build, large-iPhone build/launch and JS syntax pass. Large Map/Feed/Profile screenshots captured. Smaller iPhone 16e build/install/launch and Map/Feed/Profile screenshot review passed; controls remain within the screen and media/map fill the viewport. Step 1 touch acceptance and Step 2 aesthetic acceptance remain pending. Next: user phone setup plus test.md feedback, then correct this increment before Step 3.

Opening Xcode caused a scheme-format/version rewrite; preserve it unstaged as incidental project state rather than include it in the visual change.

### Approved plan Step 1 — navigation implementation ready for user test

2026-09-27: user approved the revision plan and requested only Step 1. Consolidated approved decisions in docs/FRONTEND_IMPLEMENTATION_PLAN.md and schema revision 5. Replaced the pill-level high-priority recognizer with button-scoped exclusive tap/hold handling; Map / Feed / Profile order; rectangular 64×48 hit areas; stationary hold help without navigation; held slide commits a different destination only inside pill bounds; cancellation preserves current page. Accessibility activation and selected traits retained. Other controls' existing help recognizers remain outside this navigation-only change.

20 package tests passed; iPhone build/install/launch and Mac build passed. Simulator accessibility click navigation to Feed/Profile succeeded. Saved before/after screenshots under docs/design-reference/2026-09-27-step-1. Physical tap timing, hold/scrub/cancel, larger text, VoiceOver and map/Feed gesture isolation await user test; no user acceptance claimed. Coordinate click attempts were inconclusive. test.md has the active six-step checklist. Next: receive Step 1 feedback, fix/retest as needed; do not start Step 2 yet. The backend rating issue remains pending Step 0 follow-up; no backend code changed, no pushes.

### Active correction: 01e — Feed gestures, full Plan and Action entry

User requests Add/remove toggle, long-hold explanations, notched Plan icon, vertical Feed, hold/slide Home navigation without intercepting map pan, full Plan timeline with reorder/time/reminders/attendees, separate Saved, and Go!/Action. Implemented local preview: 4 finite Feed cards plus end, two-card Friends filter; Save/Add independent toggles; hold helpers; pill-only long-hold selection; full/compact Plan, separate grouped Saved; time/duration/reminder draft persistence; stop drag/drop plus accessibility reorder; participant draft with explicit no-send semantics; Go enters Directions/Camera-only Action preview, no sensors/capture/tracking. Camera/invites/reminders/live directions remain integration gates.

Mac/iPhone initial builds and 19 state tests passed. Simulator reported user interaction during agent inspection, so clicks stopped. Read-only screenshot exposed cramped held-category labels; fixed width/alignment in source. Final Mac/iPhone build-only checks passed without restarting user's Simulator. Latest help/pin-label refinements are compiled and will install on the next simulator-preview.sh launch. Next: user exercises the four checklist groups in test.md; record results before advancing. No acceptance or pushes.

### Previous correction: 01d — supplied board comparison

User reports Feed/full-screen and missing Camera/Create/two controls. Three supplied screenshots reviewed in the conversation; comparison saved in docs/design-reference/2026-09-26-board/REVIEW.md with outstanding ambiguities. Temporary attachment copying was blocked by macOS; the existing board PDF remains local. Simulator inspection confirmed Feed media bands, Save-only control and wrong Feed Social navigation. Media crop corrected and inspected in Simulator; iPhone build passed. User clarified “feedback” means feedback to the agent; Feed has Save-for-later and Add-to-plan, Camera/Create only in Go!/Action. Implemented separate stacked pixel Save/Add controls and full-width place strip; actions reuse tested independent saved/plan state with duplicate prevention. Mac and iPhone builds passed. Simulator confirmed two controls, full-width strip, Add producing one stop and becoming disabled; the existing Saved state remained intact. Next: user checklist in test.md. Feed Social audience filtering and later Plan/place-detail layouts remain known gaps; no visual acceptance.

### Previous correction: 01c

User rejected bounded illustration, mismatched pin icons, safe-area white bands, category arrows, incorrect Profile tabs and conditional Plan. Implementing geographic MapLibre/OpenFreeMap with bundled pinned renderer, shared pixel ballpoint pins, hold/vertical selection, permanent Plan/Social, edge-to-edge backgrounds, Adventures/Posts with grid/modal and Saved in Plan. User clarified own Adventures only with stats/info; header Friends | Score | Rank leads separately to friend routes. Clarification implemented. Friend sharing confirmed opt-in: Private / Friends / Everyone via persistent left-side Adventures control. Implemented local preview preference with explicit Save; no live publishing or private friend access. Backend untouched. 16 state tests passed; Mac/iPhone builds passed, real tiles/zoom/layout and Profile grid/modal inspected. Fixed safe-area status overlap and UTF-8 attribution. Latest Profile/sharing revision is built for Mac/iPhone; user review in test.md is next. Full pin gesture/haptic/accessibility/offline/sharing-save checks remain pending; no visual acceptance. Simulator reported active user interaction, so agent UI control stopped. Latest build-only checks preserve the user’s running session; rerun simulator-preview.sh after user review to install any subsequent minor reset/pin-anchor corrections. No acceptance or pushes.

### Previous correction: 01b

The user rejected the text/card-led gallery as inconsistent with their Miro layout. `../My First Board.pdf` has now been text-extracted and visually inspected, including detailed main map and feed/plan regions. Current work replaces the launch view with a map-first composition, right-side category/social controls, bottom Feed/Map/Profile pill and contextual sheets. Component lab moves behind the preview menu. Default map is labeled illustration/sample, not live geography. Preserve prior work and do not advance to backend/device features.

Revision 01b is ready for user review. 14 local state tests passed; Mac and iPhone builds passed. Map and place-sheet composition inspected, explicit Add/duplicate prevention/My plan exercised. Feed inspection exposed an oversized media layout shifting controls offscreen; the media now has an explicit viewport frame. Simulator launch terminates the previous preview process before installing. No backend changes or pushes. Next: user checklist in test.md; do not advance until aesthetic acceptance.

### Previous handoff

- Increment 00: user reviewed the plan and supplied corrections. Consolidated into [unified schema](HERMI_SCHEMA.md). Do not request the same review again.
- Increment 01: **ready for user test**. No visual acceptance yet; do not begin 02 without user acceptance.
- Delivered: isolated SwiftUI gallery with Places, Controls and Score specimens, photo/video placements, sample states, accessibility preview options, durable sample state and Reset.
- Commits: 65ba236 consolidates the schema/tests; 77ad3ef implements the foundation. Nothing pushed.
- Verification: 7 XCTest cases passed; Mac build and iPhone simulator build passed. Both apps launched; initial layouts inspected. Mac bookmark/Add/Remove/control feedback and 250→249 Score expiry exercised. Larger-text/VoiceOver and remaining hands-on scenarios await review.
- The UI reported user activity in Simulator and Mac preview; agent interaction stopped rather than competing for controls.
- User test entry point: [test.md](test.md).

## Repository state

Existing local commits 0d1c9b1 and a290d57 predate the Hermi schema. Many legacy prototype files remain uncommitted and unaccepted. Preserve them; stage only increment-specific work. New foundation lives in apps/ios/HermiPreview to avoid depending on unfinished features.

Remote repository is https://github.com/jackb-22/Hermi. Remote de17d60 reviewed read-only; local backend is still 3f546af. Origin still uses the old redirecting URL. No backend merge or remote configuration change is necessary for the isolated foundation.

## Recovery instructions

1. Read docs/HERMI_SCHEMA.md and this file before editing.
2. Check git status and preserve all unrelated changes.
3. Read test.md for active increment and user results.
4. Resume the recorded next action; do not advance before user acceptance.
5. Commit scoped changes after validation and record the actual outcome.

## Environment

Xcode: /Applications/Xcode.app (26.3). Use DEVELOPER_DIR per command; global xcode-select still points to CommandLineTools. Installed SDKs: iOS/macOS26.2; simulator runtime iOS26.3. Real-device signing is configured by the user; the earlier build runs on iPhone. No live API environment has been accepted.

## Next action

Run the Step 8 local editing checklist in test.md on iPhone and correct feedback. Cloud sync/retry and real sharing remain blocked separately. Simulator preview is available using `sh apps/ios/HermiPreview/scripts/simulator-preview.sh` from the repository root. Keep unrelated prototype/signing changes untouched; no pushes.

## Build notes

The simulator uses iPhone17 Pro Max, UDID 0EA96F52-7FA4-40B1-BEF0-B1CD5B9EBCB9, runtime iOS26.3. App identifier tech.hermi.designpreview. Initial simulator build exposed mismatched architecture selection; the standalone Debug app target now uses ONLY_ACTIVE_ARCH=YES and builds successfully. Its AppIntents metadata warning is non-blocking because this preview has no AppIntents dependency. Build artifacts/logs are ignored under apps/ios/HermiPreview/.build; no build cache was committed. The standalone package tests run with DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox.

Verification update: Settings → Replay intro demo was invoked in Simulator and returned to Map automatically. Final unsigned iPhone rebuild passed after the returning-user migration adjustment.

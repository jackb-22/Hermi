# Hermi round 2 — iPhone visual verification

2026-10-12 · Current checkout reviewed on a physical iPhone 17 Pro, then rebuilt and inspected in iPhone 16e Simulator (iOS 26.3). This is local sample-preview content; no authenticated account data or user photos were loaded.

## Visual comparison and findings

The physical phone opened the signed Hermi build after first-launch onboarding was skipped. Map, Feed and Profile carried the visual reference's map-first navigation, warm paper surfaces, navy selection, pixel map/markers and shared hermit artwork. The bottom Map / Feed / Profile pill remained visible across those screens. Feed's full-screen illustrated media layout matches the supplied iPhone 16e reference in composition and control placement. The real device was an iPhone 17 Pro; its visible content and safe areas differed in scale from the 16e reference as expected, with no tab clipping observed.

The physical Profile → Adventures screen exposed one defect: `SAMPLE ROUTE · NOT RECORDED GPS` shared the map's bottom-left region with MapLibre's info/attribution button and was partly covered. In the current simulator build, moving the notice to a quiet, opaque-backed chip at the map's upper-left made all of the label readable and cleared the attribution button and bottom navigation. The pixel map and dashed route remain the focal content. Fix: commit `3f10751` (`fix: keep profile route notice clear of map controls`).

In the simulator's empty My Plan state, disabled `Go!` faded both its label and surface. A gray pixel surface with dark ink now indicates unavailability while keeping the label legible. The action remains disabled and the screen already explains that a place must be added first. Fix: commit `7e574a6` (`fix: keep disabled plan action readable`).

The Feed full-text action opened the expected scrollable caption sheet and accessibility reported the button as “Read full caption.” For this short sample, the sheet opens at half height with substantial blank paper beneath one line of text. That is a mild content-fit tradeoff in this fixture; the sheet is intended for longer clipped captions and remains expandable/scrollable. The Feed itself clearly labels the image as a sample media placeholder. No real or owned media was added because asset provenance and reuse permission were not established.

Assistant → Add a stop showed seven distinct, readable category choices in the existing square pixel panels. The rounded/shaded outer chrome concern from the desktop render did not reproduce on iPhone, so no styling change was made (R2.11 closed without a commit). The simulator accessibility tree exposed all seven categories as named buttons.

## Evidence

- [Profile with corrected sample-route notice](profile-notice-after.jpeg)
- [Empty Plan with corrected disabled Go action](plan-disabled-after.jpeg)
- [Standard-size Plan with a wider schedule column](standard-plan-columns-iphone17pm.jpeg)
- [Large-text Plan with schedule at left and event cards at right](accessibility-plan-columns-iphone17pm.jpeg)
- [Feed on iPhone 16e](feed-current.jpeg)
- [Full-caption sheet](feed-caption-sheet.jpeg)
- [Assistant category choices](assistant-categories.jpeg)
- Existing visual references: [Feed](../../2026-10-12-curated-ui/07-feed-profile/feed-iphone-16e.jpg), [Profile Adventures](../../2026-10-12-curated-ui/07-feed-profile/profile-iphone-16e.jpg), [Profile Posts](../../2026-10-12-curated-ui/07-feed-profile/profile-posts-iphone-16e.jpg), [populated Plan](../../2026-10-12-curated-ui/04-plan-reading/populated-plan-desktop.jpg), and [empty Saved](../../2026-10-12-curated-ui/05-saved/saved-empty-desktop.jpg).

## Verification and limits

- iPhone 17 Pro: Xcode-installed build launched after the first-run intro; Map, Feed and Profile were visually inspected. The developer signing team was trusted on-device to permit launch. The two follow-up fixes were made afterward, so they were not installed or rechecked on the physical phone.
- iPhone 16e Simulator, iOS 26.3: current checkout rebuilt after both fixes. Profile notice, disabled Go, Feed, full-caption sheet, and Assistant category state were rendered and inspected at default text size. The `--hermi-demo` path reached the preview, onboarding Skip worked, and Map → Plan/Assistant and Feed → caption were exercised.
- iPhone 17 Pro Max Simulator, iOS 26.3: after the user's review, the standard Plan fixture was rebuilt with a 112-point schedule column; dates, times, and duration/reminder remain readable on the left while full stop names fit in the right cards. The `.accessibility5` fixture uses a bounded 128–152-point schedule column; long stop names wrap in the right cards without clipping. Times show a localized hour/minute and period, and duration/reminder retain separate lines at this size. The category-colored divider was removed. The first two rows are visible in the captured large-text viewport; scrolling to lower rows and Go remains unverified. Physical-device text-size settings and VoiceOver speech were not tested.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox`: 120 tests passed, 0 failures.
- `node scripts/test-map-bridge.cjs`: all map, route, social, explored-area, landmark and map-chrome checks passed.
- `git diff --check`: passed before documentation updates.
- A follow-up `--hermi-saved-review=long --hermi-type-review=xxxl` simulator build failed before app launch. CoreSimulatorService disconnected, and Xcode could not write SwiftPM's user-library manifest diagnostic. Therefore Saved at accessibility text size remains unverified in this pass.
- iPhone Mirroring later displayed a Mac-login gate; no Mac credentials were entered. Simulator interaction was closed after review. The physical iPhone was not altered by the simulator actions.

Large-text Plan columns are now visually verified in the iPhone 17 Pro Max Simulator fixture. Saved at accessibility size, VoiceOver speech, user-controlled Dynamic Type settings on physical iPhone, reduced-motion behavior, keyboard avoidance, other width variants, live account responses, media loading/error with real content, haptics and physical-device behavior after the two map/Plan fixes remain unverified. Production acceptance is separate from this local visual review.

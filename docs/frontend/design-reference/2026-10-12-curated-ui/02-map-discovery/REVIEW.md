# Increment 2 — Map and discovery review

2026-10-12 · Implemented, committed, and desktop-verified. Awaiting user review before increment 3. Native iPhone verification remains pending.

## What changed

The category label now reads as a tappable chip and uses a restrained green fill/border when its citywide filter is active. The category selector keeps its ballpoint pin and existing tap, swipe, hold-to-drag, and VoiceOver adjustable actions. Social and My Plan share one quiet framed rail, with separate 44-point targets and accessible labels. Nearby now separates its heading from the pin/filter summary, uses the shared text roles, and wraps place names instead of cutting them off. Feed still has its own audience and content filters; Profile still offers Settings and Saved.

The Map fixture remains the existing local Columbia sample. No location or account data is sent. The desktop preview launcher now obtains the active SwiftPM binary path, so the app bundle opens on the current architecture-specific build output.

Requirements: NAV-01, SHEET-01, MAP-01, MAP-02, PREVIEW-01.

## Open the preview

The native **Hermi Preview** app is open on the compact 375 × 667-point Map fixture, with Food citywide selected and Nearby visible. It includes a local discovery pin and sample place. To relaunch from the repository root, quit Hermi Preview with Command-Q and run:

```sh
sh apps/ios/HermiPreview/scripts/mac-preview.sh --hermi-pin-review --hermi-review-compact
```

Wait for the sample map tiles to load. Click the category chip to toggle the citywide filter and open Nearby. Click the sheet handle to expand or collapse it. The Map pan/zoom/recenter controls and attribution remain available in the map surface when the sheet is compact.

## What to test and expected results

1. **Category chip:** tap Food. It should show the active green outline/fill and Nearby should say `Food citywide`; tap again and the summary should clear. The selected state should be legible without overpowering the map.
2. **Category navigation:** use the left/right arrows or swipe the pin horizontally to cycle categories. The chosen label should track the pin. A normal tap on the label toggles its filter. On iPhone, also check hold, slide, and drop on an open map area.
3. **Nearby hierarchy:** expand the sheet. Nearby should lead, then the pin/filter summary, then the result tile and full `Corner café` name. Collapse it and check that the map and bottom navigation remain usable. Try selecting the result and closing its details.
4. **Social:** turn Social on and off. Its icon should show its active state, sample friend markers should appear only while on, and the visible sample-data label should remain clear.
5. **My Plan:** open and close My Plan from the rail. The rail should not also show Feed filters on Map; the Plan should remain empty because this fixture adds no destinations.
6. **Map and attribution:** pan, zoom, and recenter while Nearby is compact. Expand Nearby and verify the map controls clear the sheet. Open and close attribution and check that it does not overlap sheet content or controls.
7. **Navigation and accessibility:** switch Map/Feed/Profile; Feed filters should appear only in Feed and Settings/Saved only in Profile. With VoiceOver, locate the category control, hear its selected category and citywide state, and activate its adjustable actions. On iPhone, assess physical drag and haptic feedback.

Please report any visual or behavior issues, or explicitly approve increment 3. I will wait here before changing Place details.

## Visual and interaction evidence

| Capture | What it establishes |
| --- | --- |
| [Map with selected category](map-selected-desktop.jpg) | Fixed compact review viewport with category state, grouped Social/Plan rail, active discovery pin, zoom/recenter, map attribution, and bottom navigation |
| [Nearby expanded](nearby-expanded-desktop.jpg) | Separate title and filter summary; full place name appears below the result tile |

Captures are unmodified native desktop screenshots. The review viewport is 375 × 667 points inside a macOS window; window chrome is included. This is not an iPhone render.

Desktop interactions exercised: citywide filter on/off, Social off/on, My Plan open/close, Nearby compact/expanded. Map bridge checks cover independent map projection, pin movement/radius, overlay-aware clearance and credits. These automated checks do not substitute for physical iPhone pan/pinch, projected touch-drop, VoiceOver, or haptic review.

## Verification and limits

- `sh scripts/mac-preview.sh --build-only` passed.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox`: 116 tests passed, zero failures.
- `node scripts/test-map-bridge.cjs`: all Map, multi-pin, Social, route, explored, live-social, landmark, and map-chrome checks passed.
- The earlier iPhone build was blocked before source compilation by sandbox access to Xcode's SwiftPM manifest diagnostics cache. No new iPhone build, Simulator render, VoiceOver-device, or haptic acceptance is claimed.

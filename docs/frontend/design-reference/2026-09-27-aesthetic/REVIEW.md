# Aesthetic review

- Shared chrome uses graphite ink and warm paper. Map land is limestone, parks muted sage-gray, water blue-gray. The lime action highlight remains unchanged; Nature has its own sage category color.
- My Plan stop fills and timeline accents follow each place category. Food, Culture and Nature checked in the iPhone 16e plan fixture.
- Five original native SVG pixel landmarks: Empire State, Flatiron, Columbia crown, Central Park pigeon, Hudson sailboat. Fixed 40 × 48 point bounds, hidden below zoom 12.5, no pointer events. Columbia checked on the geographic map.
- Discovery pins have explicit z-index 20, above decorative landmarks (1), other DOM markers (10), and WebGL place dots. Existing click propagation/drag handling preserved. Duplicate floating category badges removed; category symbols stay inside pins.
- Brand uses a 64 × 72 native Canvas grid with limestone tiers/window ribs, coral pincers, separate legs and eye glints, based on the original App logo.jpg. No raster dependency. Reviewed at 128 × 144 points in the existing intro fixture.
- Existing 5.4-second, skippable intro and first-load/recovery/reduced-motion policies preserved. Visual timing now includes two cautious steps, a pause, acceleration, then constant crawl. Sand-colored tracks replace gray marks. No new loading gates or network dependencies.

Validation: 87 Swift tests passed; map bridge behavior checks passed; iOS simulator build succeeded; git diff whitespace check passed. Simulator screenshots: brand.png and plan.png. Business logic, persistence and backend untouched.

Only the design files were staged. Unrelated untracked duplicate files appeared in the working copy during verification and were left untouched.

## User refinement: vibrant map and Liberty torch

Restored the original map land, cover, park, building, path, water and bright street colors. UI category colors and pin/landmark improvements remain. Added a patinated copper Statue of Liberty torch with a gold flame to the raised crab claw; it travels with the crab during the intro. Updated brand.png from the iPhone 16e simulator. Simulator build and map bridge checks passed.

## Landmark expansion and zoom response

Replaced the five small sprites with fourteen detailed 64 × 72 pixel miniatures: Liberty, Empire State, Central Park pigeon, Brooklyn Bridge, Times Square, Columbia crown, Unisphere, Yankee Stadium, Coney Island Wonder Wheel, Washington Square Arch, Flatiron, Chrysler, Grand Central and Hudson sailboat. Short labels reinforce identification. Artwork now occupies 52 × 64 CSS pixels at close zoom, growing smoothly to 65 × 80 at zoom 11 and below. Screen-space overlap suppression prioritizes major sights; panning and zooming recalculate visibility. Landmarks remain below pins and ignore touches.

Reviewed the complete sprite sheet and the actual map renderer at Midtown and city overview scales in the browser, plus the Columbia view on iPhone 16e. Landmark tests verify all 14 sprites, size bounds, overlap suppression and visibility changes on pan. Existing map bridge behavior tests pass. Updated iOS simulator build succeeds. See landmarks.png and landmarks-map.png.

## Home Screen icon and physical iPhone

Added an opaque 1024 × 1024 AppIcon asset rendered directly from HermitBrandMark, including the Liberty torch. Both Debug and Release target settings use AppIcon, and the built Info.plist includes CFBundlePrimaryIcon. Regenerate with `python3 scripts/generate-app-icon.py` from apps/ios/HermiPreview on a Mac with Xcode.

Physical iPhone 17 Pro was paired over USB with Developer Mode enabled. Compilation and asset processing completed; the synced Desktop build folder repeatedly acquired Finder metadata that blocked final signing. Copied the compiled bundle with `ditto --norsrc --noextattr` to a temporary folder, signed with the existing development identity/entitlements, and verified with `codesign --verify --deep --strict`. Device installation and launch both succeeded. No device settings or app data were reset.

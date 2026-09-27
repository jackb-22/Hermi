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

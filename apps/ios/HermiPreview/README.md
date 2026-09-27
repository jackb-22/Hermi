# Hermi visual foundation

Revision 01c follows the board's map-first layout and the user's six corrections. HermiDesign is independent of the old prototype/backend. The map now uses real geographic coordinates and public OpenFreeMap tiles via bundled MapLibre 5.6.0, styled with a low-resolution canvas and shared pixel pins. Account content stays labeled sample data. Decisions: ../../../docs/HERMI_SCHEMA.md. Current user tests: ../../../test.md.

From this directory:

```sh
sh scripts/mac-preview.sh
sh scripts/simulator-preview.sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox
```

For Xcode's canvas, open HermiPreview.xcodeproj and Sources/HermiDesign/HermiMapPreview.swift; use its `#Preview`. Select the HermiPreview scheme and an installed iPhone simulator to Run. The Mac executable is a separate fallback for visual testing.

The preview launches on Map. Pan and pinch freely, or use pixel zoom/recenter controls. Hold the ballpoint pin, slide vertically to choose a category, release; hold and drag horizontally onto the map to discover. No placeholder plan stops are inserted. Social and Plan remain visible; Saved lives in Plan. Profile has Friends | Score | Rank plus Adventures/Posts icon tabs. Adventures contains own routes with an info/stats entry; Posts is a three-column sample grid opening place-specific media/review sheets.

Tiles need internet. The preview has no account backend connection, GPS recording, real post playback or verified friend history. Route sharing is opt-in through a persistent left-side Adventures icon, private by default. Private/Friends/Everyone saves only a local preview setting; live publishing is not connected. Physical haptics require iPhone. State persists under hermi.preview.map-composition.v1; Reset clears local plans/discovery. The old component gallery remains in the preview menu. Source/license details are in Sources/HermiDesign/Resources/README.md.

Public app branding is Hermi. The existing repository folder and old prototype files still use Cairn until their respective increments migrate them; do not mass-rename or discard them.

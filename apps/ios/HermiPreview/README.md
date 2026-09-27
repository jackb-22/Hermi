# Hermi visual foundation

Revision 01b: an isolated, network-free SwiftUI map-first composition following My First Board.pdf. The component gallery remains available through the hermi preview menu. Reusable HermiDesign components have no dependency on the legacy prototype, backend, credentials or device permissions. User decisions are in ../../../docs/HERMI_SCHEMA.md; acceptance is recorded in ../../../test.md.

From this directory:

```sh
sh scripts/mac-preview.sh
sh scripts/simulator-preview.sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox
```

For Xcode's canvas, open HermiPreview.xcodeproj and Sources/HermiDesign/HermiMapPreview.swift; use its `#Preview`. Select the HermiPreview scheme and an installed iPhone simulator to Run. The Mac executable is a separate fallback for visual testing.

The preview launches on Map with the bottom Feed / Map / Profile pill. Right-side category controls filter sample markers or drag a discovery pin onto the illustrated map. Selecting a place opens a compact media sheet; only Add inserts an explicit place in My plan. Preview state persists under hermi.preview.map-composition.v1. Reset clears the plan and discovery, restores Food / Solo / Map, and recenters the illustration. The component lab retains its separate foundation preferences.

Map, Feed and Profile use original vector artwork and labeled sample media placements. No live geography, video playback, device permissions or backend writes are integrated here. Social markers are samples. This increment tests composition and local navigation, not complete product features. The system Reduce Motion setting is respected.

Public app branding is Hermi. The existing repository folder and old prototype files still use Cairn until their respective increments migrate them; do not mass-rename or discard them.

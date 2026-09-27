# Hermi visual foundation

Increment 01: an isolated, network-free SwiftUI gallery. Reusable HermiDesign components have no dependency on the legacy prototype, backend, credentials or device permissions. User decisions are in ../../../docs/HERMI_SCHEMA.md; acceptance is recorded in ../../../test.md.

From this directory:

```sh
sh scripts/mac-preview.sh
sh scripts/simulator-preview.sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox
```

For Xcode's canvas, open HermiPreview.xcodeproj and HermiGallery.swift; use its `#Preview`. Select the HermiPreview scheme and an installed iPhone simulator to Run. The Mac executable is a separate fallback for visual testing.

The preview starts with Nature, Riverside Park, no saved/added places, Alex, Score250, standard text and no forced reduced motion. Preview changes persist locally under hermi.preview.foundation.v1. Reset restores all these values and returns to Places. The system Reduce Motion setting is always respected.

The pixel park is original vector artwork demonstrating a 4:3 photo placement. The 9:16 video poster is a labeled noninteractive placement. Neither claims to be real verified media. Categories/bookmarks/Add operate only on sample state. This is not the complete Map, Plan, Profile or Feed implementation.

Public app branding is Hermi. The existing repository folder and old prototype files still use Cairn until their respective increments migrate them; do not mass-rename or discard them.

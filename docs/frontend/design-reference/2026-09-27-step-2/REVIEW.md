# Step 2 visual checkpoint

2026-09-27. User authorized Step 2 while physical-phone setup and Step 1 touch review remain pending.

| Screen | iPhone 17 Pro Max | iPhone 16e |
| --- | --- | --- |
| Map | [Large](map-large.png) | [Compact](map-compact.png) |
| Feed | [Large](feed-large.png) | [Compact](feed-compact.png) |
| Profile | [Large](profile-large.png) | [Compact](profile-compact.png) |

Compared with [Step 1](../2026-09-27-step-1/REVIEW.md): removed the top-left wordmark/menu, brighter water and category accents, unchanged three-part pill and pixel glyph language. Native category swatches and map markers now use identical RGB tokens. Map/media extend to screen edges; controls fit the compact viewport without crossing the notch or bottom edge. Profile retains its existing content structure for the later dedicated checkpoint. Map camera/fixture selections differ between devices, so these are visual layout comparisons, not a pixel-diff pass.

Palette: ink #203D39, paper #F8FAF3, green #23856B, lime #BFDE59, lake #69B7CC, coral #EF8067, lavender #A596DD. Terrain stays quieter than interactive accents. Contrast spot checks: ink/paper 11.16:1; ink/lime 7.72:1; white/green 4.53:1.

Validation: 20 package tests passed, Mac and both simulator builds passed, generic physical-iPhone build passed without signing, JS syntax passed. iPhone device discovery still reports no devices. No physical install, haptic, camera or NFC result is claimed. User aesthetic approval and touch review remain pending; use test.md.

Pin category interiors, multi-pin filtering, drag/radius fixes, contextual sheet behavior and toolbar routing belong to later checkpoints. Existing sample geography/content is not real account data. The Settings pixel glyph is prepared but not wired until the Settings checkpoint.

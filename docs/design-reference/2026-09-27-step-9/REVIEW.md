# Step 9 visual review — 2026-09-27

Fixture: `--hermi-feed-review`, iPhone 16e Simulator, iOS 26.3. All images were visually inspected. Sample media and route art are placeholders. No normal preview data is overwritten.

- [Public Posts](public-posts.png) and [Friends Posts](friends-posts.png): full-bleed imagery, aligned Social/chevron rail, separate bookmark/plus and place strip above the pill.
- [Public Plans](public-plans.png) and [Friends Plans](friends-plans.png): independent filter combinations; numbered illustrative route, horizontal explicit-stop chips, bookmark and append controls. Route is not geographic evidence.
- [Profile](profile.png): Settings above Saved on the right, Adventures/Posts only, stats retained. Existing map attribution/sample label are close together at the bottom; revisit their spacing in the profile map polish boundary.
- [Settings](settings.png): private/off defaults, disabled live visibility while off, clear local-only status. Cancel was exercised.
- [Own post](own-post.png): only own media placeholders and review no-data state; no friends’ section, X close.

53 Swift tests passed, Simulator build/launch and unsigned iPhone build passed. Models cover filter independence, discovery scope, bookmark/plan independence, plan-copy append/Undo and preference migration/roundtrip. These images do not prove 60fps, real media playback, backend privacy, physical touch behavior or restart persistence. User screenshot/gesture review remains pending in [test.md](../../../test.md).

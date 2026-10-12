# Approved Hermi logo integration — 2026-10-08

[Approved design](approved-logo.png): coral pixel crab carrying the Empire State Building as its shell, with the Statue of Liberty torch in its raised claw. The limestone rim wraps around a dark shell opening instead of reading as a separate platform behind the crab.

`apps/ios/HermiPreview/Sources/HermiDesign/HermitBrand.swift` implements the design as native pixel geometry. It preserves the crab's face, pose, claws and torch while updating the shell junction and colors. The reference is retained here; app views use the scalable drawing rather than embedding its background or image-generation texture.

All active frontend placements use this shared drawing, directly or through `HermitSprite`:

- Intro crawl and wordmark reveal; map and gallery loading indicators.
- Feed, live feed, live action, plan and saved-library empty states.
- AI request and chat thinking indicators.
- Map/profile account placeholders and gallery branding.
- iOS Home Screen icon, regenerated with `python3 scripts/generate-app-icon.py` from the same drawing.

The emergence animation now scales and fades the complete crab from inside the opening. The front rim is drawn over it, and intermediate poses no longer slide the face and feet below the view bounds. Existing timing, stride, Skip, returning-user policy and Reduce Motion behavior remain in place.

Validation:

- 116 Swift tests passed after the final drawing/animation change (`xcrun swift test --disable-sandbox`).
- iPhone 16e Simulator Debug build and launch passed.
- [Native size and animation review](native-sizes.png): 22, 30, 36, 50, 56, 60 and 128-point placements, plus hidden, partial and full-stride poses.
- Simulator inspection: [intro reveal](intro.png) and [empty plan](empty-plan.png). The assistant's 22/30-point mark is covered by the native size review and shared-component audit.

The intro frame uses `--hermi-demo --hermi-brand-frame=4.9`; the empty plan was opened from the map. A later attempt to launch the assistant loading fixture was blocked by Simulator/cache permissions. Partial animation poses were inspected as static native renders; this review does not claim a measured animation frame rate or physical-device validation.

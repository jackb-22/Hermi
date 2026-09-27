# Branding review — 2026-09-27

[Original supplied asset](source-logo.jpg): detailed pixel crab with skyscraper shell and street scenery. User explicitly approved retaining the skyscraper and stripping scenery. Native `HermitBrandMark` redraw uses Hermi's flat palette and separate animated parts; no gradients, bitmap enlargement or source-image modification.

- [Reveal](reveal.png): centered scalable mark and lowercase wordmark on brand paper, with Skip available.
- [Crawl](crawl.png): frozen 2.6-second frame, crab and faint staggered tracks; this is frame review, not measured motion quality.
- [Empty Plan](empty-plan.png): small static motif, explicit-add guidance and disabled Go for an empty plan.

57 Swift tests pass; Simulator and unsigned iPhone builds pass. Skip and returning-user normal launch were exercised. Final code also treats pre-branding local data as returning use. Full playback/phone animation acceptance and Reduce Motion remain user tests; no 60fps claim is made. Debug `--hermi-demo --hermi-brand-frame=2.6` or `=4.8` freezes a frame; omit the frame flag for playback. Settings offers Replay intro demo for normal runs. See test.md for launch boundaries and loader checks.

Verification update: Settings → Replay intro demo was invoked in Simulator and returned to Map automatically. Final unsigned iPhone rebuild passed after the returning-user migration adjustment.

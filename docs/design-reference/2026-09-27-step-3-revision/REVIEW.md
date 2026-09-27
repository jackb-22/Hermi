# Step 3 feedback correction — 2026-09-27

[Selected pin](selected.png): compact iPhone 16e, one category-colored recommendation dot distinct from the discovery pin; small X attached to pin; transparent bottom-right slider above compact zoom/home backgrounds. Source pin has chevrons and category label without a menu. Map sample-place banner removed.

[Expanded panel](expanded.png): screenshot loop exposed toolbar overlap in the first revision. Final layout shifts upper tools left of the raised map controls and reveals the pin above the panel. The slider shortens to fit the remaining map area. All three map controls remain visible above the sheet.

Screenshots predate only the final invisible touch-target/drop-boundary refinements. Icons retain their prior dimensions. Native buttons keep 44-point label hit targets despite smaller backgrounds. Recommendation dots retain larger transparent click areas.

User confirmed 0.1–4 miles; new pins retain 1 mile. Existing valid saved radii remain compatible. JS tests verify empty-map deselection preserves marker data, range endpoints and editor offset. Swift tests verify filtering/land rejection/state persistence. A coordinate-based Simulator tap could not target the window reliably, so physical tap-away, direct category swipe, drag delivery/cancellation, haptics and VoiceOver are NOT claimed verified by screenshots. Follow test.md on the phone; it currently reports unavailable for agent installation. Content remains fixtures and NYC land validation remains approximate. No backend changes.

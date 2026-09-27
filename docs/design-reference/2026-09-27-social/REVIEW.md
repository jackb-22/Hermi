# Social map feedback review

2026-09-27 · iPhone 16e Simulator, iOS 26.3.

[Social map](social.png): dotted green current-adventure route, solid pink loved-adventure route, green shared-place sprite, pink loved-place heart. Right toolbar retains its vertical line. Initial screenshot found the sample label overlapping attribution; moved it higher and refreshed evidence.

Fixtures are explicitly labeled; no real friend location, GPS route or loves were loaded. Green has two opacity dips then a pause in a four-second cycle; Reduce Motion removes animation. Still images cannot verify the animation cadence.

55 Swift tests and map bridge suite pass. The bridge checks dotted versus solid styles, coordinates, Social/Solo clearing, Reduce Motion and removed map hold tips. Simulator and unsigned iPhone builds pass. Native/web hold explanation code removed; purposeful action holds remain. User phone gestures and animation feedback are pending in test.md.

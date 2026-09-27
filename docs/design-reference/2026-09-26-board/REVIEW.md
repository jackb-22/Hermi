# Board comparison — 01d

User supplied these three annotated board screenshots after revision01c and said full-screen treatment and Feed controls still do not match. This document records the supplied screenshots; their temporary files could not be copied because macOS denied directory access. The existing My First Board.pdf remains the durable visual source. This is a comparison, not acceptance of previously overridden board details.

## Confirmed differences to resolve

- Feed: full-screen media, not a media rectangle with colored bands. Current solid top/bottom bands traced to nested aspect-ratio layout; fixed and inspected in Simulator.
- Feed drawing has separate Save and Add-to-plan controls stacked lower-right, above a full-width compact place strip and the bottom pill. Corrected to separate Save/Add and full-width compact place strip.
- Feed Social changes content audience (friends/public), not navigation to Map. Current control incorrectly switches to Map.
- Map: dropped geographic filter, zoom-dependent small place icons/clustering, selection expands a place sheet. Current fixed fixture pins and sheet behavior do not implement all those transitions.
- Place detail: horizontal media strip plus distinct reviews/description controls around the Add action. These controls are not implemented as drawn.
- Plan: its own landing view, timeline/list, clock, bookmark toggle opening Saved, per-stop participant menu, Go. Current Plan is a simple sheet with inline Saved. Treat as a later explicit boundary, not completed functionality.
- Profile: center identity/school verification, Friends | Score | Rank, two icon tabs. Recent explicit amendment overrides the older drawing: own routes only in Adventures, friends via Friends entry, sharing icon on left, stats icon, opt-in private/friends/public sharing.

## Clarification received

“Feedback” means feedback to the agent. Confirmed Feed controls: bookmark = Save for later, + = Add to plan. Camera/Create exists only in Go!/Action mode. Implemented both stacked lower-right controls and the full-width compact place strip; Save and Add remain independent and Add is duplicate-safe.

## Authority conflicts already resolved

Keep Map centered in Feed/Map/Profile pill, seven categories, binary verified reviews and permanent Plan. The old screenshot's Map/Feed order, four categories, average stars, conditional Plan and friends section below own Adventures do not override later confirmed user decisions.

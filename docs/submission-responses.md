# Hermi — Submission Responses

Hermi is an iOS app for college students that brings city discovery, shared plans, and real-world exploration into one place.

## Tagline & elevator pitch

**Come out of your shell.**

Stop doomscrolling, start exploring. Hermi turns city discovery into a shared, game-style adventure. Find a place, make a plan with friends, and head outside. In-person hangouts build streaks, while exploration earns progress you can see.

## Project story

### Inspiration

Growing up in New York City, our teammate Jack watched a vibrant street culture increasingly compete with life on a screen. We can collect online connections while losing touch with the people and places around us. Even when we want to meet up, a simple outing can mean juggling group chats, map links, and review sites.

We built Hermi to connect that scattered process: discovery, planning, and actually going. Its name draws on Hermes, the messenger god, and our mascot, a hermit crab. “Come out of your shell” captures the idea: use technology to make it easier to step outside.

Our “Anti-Tourist” approach encourages students to get to know their city through everyday adventures, including places they might otherwise walk past.

### What Hermi does

Hermi follows the journey from finding somewhere interesting to sharing an experience in person:

1. **Discover.** Explore a full-screen pixel-art map with recognizable NYC landmarks and category-colored places. Use discovery pins to narrow an area and browse recommendations informed by visits and personal taste.
2. **Plan together.** Save inspiration from the visual feed, build an itinerary, adjust stop durations, and invite friends. Shared outings also create opportunities to meet other students.
3. **Go outside.** Adventure mode focuses the interface on the next stop, check-ins, and capturing the outing. It provides distance information and opens Apple Maps for turn-by-turn directions.
4. **See your progress.** In-person hangouts build IRL streaks, and explored map tiles show where you have been. An outdoor Score, represented by a cairn of stacked stones, reflects recent activity and gives students a reason to keep exploring.

The pixel-art design makes the city feel playful while keeping the map and its controls readable. The goal is to make planning easy enough that the outing becomes the focus.

### How we built it

We started with the human experience, mapping the journey from “we should go somewhere” to meeting up before deciding how the screens and services should fit together.

The native iPhone interface uses Swift and SwiftUI with reusable visual components. A MapLibre GL JS map runs inside WebKit, with OpenFreeMap supplying the basemap and Overture Maps supplying place data.

The backend uses TypeScript, Node.js, and Fastify, with MongoDB and PostgreSQL with TimescaleDB for storage. Shared Zod schemas define and validate API contracts so discovery, plans, social activity, and exploration progress use consistent data structures.

### Challenges & lessons

**Making touch interactions feel natural.** Native SwiftUI controls and the embedded WebKit map had to distinguish category swipes, pin drags, and map pans. Testing on physical iPhones exposed interaction problems that were difficult to judge with a mouse in the simulator.

**Showing a detailed city without overwhelming the map.** Dense place data, landmarks, pins, and overlays competed for limited screen space. We iterated on scale, layering, and controls to keep places readable and pins easy to tap.

**Keeping social and planning data consistent.** User-to-user relationships and user-to-place activity needed to work together across the app. Explicit API contracts helped the frontend and backend teams develop concurrently and catch mismatches early.

The main lesson was that an app meant to encourage in-person experiences needs to remove friction at every step. Small details in gestures, layout, and data consistency affect whether a plan feels easy enough to follow through on.

## Built with

| Area | Technologies |
| --- | --- |
| iOS app | Swift, SwiftUI, Xcode, WebKit |
| Maps & place data | JavaScript, MapLibre GL JS, OpenFreeMap, Overture Maps |
| Backend & API contracts | TypeScript, Node.js, Fastify, Zod |
| Databases | MongoDB, PostgreSQL, TimescaleDB |
| AI & preference memory | Google Gemini API, Backboard |
| Development & testing | Docker, Vitest |

## Generative AI implementation

Hermi uses the Gemini API in its backend outing assistant for tool-based plan suggestions, visit-duration estimates, contextual recommendation ranking, and concise review summaries.

The model proposes ideas; application code validates place identifiers, constrains outputs, and computes the resulting behavior. Supported operations have deterministic fallbacks, keeping planning grounded in known places and explicit rules. AI output does not determine whether a user has physically visited a place or earned exploration rewards.

An optional Backboard integration provides persistent preference memory so recommendations can take a user's preferences into account across conversations.

**Submission status:** AI planning and editing APIs are implemented, but their suggestion and editing interfaces are not yet connected to the iOS app. The demo also includes seeded users and activity. See the [demo status and limitations](../README.md#whats-real-whats-seeded-what-isnt-built) for the distinction between live features, seeded content, and hardware stand-ins.

---

[Try Hermi](../README.md#try-hermi) · [Return to the project README](../README.md)

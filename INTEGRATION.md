# Hermi iOS ↔ backend integration

This file tracks the SwiftUI app (`apps/ios/HermiPreview`) as it moves from sample fixtures to the live `/v1` API.

- **Plan:** one commit per step, each ending in a Mac test checkpoint.
- **Sample mode stays:** when no server is connected, every screen runs on its fixtures exactly as before.

## Pointing the app at a server

1. **Laptop (Jack):** run `scripts/demo-up.sh`. It prints the HTTPS tunnel URL and the `x-dev-token`.
2. **App:** open Profile → Settings (gear) → **Server**.
   - Paste the URL. The Simulator shares the Mac clipboard: copy on the Mac, then in the Simulator use Edit → Paste, or ⌘V.
   - Enter the dev token and the username (`jack` or `jenny`).
   - Tap **Connect**. The badge changes from SAMPLE to LIVE.
3. **Optional:** preset the values at launch instead of typing them:
   ```sh
   SIMCTL_CHILD_HERMI_API_BASE=https://…trycloudflare.com SIMCTL_CHILD_HERMI_DEV_TOKEN=… \
     sh apps/ios/HermiPreview/scripts/simulator-preview.sh
   ```
   These values are used only when nothing has been saved in Settings yet.

The quick-tunnel URL changes every time `demo-up.sh` runs. After a restart, update it in Settings and tap Connect again.

## Mac test loop (every step)

```sh
git pull
cd apps/ios/HermiPreview
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --disable-sandbox
sh scripts/simulator-preview.sh
```

Paste any compile or test failure back verbatim.

---

## Step checklists

### Step 0: merge main into `frontend` (no app change)
- [ ] `swift test` passes: 62 tests, which is 55 from the frontend, plus 2 brand intro tests, plus 5 live contract tests.
- [ ] The Simulator launches to the Map exactly as before. On a first open with no saved preview, the crab intro plays first; that's the teammate's `58abb12`.

### Step 1: API client, Connect and live identity
- [ ] Without connecting: Profile still shows the sample "Alex" header, and Settings shows the **SAMPLE** badge.
- [ ] Settings → Server: enter URL, dev token and `jack`, then Connect. The badge shows **LIVE · @jack**, and the Profile header shows Jack's name and `@jack`.
- [ ] Quit the app and relaunch it with `simulator-preview.sh`: it is still LIVE, with no need to reconnect. Also try with the Simulator fully closed: the device boots cold, and the retry can take up to about 12 s. If it doesn't come back, open Settings and note the red message under Server.
- [ ] Send the app to the background and bring it back: it stays LIVE, and if the first restore had failed it retries.
- [ ] Enter a wrong dev token and Connect: an error message appears (UNAUTHORIZED or FORBIDDEN), and the app keeps working in sample mode. A failed Connect also clears the saved login, so reconnect with the right token before the next check.
- [ ] Disconnect: the badge goes back to SAMPLE and the header shows Alex again.
- [ ] The privacy preferences in the same Settings page still save as before.

### Step 2: real places on the map
- [ ] `swift test` passes: 65 tests, 3 of them new. `node scripts/test-map-bridge.cjs` also passes.
- [ ] **Sample mode** (Disconnected): the map shows the 7 sample dots exactly as before, and their sheets still show sample posts.
- [ ] **Connected** as jack: within about a second, the map fills with real venue dots around Columbia, up to 25 per category.
- [ ] Pan to another neighborhood (Midtown, the Village). About half a second after you stop, new dots appear for that area.
- [ ] Zoom out to the whole city: dots stay capped (about 175) and the map stays responsive.
- [ ] Tap a dot: the sheet shows the real venue name, its address and "% would go again" where known, and "No posts here yet." Real posts arrive in Step 4.
- [ ] Save (bookmark) and + Add on a real venue still toggle. Add it to My Plan: it shows there by its real name.
- [ ] Relaunch while connected: My Plan still lists the real venue, because the place cache is persisted.
- [ ] Discovery pins and the citywide category filter now filter the live dots. Full pin and filter behaviour on real data comes in Step 3.

### Step 3: discovery pins and citywide filter on real data
- [ ] `swift test` passes: 67 tests, 2 of them new.
- [ ] Connected: drop a **Food** pin near Columbia. Within about half a second, the dots reduce to real food places inside the circle, and the Nearby sheet lists them.
- [ ] Widen the pin's radius to 2–4 mi: more food places appear, including ones beyond the visible map, and the Nearby list grows.
- [ ] Drop a **Nature** pin in Brooklyn: the Food results stay and Nature places around the new pin are added. The two pins keep separate radii.
- [ ] Turn the **citywide Food** filter on with a tap on the category pin: food places across the visible map are added, up to 100. Turn it off and the view goes back to just the pin results.
- [ ] Remove every pin and the citywide filter: general discovery comes back, with all categories for the visible area.
- [ ] Drag a pin to a new spot: the results follow the pin.
- [ ] Sample mode (Disconnected): pins and the filter behave exactly as before, on the 7 fixtures.

### Step 3b: feedback fixes (density, citywide, Nearby, radius, park colour)
- [ ] `swift test` passes: 70 tests. `node scripts/test-map-bridge.cjs` also passes.
- [ ] **Density:** connected, Midtown fills with about 1,000 dots (up from about 175), spread over the whole screen. Panning and zooming stay smooth.
- [ ] Tapping a dot still opens that place. A tap on empty map still deselects the pin.
- [ ] **Citywide:** tap the category pin to turn on citywide Food. Food dots appear across all of Manhattan when you zoom out (several hundred), and non-food dots disappear if no pins are placed. Tap again to turn it off.
- [ ] **Nearby row:** with two pins placed, tapping one pin lists only that pin's places, nearest first. Tapping the other switches the list.
- [ ] **Radius:** a new pin starts at 0.25 mi.
- [ ] **Parks and forests** on the map are clearly darker green.
- [ ] **Brooklyn:** Williamsburg and the Queens and Brooklyn waterfront have places. Park Slope and Downtown Brooklyn are empty because there's no data there yet (D21).

---

## Deferred / deviations log

Items that are unconnected, need UI or backend work, or depart from `docs/HERMI_SCHEMA.md` / `docs/FRONTEND_IMPLEMENTATION_PLAN.md`. We come back to these after the main flow works.

| # | Area | Item | Why deferred |
|---|---|---|---|
| D1 | Auth | Onboarding (AUTH-01) is not built: explain → taste deck → Apple sign-in → .edu verification → profile setup. The app uses dev login by username. | Speed. The APIs exist (`/auth/apple`, `/auth/edu`, `/onboarding/deck`, `/me/taste`). |
| D2 | Auth | The JWT is stored in UserDefaults, not Keychain. | Hackathon shortcut. |
| D3 | Plans | The server caps a plan at 12 stops; the product has no cap. | Backend constraint. The server error is shown as a notice. |
| D4 | Places | `/places/near` is unused. Each pin uses a bbox query around its circle (category, limit 100) plus a client-side radius cut. | `/near` clamps to 1200 m and 10 results; pins go up to 4 miles. |
| D5 | AI | Schedule, ghost pins (`/ghosts`), `/plans/:id/ask` and the chips are not surfaced in the UI. | No UI exists for them yet. The APIs exist. |
| D6 | Sharing | Plan share links, and join/request/approve from Feed plan cards, are display-only. | Needs UI decisions. |
| D7 | Notifications | Reminders are not delivered, and push is not integrated. | The backend push provider expects Expo tokens; this is a native app. |
| D8 | Feed | The Friends/Public filter is done on the client (author ∈ friends). | `GET /feed` has no audience parameter. |
| D9 | Feed | Video shows a poster only; there is no inline playback. | Speed. |
| D10 | Privacy | Route audience and presence preferences stay local. Only `ghostMode` and `openToPlans` reach the server. | `PATCH /me` has no granular fields. |
| D11 | Reviews | There are no numeric ratings, only binary "would go again". | The backend has no rating schema. |
| D12 | Profile | Profile photo upload (`POST /me/photo`) is not wired. | Speed. |
| D13 | Profile | Adventures route history has no endpoint. | Backend gap. |
| D14 | Social | Loved places and loved adventures are hidden in live mode. | No API. |
| D15 | Action | There is no durable offline observation journal (TRACK-01/02), no client `endedAt` on End, and no stationary 60-minute prompt. | Speed, plus a backend contract gap. |
| D16 | Action | NFC is replaced by a dev-tag **Check in here** button. GPS dwell check-in is not surfaced. | Matches the prerecorded-demo decision. |
| D17 | Camera | Capture uses `UIImagePickerController` instead of the custom viewfinder. There is no ambient audio, no 15 s video and no QR scanning in the viewfinder. A DEBUG sample-photo fallback exists for the Simulator. | Speed. |
| D18 | Security | App Attest is not integrated. | The demo runs `ATTEST_MODE=log`. |
| D19 | Repo | The legacy `apps/ios/Package.swift` (CairnKit prototype, re-added on main in `50125cd`) is a separate package and is left untouched. | Not used by HermiPreview. |
| D20 | Config | The base URL must be re-entered whenever the quick tunnel restarts. | Use `NGROK_DOMAIN` with `demo-up.sh` for a stable URL. |
| D21 | Data | Places cover only Manhattan plus the Queens and Brooklyn waterfront (import bbox `-74.02,40.70,-73.91,40.88`). Most of Brooklyn and all of the Bronx and Staten Island are empty. | Importing more boroughs writes to the production database; Jack runs it. Mind the Atlas free-tier storage limit. |
| D22 | Accessibility | Place dots are drawn as a WebGL layer, so VoiceOver can't focus individual dots. The Nearby row is still accessible. | Needed for performance with about 1,000+ dots. |
| D23 | Design amendment | New discovery pins start at 0.25 mi instead of 1 mi. Park and forest map colours are darker. | User request, 2026-09-27. Supersedes the frontend docs. |


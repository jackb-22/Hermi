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

From the repo root:

```sh
sh apps/ios/HermiPreview/scripts/check.sh
```

The script does four things in order and stops at the first failure, printing the relevant log lines:
1. `git pull`;
2. `swift test`;
3. the map bridge check;
4. build, install and launch in the Simulator.

Options:
- `--no-pull` skips the pull.
- `--skip-tests` only pulls and launches.
- `HERMI_API_BASE=… HERMI_DEV_TOKEN=…` in front prefills Settings → Server.

Paste any failure output back verbatim.

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

### Step 3c: NYC-only map, category tap, tap-away, density
- [ ] `swift test` passes: 71 tests. `node scripts/test-map-bridge.cjs` also passes.
- [ ] **Bounds:** you can't pan or zoom far from NYC. A little New Jersey or Long Island shows at the edges, but no further.
- [ ] **No New Jersey dots:** look across the Hudson at Hoboken and Jersey City. There are no place dots there, while the Manhattan waterfront still has them.
- [ ] **Category pin tap:** tapping the category pin at the top right toggles citywide for that category. The underline shows it's on, and only that category shows, across the city. Tap again: general recommendations for all categories come back. Swiping still changes the category, and hold-then-drag still drops a pin.
- [ ] **Tap-away:** with a place or Nearby sheet open, tapping empty map closes the sheet. A place opened from My Plan goes back to the Plan.
- [ ] **Density:** a bit sparser map-wide (about 600–700 in Midtown), while inside a pin's circle it's dense: up to 100 per cell, and bigger circles are split into more cells.
- [ ] **Brooklyn and all boroughs:** only after Jack runs the import below. Park Slope, Queens, the Bronx and Staten Island then have places.

**Borough import (Jack, laptop):** the file `apps/api/data/nyc_places.geojsonseq` is already downloaded (816 MB). The importer now keeps only places inside the five boroughs: 65,719 of them (Manhattan 31.2k, Brooklyn 15.8k, Queens 11.6k, Bronx 4.9k, Staten Island 2.3k). It upserts by Overture ID, so existing places and their visits are kept.
```sh
cd apps/api
pnpm exec tsx --env-file=../../.env.demo scripts/import-overture.ts data/nyc_places.geojsonseq
```

### Step 4: place sheet detail and real posts
- [ ] `check.sh` passes: 73 tests.
- [ ] Connected: tap a real venue near Columbia. Under its name the sheet shows the address, four counters (**been · friends · here now · going**), and a line like "100% would go again · Hours unknown". Unknown values show "—" or "unknown", never 0 or "closed".
- [ ] Places with seeded posts show a **real photo**, the author's name and the caption. Try Butler Library, Book Culture, Havana Central at The West End, Barnard Archives, Macy Art Gallery or Cafe Amrita. While a photo loads it shows the pixel placeholder with a spinner.
- [ ] A place without posts shows "No posts here yet." after a brief "Loading posts…".
- [ ] Bookmark a post in the sheet: it toggles and appears in Saved (Plan → bookmark) during this session. It won't survive a relaunch until Step 5.
- [ ] Sample mode (Disconnected): the sample places still show their 3 sample posts with placeholders, and no detail block.

### Step 4b: smoother map loading
- [ ] `check.sh` passes: 74 tests.
- [ ] Pan slowly across Midtown: dots fill in tile by tile **while you're still dragging**, rather than all at once after you stop.
- [ ] Pan back to where you started: the dots are **already there**, with no reload.
- [ ] Short pans show dots at the screen edges right away, because a ring of tiles around the screen is preloaded.
- [ ] Zooming in or out loads a density that fits the new zoom. Pins and citywide behave as in 3c.
- [ ] Photos: the seeded posts are test patterns (coloured bars), not an app bug. Real photos need a reseed with `--media-dir` (see below).

**Real seed photos (Jack, laptop):** put up to 20 photos (jpg, png, heic; mp4 or mov also work as clips) in a folder, then:
```sh
cd apps/api
pnpm exec tsx --env-file=../../.env.demo scripts/seed.ts --reset --demo jack,jenny --media-dir ~/hermi-photos
```
Photos are assigned to seeded check-in places at random, so general NYC or campus shots work best.

### Step 5: saved places, posts and folders sync (plus 4b fixes)
- [ ] `check.sh` passes: 76 tests. The 2 failures from 4b (a stale catalog test) are fixed.
- [ ] **Zoom:** the + and − buttons are gone (pinch or the scroll wheel zooms), and only recenter remains. Pinching across zoom levels no longer blanks the dots: the old dots stay until the new ones load.
- [ ] Connected as jack: bookmark 2 real places (place sheet → bookmark) and 1 real post (bookmark on a post in a place sheet).
- [ ] Quit the Simulator completely and rerun `check.sh --skip-tests`. After the login restores, the 2 places and the post are still in Saved (Plan → bookmark → row or See all).
- [ ] Unbookmark one place, relaunch: it stays removed.
- [ ] Create a folder in Saved and put a saved place in it, relaunch: the folder and its item are still there.
- [ ] Log in as **jenny** in Settings: jack's saves are **not** shown. Log back in as jack and they return.
- [ ] Sample mode: saving the sample places works locally as before, and nothing is sent to the server.
- [ ] Any sync error shows briefly at the top of the map, e.g. "Couldn't save: …".

### Step 6: plans sync to your account
- [ ] `check.sh` passes: 79 tests.
- [ ] Connected as jack: add 3 real places to My Plan, reorder them and change a stay length. Then fully quit the Simulator and rerun `check.sh --skip-tests`: the plan comes back in the same order.
- [ ] **Accounts are separate:** connect as **jenny**. My Plan is empty, or shows jenny's own plan. Connect as jack again: jack's plan returns.
- [ ] **Save Plan** (hold the bookmark in My Plan): name "Saturday loop", **Friends**, and select **jenny**. The friend list now shows jack's real friends: Quest Quinn, Pixel Pat, … and jenny.
- [ ] Connect as jenny: jenny has an invite. Until the Feed arrives in Step 7, I can confirm this from the server; tell me when you've saved it.
- [ ] Relaunch as jack: "Saturday loop" is in Saved and opens with its stops. Editing it autosaves to the server.
- [ ] Remove every stop from the current draft: the server draft is cancelled, with no error notice.
- [ ] Adding a 13th stop shows a notice: the server caps plans at 12 (D3).
- [ ] Sample mode: plans with sample places stay local, exactly as before.

### Step 7: live Feed (posts, videos, plans, open plans)
- [ ] `check.sh` passes: 80 tests. The bridge check now also prints "Route bridge passed".
- [ ] Connected as jack, open **Feed**: full-screen pages load. Right now the demo data is 20 photo posts, 3 friend plans with **Join plan**, 2 find-someone plans with **Request to join**, and an end card, "You're caught up. Go outside."
- [ ] **Photo** pages show the real image full-bleed. They're the seed's test patterns until curated media is seeded (D27).
- [ ] **Open plan** pages show the plan's route on the map with numbered stops, the same overlay (author, name, bookmark, +, numbered place strips), and a large lime **Join plan** button. Tapping it gives "Joined ✓" and "You're in…". Find-someone plans say **Request to join**, then "Requested ✓".
- [ ] **+** on a plan appends its stops to My Plan ("Added N stops"). **+** on a post toggles that place.
- [ ] **Bookmark** on a post saves the post (Step 5 sync). Bookmark on a plan saves a copy to your plans (Step 6 sync).
- [ ] Tapping a place strip opens that place's sheet.
- [ ] **Top right:** the social button switches **General ⇄ Friends**, and the label at top left shows it. Friends shows only posts and plans by jack's friends. The chevron cycles **Everything → Posts → Plans**.
- [ ] Pull down on the first page to refresh.
- [ ] Videos and adventure routes: the code is ready (muted looping video that plays only on screen, route map for recap posts), but the current demo data has none. Check again after the curated seed.
- [ ] Sample mode: the sample Feed still works, and "Everything" shows the sample posts and then the sample plans.

### Step 7b: feedback fixes (filter colours, multi-part posts, no tree flash, Saved grid)
- [ ] `check.sh` passes: 82 tests.
- [ ] **Chevron colours:** Everything is white, Posts blue, Plans green.
- [ ] **Multi-part posts:** a post with several photos, clips, a route or long text pages **sideways**, with dots at the top. Vertical swipes still move between posts. Clips play only on the visible part of the visible post. (Demo posts have one photo each; the curated seed will exercise this.)
- [ ] **No tree flash:** while photos load you see a dark tile with a spinner, never the pixel trees. Scrolling back to a post shows its photo instantly (cached).
- [ ] **Saved grid** (Profile → bookmark, or My Plan → Saved row → See all): two columns of boxes.
  - Folders show a 2×2 mosaic. Posts show their photo (▶ for clips, 1/N for sets). Plans show a numbered route sketch. Places show a coloured pin tile.
- [ ] Tap a **post**: it opens full screen, with X top-left, the parts swipe sideways, and the place button opens the place.
- [ ] Tap a **plan**: full-screen route map with its stops, plus **Open in My Plan** and **Add stops**, and X top-left.
- [ ] Tap a **folder**: the same grid of just its items, with **‹ Saved** top-left to go back.
- [ ] **New folder** at top right creates a folder, which syncs.
- [ ] **Hold any box** for Add to My Plan, Move to folder, Remove from folder (inside a folder) and Remove from Saved.
- [ ] In My Plan's horizontal Saved row, tapping a post now opens it full screen too.
- [ ] Confirmed on the server: **Sunday loop** has jenny **invited**.

### Step 8: Profile (header, score, rank, friends, stats, explored map, posts, account toggles)
- [ ] `check.sh` passes: 83 tests. The bridge check also prints "Explored bridge passed".
- [ ] Profile header: **Friends 9 · Score 1088 · Rank #3** (jack's seeded numbers).
- [ ] Tap **Score**: a cairn of **8 stones**, 1088, "+357 XP in the last 7 days", 30 daily bars, and "211 XP expires by 2026-10-04…".
- [ ] Tap **Rank**: Friends #3 of 10 with the friends board (you highlighted), and Columbia #4 of 67 with the campus top 10.
- [ ] Tap **Friends**: 9 friends with @username, score, week streak and "Last out: <place> · <time ago>".
- [ ] **Adventures** tab: jack's **explored tiles** (57 lime squares near Columbia) fill the map, labelled "EXPLORED · 57 TILES". The sample route is gone.
- [ ] **Info (i)** on Adventures: Manhattan explored 1.3%, places visited 33, on foot 9.4 km, 12,232 steps, 38.9 h outside, borough bars, most-visited places and "Out with most".
- [ ] **Posts** tab: "No posts yet…" (jack has none until Step 12). Posts from Step 12 will appear here and open full screen.
- [ ] Pull down on Profile (and on any detail sheet) to refresh.
- [ ] Settings → Server → **ACCOUNT**: toggle **Ghost mode** and **Open to plans**, then relaunch. Both stay as set, because they're saved on the server.
- [ ] Sample mode: Profile shows Alex / 250 / "—" and the sample route, as before.

### Step 9: live Social map
- [ ] `check.sh` passes: 84 tests. The bridge check also prints "Live social bridge passed".
- [ ] **Right before testing (laptop):** check jenny in near Columbia so there's a fresh friend check-in: `scripts/demo-checkin.sh jenny "Book Culture"`. It prints "checked in: +N XP". A place accepts one check-in per user every 6 hours; to repeat, use another name, e.g. "Butler" or "Havana".
- [ ] As **jack**, on the Map, tap the **Social** button (top right). The bottom-left label reads "SOCIAL · 1 OUT · 3 PLANS · CHECK-INS, NOT LIVE GPS".
- [ ] **Jenny's marker:** the green circled-people icon at Book Culture **blinks** (blink, blink, pause) for about an hour after the check-in, then stays steady until 3 hours. Tap it: "jenny checked in at Book Culture on Broadway 2 minutes ago · there now".
- [ ] **Friend plan lines:** Pixel Pat's "Bagels then the park", Quest Quinn's "Museum mile warm-up" and Sprite Sasha's "Thrift and tunes" are **dotted green** (planned). Completed plans would be solid; plans under way are solid up to the last stop reached, then dotted.
- [ ] **Open plans:** lavender **"!"** markers at the first stop of the 2 open plans. Tap one: "Open plan … · request to join from the Feed".
- [ ] **Auto refresh:** check jenny in somewhere else with `demo-checkin.sh jenny "Butler"`. Within about 30 s her marker moves, and the old one drops once the newer check-in replaces it.
- [ ] **Ghost mode:** as jenny, turn Ghost mode on in Settings, reconnect as jack, turn Social on. Jenny's marker and routes are gone. **Turn jenny's ghost mode off afterwards.**
- [ ] Social **off** removes every marker and line. Leaving the Map (Feed or Profile) stops polling.
- [ ] Sample mode: the sample Social fixtures appear as before, labelled "SAMPLE SOCIAL · NOT LIVE".

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
| D21 | Data | Places covered only Manhattan plus the Queens and Brooklyn waterfront. The all-borough import is ready (see Step 3c) and Jack runs it on production. New Jersey rows from the old import are still in the database and hidden by the app's NYC land filter; deleting them is Jack's call. | Production writes are Jack's. |
| D22 | Accessibility | Place dots are drawn as a WebGL layer, so VoiceOver can't focus individual dots. The Nearby row is still accessible. | Needed for performance with about 1,000+ dots. |
| D23 | Design amendment | New discovery pins start at 0.25 mi instead of 1 mi. Park and forest map colours are darker. | User request, 2026-09-27. Supersedes the frontend docs. |
| D24 | Map | Places are hidden unless they fall inside a borough's land outline. A venue on a pier beyond the shoreline outline would be hidden too. | Filters out the New Jersey rows without a production delete. |
| D25 | Place sheet | There's no walking time until the app has the user's location (Step 10); the server computes it from `lat`/`lng`. Recap and review posts without media show text only, with no route drawing. | Location comes with Action mode. |
| D26 | Saved | Sync compares each change with the last synced snapshot and sends only the differences, in order. There's no retry on failure (a notice is shown) and no conflict handling across devices. Folder ID mappings aren't scoped per account on the device. Saved **plans** sync in Step 6. | Speed. |
| D27 | Content | Jack will supply curated reviews, short videos and photos for places around Columbia, to fill place sheets and the Feed. Loading them needs a seed or import step, planned after the main flow. | Waiting on content. |
| D28 | Plans | Plans sync by comparing each change with the last synced snapshot. Arrival times the server computes are loaded on connect, not re-read after every edit, so between launches the timetable shows your own times. Visibility and invites are sent once, when a plan is saved; later sharing edits (Step 8 editor) stay local. Unbookmarking a saved plan doesn't delete it on the server. Plans you joined but don't host aren't listed in Saved. | Speed, and avoids re-sending invites. |
| D29 | Feed | Only a post's first photo is shown, with no in-page media carousel. Videos are muted, with no sound toggle. An open plan's host name appears only when the host is a friend; the API gives just `hostId`. The end card's "Plan from Saved" (`POST /plans/from-saved`) isn't wired; the end page offers My Plan and Saved. Adventure lines are straight segments between stops unless the post carries a recorded route. | Speed. A host card on `Plan` would be a small backend addition. |
| D30 | Design amendment | Feed content defaults to **Everything** (posts and plans mixed), and the chevron cycles Everything → Posts → Plans. The top-right audience toggle is labelled General / Friends. | User request, 2026-09-27. |
| D31 | Saved / Feed | Places in Saved open the place sheet, not a full-screen view. A post gets a separate text page only when its text runs past about 90 characters or there's no media; shorter text stays the caption. Saved-row actions moved into a press-and-hold menu. Photos are cached in memory only. | Speed. Revisit with the curated content. |
| D32 | Profile | Adventures shows explored tiles, not recorded routes (no route-history endpoint, D13). The profile photo is still the bundled crab (no upload, D12). Friend rows don't open friend profiles yet. The "least visited" and neighbourhood stats from the design have no API. | Backend gaps; speed. |
| D33 | Map aesthetic | Explored tiles on Profile Adventures look too large at the default zoom. | User noted for the later aesthetic pass. |
| D34 | Social | `friendPlans` (upcoming shared plans with Join) aren't drawn separately: their lines already come from `routes`, and Join lives in the Feed. Tapping a route line does nothing, only markers are tappable. Loved places and adventures have no API (D14). `demo-checkin.sh` mints dev venue tags, so never point it at Demo Hall. | Speed; backend gaps. |


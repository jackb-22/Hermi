# Hermi: get out of your shell

**Hermi turns "we should go out sometime" into an outing that actually happens, and proves it did.** You discover real places on a pixel map of New York, build a plan with friends (and AI), go, and check in at each stop in person. You capture verified photos and come home to a recap, XP and a post your friends can trust.

The name is a hermit crab plus Hermes: the messenger who gets you out of your shell.

## Why (our design thesis)

Social apps reward staying in: posting, scrolling and collecting likes from home. Hermi only rewards things that happen **in the physical world**.

- **Plan real outings, not feeds.** Discovery is a map of real venues. A plan is an ordered set of places with times, and the AI helps finish it.
- **Prove you went.** Check-ins happen in person, through a tag tap at the venue or GPS dwell. Photos can only be taken in the app, and each is hashed and verified against the place and time of your check-in.
- **Social only in person.** There's no friend search and no remote requests. You add friends by tapping phones, and **streaks count real hangouts**: two friends checking in at the same place.
- **An outdoor Score that decays.** Your Score is XP from the last 30 days, drawn as a cairn of stones. Stay in, and the cairn shrinks.
- **Nothing to like.** There are no likes or comments; you bookmark to save and "+" to add to a plan. The feed is finite and ends with "go outside".

---

## Try Hermi

Our demo backend runs live, with real NYC places, AI, media storage and verification. It's reachable over HTTPS, and the app is pre-configured to use it. You need the **demo token** from our submission's testing instructions.

### Option A: iOS Simulator (any Mac with Xcode, no Apple account)
```sh
git clone https://github.com/jackb-22/Hermi.git && cd Hermi
sh scripts/judge-sim.sh          # builds Hermi and opens it signed in as @ava
sh scripts/judge-sim.sh --two    # …and a second simulator as @ben, to see the social side
```
It asks for the demo token once. The first build takes a few minutes.

In the Simulator, **Features → Location → Custom Location…** is how you "walk" between stops (coordinates in the route below). With no camera, the Simulator uses a clearly labelled sample photo.

### Option B: your own iPhone (a Mac with Xcode and a free Apple ID)
1. Open `apps/ios/HermiPreview/HermiPreview.xcodeproj`.
2. Target **HermiPreview** → Signing & Capabilities:
   - set **Team** to your Personal Team;
   - change the **Bundle Identifier** to something unique, e.g. `tech.hermi.yourname`.
3. Plug in your iPhone, select it, and press **Run**. On the phone:
   - enable **Developer Mode** when asked (Settings → Privacy & Security);
   - trust the developer under Settings → General → VPN & Device Management.
4. In Hermi, go to Profile → ⚙︎ → **Server**, paste the demo token and tap **@ava**.

You get the real camera and GPS. Free signing lasts 7 days.

### Option C: at our table
We can install it on your iPhone by cable, or hand you our two phones, already signed in as ava and ben.

---

## The route (about 10–12 minutes)

**ava** and **ben** are seeded, verified Columbia students who are friends with each other. Each has 30 days of history, a Score, and friends with streaks. You'll plan a two-stop outing: **Movement Harlem**, a bouldering gym on 125th St, then **Alfred Lerner Hall** on campus, 1.2 km apart.

> ### ⚠️ The adventure only works where you physically are
> Hermi exists to get you outside, so **every check-in, photo and XP point requires being at the place**. The phone's real location must be within **150 m** of the stop, and the server checks it again.
> - **On a phone:** you would **actually walk** from Movement Harlem to Lerner Hall.
> - **In the Simulator,** which can't walk, you **move it** by setting its location (**Features → Location → Custom Location…**). **That is the only thing simulated.** Everything else (check-ins, verification, XP, recap) is the real system.
>
> | Stop | Latitude | Longitude |
> |---|---|---|
> | Movement Harlem | 40.80965 | -73.95021 |
> | Alfred Lerner Hall | 40.80675 | -73.96398 |

### 1. Discover with pins (Map, as ava)
- **Pan and pinch-zoom.** Thousands of real venues load in tile by tile, and the map stays bounded to the five boroughs.
- **The pin at the top right:**
  - swipe it sideways to change category;
  - **tap** it to show that category **citywide**, and tap again for everything;
  - **hold and drag** it onto the map to drop a discovery pin.
- **Find Lerner Hall with a pin.** It won't appear as a dot on its own; that's intentional, since pins are how you discover.
  1. Swipe the pin to **Culture** and drop it on Columbia's campus, near Broadway and 115th.
  2. The **Nearby** row lists culture places inside the circle, nearest first. Drag the radius slider to widen or narrow it.
  3. Open **Alfred Lerner Hall**: real photos, the would-go-again percentage and a review summary. Tap **+** to add it.
- **Find Movement Harlem's video.**
  1. Swipe the pin to **Sports** and drop it on 125th St near Frederick Douglass Blvd.
  2. Open **Movement Harlem** and **tap the first post**. It opens full screen with the **climbing video playing first**; swipe sideways for the photos.
  3. Close it with the **X** (top-left, like every sheet), then tap **+**.
- Tapping empty map closes a sheet.

### 2. Plan and invite
- Open **My Plan** (top-right icon): both stops, with times and stay lengths.
  - **Hold a stop to reorder** it, and put Movement Harlem first.
  - Tap a stop to open its page on top of the plan.
- **Hold the bookmark** → **Save plan** → name it → **Friends** → select **ben** → Save. It's synced to ava's account, and ben gets a real invitation.

### 3. The friend joins (as ben)
Use the second simulator, or Profile → ⚙︎ → Server → **@ben**. Go to **My Plan → From friends**: "ava invited you". Tap **Join**. The plan now shows **Go!** for ben.

### 4. Explore the social layer
- **Feed:** real photos, clips and reviews from places around Columbia.
  - Posts with several parts swipe **sideways** (dots at the top); vertical swipes move between posts.
  - Plans are drawn as routes on the map. Open plans have a big **Join plan** / **Request to join** button.
  - **Top right:** the people icon switches **General ⇄ Friends**. The chevron cycles **Everything → Posts → Plans**, turning white, blue then green.
  - **Bookmark** saves a post. **+** adds its place to your plan.
- **Saved** (Profile → bookmark icon):
  - a grid of folders, posts, plans and places;
  - posts and plans open full screen;
  - hold a box to move it to a folder, and use **New folder** to create one.
- **Social map** (Map, top-right people icon):
  - friends' check-ins from the last 3 hours, **blinking** while they're there;
  - friends' plan lines, dotted while planned and solid once done;
  - **"!"** markers for open plans from matched students.

### 5. The adventure (ava, then ben). Read the box above first.
1. My Plan → **Go!**. The **Directions** screen shows the route, the next stop, its distance and walking time, and Open in Maps. Each stop is marked with how far away you are.
2. **Try to cheat:** before moving anywhere, tap **Tap tag** at **Alfred Lerner Hall**. Hermi **refuses**: "You're … away from Alfred Lerner Hall. Walk there first: check-ins only work within 150 m." (Or "Waiting for your location" if the Simulator has none yet.)
3. Set the Simulator's location to **Movement Harlem** and tap **Tap tag** → **+XP**. "Tap tag" is our in-app stand-in for tapping the venue's NFC tag.
4. **Camera** → shutter. The photo is hashed, uploaded and **Verified** against your check-in's place and time. The Simulator uses a labelled sample photo; a phone uses the real camera.
5. Set the location to **Alfred Lerner Hall** and tap **Tap tag** → **+XP**.
   - If **ben** also checks in there within 30 minutes: "**Hangout with ava**". That's an IRL streak.
6. **End** → **Recap**: time, distance, new map tiles and the **XP breakdown**.
   - Answer **"Would you go again?"** for each stop.
   - **Post** your photos with the route card. They appear in the other person's **Feed**, and on the Social map your check-in blinks for friends.

### 6. Your outdoor Score (Profile)
- **Score** has gone up. Tap it for the **cairn**, the 30-day chart and the XP that expires soon. **Rank** shows your friends and campus leaderboards.
- **Friends** shows streaks and where each friend last went out. **Adventures** colours the tiles you've explored, and **(i)** shows coverage, steps and hours outside.
- **Posts** is your verified posts. ⚙︎ has **Ghost mode**, which hides your check-ins from friends, and **Open to plans**, for find-someone matching.

### 7. Friends only in person
There's no friend search and no friend requests. You add a friend by **tapping phones** (personal NFC tags), and streaks count weeks with a real hangout. Our video shows this with real NFC tags, which we couldn't get for this build.

---

## What's real, what's seeded, what isn't built

**Real and live:**
- **Places:** about 40k Overture places around Manhattan and Columbia. An import of all five boroughs (65k) is ready. Places are ranked by visits and your taste.
- **Accounts:** plans, invites, joining, saves and folders sync to the server.
- **Outings:** sessions, location points and check-ins, with XP enforced by the server: 150 m proximity, cooldowns, and hangouts that build streaks.
- **Captures:** SHA-256 hashing, a presigned upload, then server verification of hash, time window and distance. Posts are moderated.
- **Recap:** the server builds it. **Score:** rolling XP, stones, ranks and explored tiles.
- **The Feed, Social map and Profile** read live data.
- **Backend AI:** the plan scheduler (Gemini), next-stop suggestions, and "Add dinner / Rain-proof / Cheaper" plan edits all exist as APIs.

**Seeded, because we don't have a user base yet:**
- Every user other than you: friends, streaks, 30 days of history, open "find someone" plans.
- Posts and reviews. The Columbia places carry real photos, videos and reviews we collected. "% would go again" and review summaries are thin until real people review.
- **Find someone** (matching verified students with similar taste) works server-side, but needs a pool of real students to be meaningful.

**Stand-ins, because we couldn't get NFC hardware in time:**
- Venue check-ins use **Tap tag**, an in-app button that mints a venue tag and checks in through exactly the same `/checkins` path as a real tap. **Your real location must be within 150 m of the venue**; there's no fallback. In the Simulator, you set its location to the stop.
- Friend pairing by tapping phones is shown on video. The API (`/taps`) is built and was tested with simulated taps.

**Not built yet:**
- Sign in with Apple and .edu verification screens. The APIs exist; the demo uses pre-made accounts.
- Push notifications and reminders.
- Background location: keep the app open during an outing.
- Video capture and ambient audio. Captures are photos.
- AI suggestions and the AI plan editor aren't wired into the app UI yet; their APIs are live.
- Live walking directions: we show the next stop and distance, and open Apple Maps for turn-by-turn.

---

## How it's built

```
apps/ios/HermiPreview    SwiftUI app (iOS 17): MapLibre pixel map in a web view, Observation-based sync layer
apps/api                 Fastify API + worker (TypeScript): sessions, check-ins, XP, feed, planner, media pipeline
packages/shared          zod contract shared by API and docs (live OpenAPI at <server>/docs)
scripts/                 demo-up.sh (laptop backend + tunnel), judge-sim.sh, demo-checkin.sh
docs/                    INTEGRATION.md (app ↔ API log), frontend/ (design schema, process, screenshots)
archive/                 retired prototype and hosting config
```

**Data:**
- MongoDB Atlas holds places, users, plans, posts and saves, with a vector index for taste matching.
- Timescale holds location points and XP events.
- Media lives in S3-compatible storage (RustFS) and is served by the API.

**Providers:**
- Gemini: the planner.
- open-meteo: weather.
- C2PA: signed capture credentials.
- Photon: iMessage group handoff.

`CONTRACT.md` describes the API. `docs/INTEGRATION.md` records every app ↔ API decision and deferral.

---

## Run the backend yourself

### Dev loop (Linux or macOS)
```bash
cp .env.example .env
docker compose up -d          # mongo (atlas-local, supports $vectorSearch), timescaledb, rustfs (S3)
pnpm install
pnpm --filter @itp/api migrate
pnpm dev                      # http://localhost:3000/docs
pnpm test
```

### Demo data
```bash
# Places: all five boroughs (download once, ~800 MB; the import keeps only places inside NYC)
uvx --python 3.12 overturemaps download --no-stac --bbox=-74.26,40.49,-73.70,40.92 -f geojsonseq --type=place -o apps/api/data/nyc_places.geojsonseq
pnpm --filter @itp/api exec tsx --env-file=../../.env scripts/import-overture.ts data/nyc_places.geojsonseq
# People, history, posts and open plans (removes only earlier seed data)
pnpm --filter @itp/api exec tsx --env-file=../../.env scripts/seed.ts --reset --demo ava,ben [--media-dir ./captures]
# Curated Columbia content: real photos, clips and reviews per place (folder layout in the script header)
pnpm --filter @itp/api exec tsx --env-file=../../.env scripts/seed-curated.ts --dir <folder>
```

### Demo backend on a laptop (what judges hit)
The phones reach the laptop through a public HTTPS tunnel. The API and worker run in one process against the production databases, and media is served by the API.
```bash
cp .env.demo.example .env.demo      # production MONGO_URI / TIGER_URL, keys, two `openssl rand -hex 32` secrets
NGROK_DOMAIN=<name>.ngrok-free.dev scripts/demo-up.sh   # stable URL (without NGROK_DOMAIN: a new cloudflared URL each run)
scripts/demo-checkin.sh ben "Butler"                    # give the Social map a fresh friend check-in
```
Dev sign-in, used by the app's demo mode: `POST <url>/v1/auth/dev {"username":"ava"}` with header `x-dev-token: <DEV_TOKEN from .env.demo>`.

### Content Credentials (C2PA)
Verified captures get a signed copy with a C2PA manifest (in-app capture, place, time, check-in), linked from `/verify/:hash`:
```sh
apps/api/scripts/make-c2pa-cert.sh .c2pa   # prints C2PA_CERT_PEM=… and C2PA_KEY_PEM=… for .env
```

### Fallback: Google Cloud Run
Use this only if the laptop can't host the demo. It's the same image and code, in the region next to Atlas and Tiger.
```bash
gcloud config set project <project>
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com storage.googleapis.com
gcloud storage buckets create gs://<bucket> --location=us-east4 --uniform-bucket-level-access
gcloud iam service-accounts create hermi-media
gcloud storage hmac create hermi-media@<project>.iam.gserviceaccount.com    # → S3_KEY / S3_SECRET
gcloud storage buckets add-iam-policy-binding gs://<bucket> --member=serviceAccount:hermi-media@<project>.iam.gserviceaccount.com --role=roles/storage.objectAdmin
# env.yaml (gitignored): the .env.demo values, plus PUBLIC_BASE_URL, S3_ENDPOINT=https://storage.googleapis.com,
#   S3_REGION=auto, S3_BUCKET, S3_FORCE_PATH_STYLE=1, MEDIA_UPLOAD_MODE=direct, MEDIA_DELIVERY=api
gcloud run deploy hermi-api --source . --region us-east4 --port 8080 --env-vars-file env.yaml \
  --min-instances 1 --max-instances 1 --no-cpu-throttling --cpu 1 --memory 2Gi --allow-unauthenticated
```

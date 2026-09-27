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
git clone <this repo> && cd <repo>
sh scripts/judge-sim.sh          # builds Hermi and opens it signed in as @ava
sh scripts/judge-sim.sh --two    # …and a second simulator as @ben, to see the social side
```
It asks for the demo token once. The first build takes a few minutes.

In the Simulator, set **Features → Location → Custom Location → 40.8068, -73.9640** (Lerner Hall, Columbia). With no camera, the Simulator uses a clearly labelled sample photo.

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

## The route (about 10 minutes)

**ava** and **ben** are seeded, verified Columbia students who are friends with each other. Each has 30 days of history, a Score, and friends with streaks. The route is set around **Lerner Hall** and **Butler Library** (90 m apart).

| Step | What to do | What it shows |
|---|---|---|
| **1. Discover** | Pan and zoom the map: thousands of real venues, bounded to the five boroughs. Swipe the pin at top right to **Food**, then hold and drag it onto the map next to Columbia. Tap a restaurant, e.g. **The Hungarian Pastry Shop**: real photos, videos and reviews. Tap **+** to add it. Tap the pin once for **citywide** Food; tap again for everything. | Radius discovery, place pages, plan membership |
| **2. Plan** | Tap the plan icon (top right). Add **Alfred Lerner Hall** and **Butler Library**; hold a stop to reorder it. Hold the **bookmark** → **Save plan** → **Friends** → pick **ben**. | Plans synced to your account, invitations to real friends |
| **3. Friend joins** | As **ben** (second simulator, or Settings → **@ben**): **My Plan → From friends** shows "ava invited you". Tap **Join**, then **Go!** | Shared plans |
| **4. Explore** | **Feed**: photos, videos, plans drawn on the map, open plans with **Join / Request**. Top right switches General ⇄ Friends; the chevron filters Everything / Posts / Plans. **Social** (map, top right): friends' recent check-ins blink, plan lines, and "!" open plans from matched students. **Saved** (Profile → bookmark): folders and full-screen media. | The social layer |
| **5. Adventure** | **Go!** opens Directions: route, next stop and distance. At a stop, tap **Tap tag**, our stand-in for the NFC tag at the venue. You get **+XP**, and "Hangout with ben" if you both check in within 30 minutes. Switch to **Camera** and take a photo: it uploads, is hashed, and is **Verified** against your check-in. Check in at Butler, then **End**. | In-person verification, the verified capture pipeline |
| **6. Recap and post** | The recap shows the XP breakdown, stops, distance and new map tiles. Answer "Would you go again?", then **Post** your photos with the route card. The post appears in your friend's Feed and on your Profile. | Verified posting |
| **7. Score** | **Profile**: your Score went up. Tap **Score** for the cairn and 30-day chart, **Rank** for friends and campus, **Friends** for streaks, and **(i)** on the map for coverage, steps and hours outside. | The outdoor Score |
| **8. In-person friends** | Watch our video of two phones tapping NFC tags to become friends, which starts an IRL streak. | Friendship only happens in person |

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
- Venue check-ins use **Tap tag**, an in-app button that mints a venue tag and checks in through exactly the same `/checkins` path as a real tap. Your real location must still be within 150 m of the venue; in the Simulator, the stop's own position is used.
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
NGROK_DOMAIN=<name>.ngrok-free.app scripts/demo-up.sh   # stable URL (without NGROK_DOMAIN: a new cloudflared URL each run)
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

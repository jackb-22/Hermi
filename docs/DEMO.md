# Hermi demo: AI button + texting Hermi

Everything needed to run the demo: who does what, the backend, the app, the story, and what to do when something fails.

## Roles
- **Jack (laptop + iPhone +1 202 341 3717 = @ava):** runs the backend, texts Hermi.
- **Teammate (Mac):** runs the app: two Simulators (@ava and @ben), or @ava on an iPhone.

## 1. Before the day (once)
1. **Photon:** app.photon.codes → project **hermi** → **Users** → add every phone that will text Hermi (at least +1 202 341 3717). On the shared line, unlisted phones get Photon's "didn't recognize your number" reply. Group chats need a dedicated line (Platforms → iMessage → Get a dedicated line); without one, demo texting by DM only.
2. **Google Cloud:** the project's Routes API and Places API (New) are enabled, and `GOOGLE_MAPS_KEY` is in `.env.demo`. Places only adds opening hours; everything else works without it.
3. **Gemini:** `GEMINI_API_KEY` (AI Studio) in `.env.demo`. On a free-tier key, keep `GEMINI_MODEL=gemini-3.5-flash-lite` and `GEMINI_BACKUP_MODEL=gemini-flash-lite-latest`: the newest Flash models are often overloaded for free keys.

## 2. Backend (Jack, laptop)
```sh
git checkout main && git pull
pnpm install
NGROK_DOMAIN=sampling-utmost-flounder.ngrok-free.dev scripts/demo-up.sh   # leave running
```
In a second terminal:
```sh
pnpm --filter @itp/api exec tsx scripts/demo-rehearse.ts        # AI button end to end on @rehearsal; must end "✓ rehearsal passed"
curl -s -X POST https://sampling-utmost-flounder.ngrok-free.dev/v1/dev/imessage/link \
  -H "x-dev-token: $(grep ^DEV_TOKEN= .env.demo | cut -d= -f2)" -H 'content-type: application/json' \
  -d '{"username":"ava","handle":"+12023413717"}'              # Jack's phone texts as @ava
```
Or link from the app instead: Profile → ⚙︎ → **Text Hermi → Link this phone** (Messages opens with "link CODE"; send it).

Check: text Hermi "hey" from the iPhone. The reply should be the how-to ("Text me a plan…").

## 3. App (teammate, Mac)
```sh
git checkout main && git pull
sh scripts/judge-sim.sh --two        # @ava and @ben Simulators; paste the demo token when asked
```
For an iPhone, use README "Option B", then Profile → ⚙︎ → Server → paste the token → **@ava**.

Checklist, all on @ava unless noted:
1. My Plan shows the AI button (bottom left, lime spark) and nowhere else (not on Map, Feed, Saved).
2. **Space it out** → the preview shows walk/transit legs and moved times → **Apply** → the overlap warning is gone; **Undo** brings it back.
3. **Add a stop… → Music** → a NEW stop appears → **Dismiss**.
4. **Best weather day** → a new date, or "already the best day".
5. **Ask about this plan**: "is the first stop open then?" answers with a Google Maps link; "write me a poem" declines.
6. After Jack's text (the story, step 4): bring the app to the front → "My Plan was updated from Hermi". On @ben: My Plan → **From friends** shows the invite → **Join**.

## 4. The story (about 3 minutes)
1. **The problem:** a plan with overlapping times (My Plan shows the red warning).
2. **Space it out** → "Walk 4 min → Transit 12 min · ends 6:40 PM" → the preview → **Apply**. Real Google travel times.
3. **Add a stop → Music**: Hermi picks one on the route and says why → Apply.
4. **Ask:** "is the pastry shop open then?" (grounded in Google Maps, with the source link). Then "write me a poem" (it only helps with the plan).
5. **Text Hermi** from the iPhone: *"tomorrow 2pm: Hungarian Pastry Shop, then Riverside Park with ben"*. The reply has times, legs and "Invited Ben"; the app updates; ben's app shows the invite.
6. Reply *"undo"* to show it's reversible (then text the plan again if needed).

## 5. If something fails
| Symptom | Do this |
|---|---|
| AI answers slowly or says "offline" | Free-tier Gemini is busy; presets fall back to rules and still work. Retry chat in 30 s. |
| Travel times say "est." | The Routes key isn't reaching Google; the demo still works with estimates. |
| No reply to texts | Is `demo-up.sh` running? Is the phone under Photon → Users? Backup: run `pnpm --filter @itp/api exec tsx --env-file=../../.env scripts/photon-cli.ts` on screen (local database with the NYC places, real Gemini and Routes), then `/as ava +12023413717`, `/as ben +12023413718`, `/friends ava ben`, `/from +12023413717`, and type the same text. |
| App can't connect | Settings → Server: URL `https://sampling-utmost-flounder.ngrok-free.dev`, the demo token, @ava. |
| App won't build | Show the CI screenshots (`.ci-shots/`), or the backup video. |

Record a screen video of one full run as a backup.

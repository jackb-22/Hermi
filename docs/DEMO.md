# Hermi live demo: run of show

Everything Hermi does, as one story: **ava gets ben outside on Saturday.** About 9 minutes; a 3-minute cut is at the end.

**Cast**
- **Presenter:** talks. Can be the driver.
- **Driver (Mac):** two Simulators side by side. **Left = @ava**, **right = @ben**.
- **Phone (Jack, +1 202 341 3717):** texts Hermi as @ava.
- **Laptop (Jack):** runs the backend. Nothing to show on it unless a fallback is needed.

---

## Before the demo (30 min ahead)

**Laptop (backend)**
```sh
git checkout main && git pull && pnpm install
NGROK_DOMAIN=sampling-utmost-flounder.ngrok-free.dev scripts/demo-up.sh      # leave running; keeps the laptop awake
pnpm --filter @itp/api exec tsx scripts/demo-rehearse.ts                   # must end "✓ rehearsal passed"
```

**Phone → Hermi**
- The phone must be a Photon user (it is: `npx @photon-ai/cli spectrum users ls`).
- Hermi's number for this phone is **+1 (628) 629-3507**.
- Text `hey`. The reply is the how-to. If there's no reply, see "If something fails".
- The phone is linked to @ava already (re-link: `POST /v1/dev/imessage/link {"username":"ava","handle":"+12023413717"}` with `x-dev-token`).

**Mac (app)**
```sh
git checkout main && git pull
sh scripts/judge-sim.sh --two     # left Simulator @ava, right @ben; paste the demo token
```
- Both Simulators: **Features → Location → Custom Location…**, and have these ready:

  | Stop | Latitude | Longitude |
  |---|---|---|
  | Movement Harlem | 40.80965 | -73.95021 |
  | Alfred Lerner Hall | 40.80675 | -73.96398 |
  | Away (for the cheat test) | 40.7580 | -73.9855 |

- Set both to **Away** to start.

**Clean slate**
- **Check-in cooldown:** each place allows one check-in per account every **6 hours**. Rehearse the adventure (Act 5) with **judge1/judge2**, not ava/ben, or rehearse more than 6 h before.
- On @ava, My Plan should be empty or have one old stop. **Undo** any texted plan from a rehearsal: text `undo`.

---

## Act 1: the pitch (20 s)
> "Social apps reward staying in. Hermi only rewards what happens in the physical world: you plan real outings, you go, and you prove it."

Show **@ava** on the **Map**: pixel New York, real venues loading as you pan.

## Act 2: discover with pins (1 min)
1. Swipe the pin (top right) to **Culture**, then hold and drag it onto Columbia's campus (Broadway at W 115th St).
2. The **Nearby** row lists culture places in the circle. Open **Alfred Lerner Hall**: real photos, "% would go again", and a review summary. Tap **+**.
3. Swipe the pin to **Sports**, and drop it on **125th St between 7th and 8th Ave**. Open **Movement Harlem** and tap the first post: the climbing video plays. Close it and tap **+**.
> "No infinite feed of places: you discover by dropping a pin where you want to go."

## Act 3: plan with Hermi AI (2 min)
1. Open **My Plan** (top-right icon). The two stops show rough times, maybe an overlap warning. Point at the **AI button** (lime spark, bottom left):
   > "It only lives here, and it can only edit this plan."
2. **AI → Space it out.**
   - The timeline turns into a preview: real Google walk/transit times between stops, arrivals moved to match, the change listed.
   - Tap **Apply**. The warning is gone. Tap **Undo** once to show it's reversible, then Apply again (AI → Space it out).
3. **AI → Add a stop… → Food.** Hermi picks a place on the route (NEW badge) and says why. **Apply**.
4. **AI → Best weather day.** It moves the plan to the driest day in the next 10, or says today is already best. **Dismiss** or Apply.
5. **AI → Ask about this plan:**
   - `is Alfred Lerner Hall open then?` → an answer grounded in **Google Maps**, with the source link.
   - `write me a poem` → "I can only help with this plan…"
   > "It suggests; you decide. Nothing changes until you tap Apply."

## Act 4: or just text Hermi (1.5 min)
> "Most plans start in a group chat, not an app."

1. On the **phone**, text **+1 (628) 629-3507**:
   **`Sat 2pm: Movement Harlem, then Alfred Lerner Hall with ben`**
2. Hermi replies with the plan:
   - both stops with times;
   - `↓ walk 20 min`;
   - "Invited Ben: they'll see it in Hermi";
   - the link, and "Reply undo".

   Read it out.
3. **Left Simulator (@ava):** leave the app and come back (or reopen My Plan). "My Plan was updated from Hermi": the texted plan is now ava's plan, saved, with ben invited.
4. **Right Simulator (@ben):** My Plan → **From friends** → "ava invited you" → **Join**.
> "No app switching: text it like you'd text a friend, and it lands in your plan with travel times, invites sent."

(Optional: text `undo` to show it reverts, then send the plan again.)

## Act 5: the adventure (2.5 min)
1. **@ava:** My Plan → **Go!** → Allow location. **Directions** shows the route, the next stop and its distance.
2. **Try to cheat:** tap **Tap tag** at **Alfred Lerner Hall** while still Away. Hermi refuses: "You're … away. Walk there first: check-ins only work within 150 m."
3. Set @ava's location to **Movement Harlem** → **Tap tag** → **+XP**.
4. **Camera** → shutter. The photo is hashed, uploaded and **Verified** against the check-in's place and time. (The Simulator uses a labelled sample photo.)
5. Set **both** Simulators to **Alfred Lerner Hall**. @ava: **Tap tag**. @ben: Go! → **Tap tag**.
   - "**Hangout with ava**": two friends checked in at the same place, which is a real-life streak.
6. **@ava: End → Recap.** Time, distance, new map tiles, the XP breakdown. Answer "Would you go again?" → **Post** the photo with the route card.
> "Every point here was earned somewhere real. The server checks where you are, not the app."

## Act 6: the social payoff (1 min)
1. **@ben → Feed:** ava's verified post with the route card. Bookmark it; **+** adds its place to ben's plan. "The feed ends. Go outside."
2. **@ben → Map → Social (people icon):** ava's check-in blinks; plan routes are drawn.
3. **@ava → Profile:**
   - **Score**: tap it for the **cairn** of stones (30-day XP that decays if you stay in).
   - **Rank**: friends and campus.
   - **Friends**: the streak with ben.
   - **Adventures**: explored tiles.
> "Your Score shrinks if you stay in. The only way up is out."

## Close (20 s)
> "Hermi: plan with AI that only edits your plan, text it from any chat, and prove every outing happened. Come out of your shell."

---

## 3-minute cut
Act 1 (pitch) → Act 3 steps 2 and 5 (Space it out, Apply; one chat question) → Act 4 (text Hermi, ben joins) → Act 5 steps 3–4 (check in, verified photo) → Act 6 step 3 (Score cairn).

## If something fails
| Symptom | Do this |
|---|---|
| AI is slow (10–17 s) or says "offline" | Free-tier Gemini is busy. Presets fall back to rules and still work; keep talking and retry chat. |
| Travel times say "est." | Google Routes isn't answering; the plan still spaces with estimates. |
| No text reply | Is `demo-up.sh` running? Did you text **+1 (628) 629-3507** (not 415)? iPhone Settings → Messages → Send & Receive → start new conversations from the phone number. Backup: run `pnpm --filter @itp/api exec tsx --env-file=../../.env scripts/photon-cli.ts` on the laptop and type the text there. |
| "Already checked in" | That account used the place in the last 6 h: switch both Simulators to **judge1/judge2** (Profile → ⚙︎ → Server → username → Connect). |
| Check-in refused at the right place | Re-set the Custom Location; the Simulator sometimes keeps the old one. |
| App can't reach the server | Settings → Server: `https://sampling-utmost-flounder.ngrok-free.dev`, the demo token, **@ava**. Check `demo-up.sh` is still running. |
| App won't build | Show the CI screenshots (`.ci-shots/`) and the backup video. |

Record one full run as a backup video during rehearsal.

## Known limits (don't demo these)
- **Group chats** ("hermi plan this"): Photon's shared line only works with registered numbers, and groups need a dedicated line.
- **Opening hours** need Places API (New) enabled; without it, chat answers hours from Google Maps grounding instead.
- **Tapping phones to add friends** uses NFC tags we don't have; it's shown in the video.

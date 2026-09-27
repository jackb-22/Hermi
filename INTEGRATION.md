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

---

## Deferred / deviations log

Items that are unconnected, need UI or backend work, or depart from `docs/HERMI_SCHEMA.md` / `docs/FRONTEND_IMPLEMENTATION_PLAN.md`. We come back to these after the main flow works.

| # | Area | Item | Why deferred |
|---|---|---|---|
| D1 | Auth | Onboarding (AUTH-01) is not built: explain → taste deck → Apple sign-in → .edu verification → profile setup. The app uses dev login by username. | Speed. The APIs exist (`/auth/apple`, `/auth/edu`, `/onboarding/deck`, `/me/taste`). |
| D2 | Auth | The JWT is stored in UserDefaults, not Keychain. | Hackathon shortcut. |
| D3 | Plans | The server caps a plan at 12 stops; the product has no cap. | Backend constraint. The server error is shown as a notice. |
| D4 | Places | `/places/near` is unused. Discovery uses bbox queries plus a client-side radius cut. | `/near` clamps to 1200 m and 10 results; pins go up to 4 miles. |
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

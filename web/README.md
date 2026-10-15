# Hermi website

Plain static site for [Cloudflare Pages](https://pages.cloudflare.com/): HTML, one CSS file, no JavaScript, no build step, no third-party requests. Plan: `docs/DEPLOYMENT.md` D5 (kept outside the repo).

| Path | What |
|---|---|
| `index.html` | Landing page and waitlist call to action |
| `download/index.html` | Waitlist until Nov 2, then the App Store (see below) |
| `privacy/index.html` | Privacy policy (**draft, pending review**) |
| `terms/index.html` | Terms of use (**draft, pending review**) |
| `support/index.html` | Contact, report, block, delete account, FAQ |
| `acknowledgements/index.html` | Map data attribution, Apple Weather, open-source notices |
| `404.html` | Not-found page (Pages serves it automatically) |
| `_headers` | Security headers for every page (CSP, HSTS, nosniff, no-referrer, ...) |
| `style.css`, `favicon.svg` | The only assets |

Every page is a hand-written `index.html` in its own folder, so the URLs are `https://hermi.world/privacy/`, `/terms/`, `/support/` and so on. Use those exact URLs in App Store Connect.

## Preview locally

```sh
python3 -m http.server 8000 -d web   # then open http://localhost:8000
```

## Deploy on Cloudflare Pages

1. Cloudflare dashboard, **Workers & Pages**, **Create**, **Pages**, **Connect to Git**, and pick this repository. If the repo is private by then (DEPLOYMENT.md T14), give Cloudflare's GitHub app access to it.
2. Build settings:
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: **leave empty**
   - Build output directory: `/` (it is relative to the root directory; use `.` if the dashboard rejects `/`)
   - Root directory (advanced): **`web`**
3. Deploy. Every push to `main` redeploys, and other branches get preview URLs. To skip pushes that do not touch the site, set the project's build watch paths to `web/*`.
4. **Custom domain** (after `hermi.world` is on Cloudflare, T3): the Pages project, **Custom domains**, add `hermi.world`. Cloudflare creates the DNS record. Optionally add `www.hermi.world` and redirect it to the apex. Leave `api.hermi.world` alone: it points at the Droplet and must stay DNS-only.
5. Email: `support@hermi.world` is forwarded to both of us with Cloudflare Email Routing (dashboard, not this folder). Test it before the legal pages go live: the privacy policy, terms, support page and the API's report alerts all name that address.

## Placeholders to replace

Find them all:

```sh
grep -rnE "TALLY_FORM_URL|APP_STORE_URL|\[(OPERATOR NAME|date of publication|LIABILITY CAP|GOVERNING LAW|VENUE|N days|N months)" web
```

| Placeholder | Where | Replace with |
|---|---|---|
| `TALLY_FORM_URL` | `index.html` (two buttons), `download/index.html` | The Tally waitlist form link (link-out, so the CSP needs no change; to embed the form instead, add `frame-src https://tally.so` to `_headers`) |
| `APP_STORE_URL` | `download/index.html`, inside a comment | The App Store link, on Nov 2 |
| `[OPERATOR NAME]` | privacy, terms | Whoever is legally responsible for Hermi (the founders by name until incorporation) |
| `[date of publication]` | privacy, terms | The "Effective:" date |
| `[LIABILITY CAP]`, `[GOVERNING LAW]`, `[VENUE]` | terms | Decided with a lawyer |
| `[N days]`, `[N months]` | privacy, retention table | Log, report, waitlist and backup retention: set the real period, then make the system do it |

## Nov 2: switch `/download` to the App Store

Pick one:

- **Edit the page.** In `download/index.html`, delete the waitlist button and its text, un-comment the `AFTER LAUNCH` block and replace `APP_STORE_URL`. Update the `<h1>`, `<title>` and description.
- **Redirect.** Leave the page and add a `web/_redirects` file with one line: `/download/  APP_STORE_URL  302`. Fliers and QR codes then go straight to the store.

## Before publishing privacy and terms

They are drafts, not legal advice. The founders, and ideally a lawyer, should read them before Nov 2.

1. Delete the `Draft — pending review` comment at the top of each file, the visible `.draft-banner` paragraph, and the `noindex` meta tag.
2. Fill every bracketed placeholder above and set the Effective date.
3. Search for `REVIEW:` comments and resolve each one.
4. Re-check the facts below against the code and the vendors.
5. Make the in-app consent screen (18+, terms, AI disclosure) say what the policy says.

### Facts the policy relies on (update the policy when any of them changes)

- School email: only a SHA-256 hash is stored (`services/eduEmail.ts`, `routes/auth.ts`); the address itself goes to Resend to send the code.
- Raw location points: 90-day retention (`db/migrations/001_timeline.sql`). Check-ins, tag reads, outing recaps and tiles have no expiry and rely on account deletion.
- Gemini paid tier, and what each call sends (`providers/llm.ts`, `services/planner.ts`, `services/textExtract.ts`, `services/posts.ts`, `services/safety.ts`).
- The provider list: Apple (Sign in, APNs, Maps Server API, WeatherKit, App Attest), Google (Gemini, Routes, Places), Resend, Photon, Cloudflare (R2, Pages, email routing), DigitalOcean, MongoDB Atlas, Open-Meteo (weather fallback), OpenFreeMap, Tally. Adding Sentry, Better Stack, analytics, Reality Defender (`REALITY_DEFENDER_KEY`), video or audio capture, or any new vendor means a policy update first.
- Public pages served by the API: `/p/:token` and `/verify/:hash` (`routes/web.ts`). They load nothing from third parties (no web fonts, scripts or images), so a visitor's IP address reaches only us. Keep it so, or update the policy first.
- Ghost mode, plan visibility and who can see profiles and posts (`services/planAccess.ts`, `services/social.ts`, `routes/profile.ts`, `routes/feed.ts`).

### What account deletion must cover

The policy says deleting an account "deletes your account and personal data, including photos, location history and check-ins". Check that the deletion work erases or anonymises:

- Mongo: `users` (fields, Apple refresh token only after revoking), `posts`, `reviews`, `media`, `plans` (hosted and memberships), `saves`, `folders`, `friendships`, `blocks`, `reports`, `sessions` (including `recap` and `lastPoint`), `user_tiles`, `ai_memories`, `behavior_events`, `feed_seen`, `attest_keys`, `edu_codes`, `imessage_links`, `checkin_cooldowns`.
- Timescale: `location_points`, `movement_segments`, `checkins`, `tag_reads`, `hangouts`, `xp_events`.
- R2: originals, renditions and profile photos.
- `/p/:token` must stop showing the host's name once the host is deleted (`routes/web.ts` does not check `deletedAt`).

## Headers

`_headers` allows only this origin: no scripts, no inline styles (so no `style=""` attributes in the HTML), no fonts, no frames, no forms. HSTS is one year with `includeSubDomains`, and not preloaded (preloading is hard to undo). Widen the CSP deliberately if you add an embed or analytics, and update the privacy policy at the same time.

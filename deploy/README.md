# Deploying Hermi (production)

One DigitalOcean Droplet in NYC (2 vCPU / 4 GB) runs three containers from `docker-compose.yml`:

- `api`: the API with the worker and the Photon listener inline. Built from the repo `Dockerfile`, not published.
- `timescaledb`: TimescaleDB, not published. The schema is built at boot (`AUTO_MIGRATE`).
- `caddy`: HTTPS for `api.hermi.world`, the only service with published ports (80 and 443).

MongoDB stays on Atlas and media on R2. The plan is `docs/DEPLOYMENT.md` T2.

Every command below runs from the repo root, and `dc` stands for this one command:

```sh
alias dc='docker compose -f deploy/docker-compose.yml --env-file deploy/.env'
```

## One instance only

Never run a second API: the Photon listener must be unique. Do not `dc up --scale api=2`, and do not start another
stack (a laptop, a staging box) with the production Photon keys. Compose stops the old `api` container before it starts
the new one, so a deploy does not overlap either.

## First setup

1. **Droplet.** Ubuntu 24.04 in NYC, 2 vCPU / 4 GB, with weekly backups on. Install Docker:
   `curl -fsSL https://get.docker.com | sh`.
2. **Cloud Firewall.** Inbound TCP 22, 80 and 443 only, attached to the Droplet. Docker's published ports bypass
   `ufw`, so the firewall is the real gate and `caddy` must stay the only service with `ports:`.
3. **DNS.** In Cloudflare, an `A` record `api` to the Droplet's IPv4, **DNS-only** (grey cloud). With the proxy on, the
   API sees Cloudflare's IPs and per-IP rate limits hit everyone at once. It must resolve before the first start,
   because Caddy gets its certificate then: check `dig +short api.hermi.world`.
4. **Atlas.** Add the Droplet's IP under Network Access, or `/health` stays red.
5. **Code and env.**
   ```sh
   git clone https://github.com/jackb-22/Hermi.git && cd Hermi
   cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
   nano deploy/.env        # fill in every blank; the comments say where each value comes from
   ```
   `deploy/.env` is gitignored. Never commit it.
6. **Start.**
   ```sh
   dc up -d --build
   dc ps                   # api shows "healthy" after about a minute
   curl https://api.hermi.world/health
   ```
   Then open `https://api.hermi.world/health` on a phone with Wi-Fi off. `"ok":true` with `mongo` and `tiger` true is done.

   **This first `up -d --build` is the real build test.** The image has never been built end to end: the laptop's
   TLS-intercepting proxy blocks npm inside build containers. Check that the build succeeds, then:
   ```sh
   docker image ls hermi-api                                      # note the size
   dc exec api test ! -e /app/apps/api/data && echo "data/ absent" # the 1.2 GB Overture data must not be in the image
   ```
7. **Pin TimescaleDB.** `timescaledb-ha:pg17` is a rolling tag, and the extension in an existing data volume only
   changes with `ALTER EXTENSION`, so do not let the image float. After the first healthy boot, read the running
   version and set it in `docker-compose.yml`, then commit:
   ```sh
   docker image inspect timescale/timescaledb-ha:pg17 --format 'pg{{index .Config.Labels "com.timescaledb.image.postgresql.version"}}-ts{{index .Config.Labels "com.timescaledb.image.timescaledb.version"}}'
   # e.g. pg17.11-ts2.30.1  ->  image: timescale/timescaledb-ha:pg17.11-ts2.30.1
   ```

## Update

```sh
git pull && dc up -d --build
```

The `api` container restarts (a few seconds of downtime); `timescaledb` and `caddy` are left alone. To roll back until
images are published to GHCR: `git checkout <previous commit> && dc up -d --build`.

## Operate

```sh
dc logs -f api                   # also: caddy, timescaledb. Logs rotate at 3 files of 10 MB per container.
dc ps                            # status and health
dc exec api pnpm --filter @itp/api migrate                              # one-off script in the api container
dc exec api pnpm --filter @itp/api exec tsx scripts/register-tags.ts venue --place <placeId>    # any script, same pattern
dc exec timescaledb psql -U postgres hermi
```

Scripts that read `apps/api/data` (Overture imports) are not in the image; run those from a laptop against Atlas.

## When boot fails

A missing or dev-default value stops the API with a clear reason, and `restart: unless-stopped` keeps retrying:

```
$ dc logs api
Error: Refusing to start in production:
- missing GEMINI_API_KEY
```

Fix `deploy/.env`, then `dc up -d api`. Env changes need that; `dc restart` does not re-read the file.

Do not run `dc down -v`: `-v` deletes the database volume. Caddy's certificates live in a volume too, so avoid
recreating them needlessly (Let's Encrypt rate-limits re-issues).

## Follow-ups

- [Friends] Run the api as the non-root `node` user. It needs a real build to verify first: pnpm writes
  `node_modules/.pnpm-workspace-state-v1.json` as root with mode 0600, so add
  `RUN chmod a+r node_modules/.pnpm-workspace-state-v1.json` before `USER node`, and confirm `pnpm --filter @itp/api start` boots.

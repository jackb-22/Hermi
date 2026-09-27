import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PUBLIC_MEDIA_PREFIXES, verifyMediaSig } from '../providers/storage.ts';
import { loadPlaces, plans } from '../services/plans.ts';
import { users } from '../services/users.ts';
import { verifyInfo } from '../services/verify.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Minimal pixel-styled HTML shell for pages opened in Safari (no app installed, or shared links). */
export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Silkscreen&display=swap" rel="stylesheet">
<style>
:root{--bg:#f4efe2;--fg:#1d1b16;--accent:#3d8b5a;--muted:#6b665a}
@media (prefers-color-scheme:dark){:root{--bg:#16140f;--fg:#efe9da;--muted:#a39d8c}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{max-width:420px;width:100%}
h1{font-family:Silkscreen,monospace;font-weight:400;font-size:28px;margin:0 0 8px}
.stamp{display:inline-block;font-family:Silkscreen,monospace;border:3px solid var(--accent);color:var(--accent);padding:4px 10px;margin:8px 0}
.muted{color:var(--muted)} a.btn{display:inline-block;margin-top:16px;padding:12px 18px;background:var(--fg);color:var(--bg);text-decoration:none;font-family:Silkscreen,monospace}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px} dt{color:var(--muted)}
</style></head><body><main>${body}</main></body></html>`;
}

/** Object keys as the API writes them: path segments of letters, digits, dot, dash and underscore. */
const MEDIA_KEY = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

/** One `bytes=a-b` or `bytes=a-` range; anything else (suffix or multiple ranges) is served whole, which HTTP allows. */
export function parseRange(h: string | undefined): { start: number; end?: number } | undefined {
  const m = /^bytes=(\d+)-(\d*)$/.exec(h?.trim() ?? '');
  if (!m) return undefined;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : undefined;
  return end !== undefined && end < start ? undefined : { start, end };
}

export const webRoutes: FastifyPluginAsyncZod = async (app) => {
  const { config, db, providers } = app.ctx;

  // Media served by the API when there is no CDN (MEDIA_DELIVERY=api): renditions, posters, profile photos and
  // credential files are public under unguessable keys; originals need the signed URL the API handed out.
  // Byte ranges are supported: iOS will not play an MP4 from a server that ignores them.
  app.get('/media/*', { schema: { hide: true } }, async (req, reply) => {
    const key = (req.params as { '*': string })['*'];
    const fail = (
      status: number,
      code: 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_REQUEST',
      message: string,
    ) => reply.status(status).send({ error: { code, message } });
    if (!MEDIA_KEY.test(key)) return fail(404, 'NOT_FOUND', 'No such media');
    const isPublic = PUBLIC_MEDIA_PREFIXES.some((p) => key.startsWith(p));
    const q = req.query as { exp?: string; sig?: string };
    if (!isPublic && !verifyMediaSig(config.JWT_SECRET, key, q.exp, q.sig))
      return fail(403, 'FORBIDDEN', 'This media link is not valid or has expired');
    let obj: Awaited<ReturnType<typeof providers.storage.stream>>;
    try {
      obj = await providers.storage.stream(key, parseRange(req.headers.range));
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode !== 416) throw e;
      return fail(416, 'BAD_REQUEST', 'Range not satisfiable');
    }
    if (!obj) return fail(404, 'NOT_FOUND', 'No such media');
    reply
      .header('Accept-Ranges', 'bytes')
      .header('Content-Type', obj.contentType)
      .header('Content-Length', obj.length)
      .header(
        'Cache-Control',
        isPublic ? 'public, max-age=31536000, immutable' : 'private, max-age=300',
      );
    if (obj.range)
      reply
        .status(206)
        .header('Content-Range', `bytes ${obj.range.start}-${obj.range.end}/${obj.total}`);
    // HEAD runs this same handler; Fastify drops the body and keeps these headers.
    return reply.send(obj.body);
  });

  // Universal links: stickers (/c venue, /t personal) and plan share links (/p) open the app.
  app.get(
    '/.well-known/apple-app-site-association',
    { schema: { hide: true } },
    async (_req, reply) => {
      const appID =
        config.APPLE_TEAM_ID && config.APPLE_BUNDLE_ID
          ? `${config.APPLE_TEAM_ID}.${config.APPLE_BUNDLE_ID}`
          : 'TEAMID.BUNDLEID';
      return reply.type('application/json').send({
        applinks: {
          details: [
            { appIDs: [appID], components: [{ '/': '/c/*' }, { '/': '/t/*' }, { '/': '/p/*' }] },
          ],
        },
      });
    },
  );

  const fallback =
    (kind: 'venue' | 'personal') =>
    async (
      req: { params: { id: string } },
      reply: { type: (t: string) => { send: (b: string) => unknown } },
    ) => {
      let line =
        kind === 'venue' ? 'A check-in spot.' : 'Someone’s tag. Tap yours back to become friends.';
      if (kind === 'venue') {
        const tag = await db
          .collection<{ _id: string; placeId?: string }>('tags')
          .findOne({ _id: req.params.id });
        const place = tag?.placeId
          ? await db
              .collection<{ _id: string; name: string }>('places')
              .findOne({ _id: tag.placeId })
          : null;
        if (place) line = `Check in at ${place.name}.`;
      }
      return reply.type('text/html').send(
        page(
          'It only counts if you go',
          `<h1>It only counts if you go.</h1><p>${esc(line)}</p>
<p class="muted">This tag works with the app: install it, then tap again.</p>
<a class="btn" href="https://apps.apple.com/">Get the app</a>`,
        ),
      );
    };

  const Params = z.object({ id: z.string().max(64) });
  app.get('/c/:id', { schema: { hide: true, params: Params } }, fallback('venue'));
  app.get('/t/:id', { schema: { hide: true, params: Params } }, fallback('personal'));

  // Verified IRL credential page: what the pixel stamp on a post opens.
  app.get(
    '/verify/:hash',
    { schema: { hide: true, params: z.object({ hash: z.string().max(64) }) } },
    async (req, reply) => {
      const info = /^[a-f0-9]{64}$/.test(req.params.hash)
        ? await verifyInfo(app.ctx, req.params.hash)
        : null;
      if (!info) {
        return reply
          .status(404)
          .type('text/html')
          .send(
            page(
              'Not verified',
              '<h1>Not found</h1><p>No published capture has this fingerprint.</p>',
            ),
          );
      }
      const when = new Date(info.capturedAt).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      const checkin = new Date(info.checkin.at).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        timeStyle: 'short',
      });
      return reply.type('text/html').send(
        page(
          `Verified IRL · ${info.place.name}`,
          `<div class="stamp">VERIFIED IRL</div>
<h1>${esc(info.place.name)}</h1>
<p class="muted">This ${info.kind} was captured in the app, at the place, during a verified check-in.</p>
<dl>
<dt>Captured</dt><dd>${esc(when)}</dd>
<dt>Check-in</dt><dd>${info.checkin.tier === 'tag' ? 'Venue tag scan' : 'GPS, 5 min on site'} at ${esc(checkin)}${info.checkin.attested ? ' · genuine app on a real device' : ''}</dd>
<dt>By</dt><dd>${esc(info.author.username ? `@${info.author.username}` : 'a verified user')}</dd>
<dt>Fingerprint</dt><dd style="word-break:break-all;font-family:monospace;font-size:12px">sha256 ${info.sha256}</dd>
<dt>Credential</dt><dd>${
            info.credential.c2pa && info.credential.manifestUrl
              ? `C2PA Content Credentials${info.credential.signer ? `, signed by ${esc(info.credential.signer)}` : ''}<br><a href="${esc(info.credential.manifestUrl)}">Download with credentials</a>${info.credential.inspectUrl ? ` · <a href="${esc(info.credential.inspectUrl)}">Inspect</a>` : ''}`
              : 'Server-verified capture record'
          }</dd>
</dl>
<p class="muted">Provenance proves where and when this was captured, not that the scene is real.</p>`,
        ),
      );
    },
  );

  // Shared plan link (/p/:token): opens the app via universal link, or this page in Safari.
  app.get(
    '/p/:token',
    { schema: { hide: true, params: z.object({ token: z.string().max(40) }) } },
    async (req, reply) => {
      const plan = await plans(db).findOne({
        shareToken: req.params.token,
        status: { $ne: 'cancelled' },
      });
      if (!plan)
        return reply
          .status(404)
          .type('text/html')
          .send(page('Plan not found', '<h1>Link expired</h1>'));
      const [host, byId] = await Promise.all([
        users(db).findOne({ _id: plan.hostId }),
        loadPlaces(
          db,
          plan.stops.map((s) => s.placeId),
        ),
      ]);
      const fmt = (d: Date) =>
        d.toLocaleString('en-US', {
          timeZone: 'America/New_York',
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
        });
      const stops = plan.stops
        .map((s, i) => {
          const p = s.placeId ? byId.get(s.placeId) : undefined;
          return `<dt>${i + 1}. ${esc(fmt(s.arriveAt))}</dt><dd>${esc(p ? `${p.name}${p.address ? ` · ${p.address}` : ''}` : 'Spot to be picked')}</dd>`;
        })
        .join('');
      return reply.type('text/html').send(
        page(
          plan.name,
          `<h1>${esc(plan.name)}</h1><p class="muted">Hosted by ${esc(host?.name ?? 'someone')}${host?.username ? ` (@${esc(host.username)})` : ''}${host?.verifiedAt ? ` · verified ${esc(host.campus ?? '')} student` : ''}</p>
<dl>${stops}</dl>
<p class="muted">Public venues only. Share this page with a friend before you meet someone new.</p>
<a class="btn" href="https://apps.apple.com/">Open in the app</a>`,
        ),
      );
    },
  );
};

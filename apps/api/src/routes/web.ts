import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

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

export const webRoutes: FastifyPluginAsyncZod = async (app) => {
  const { config, db } = app.ctx;

  // Universal links: stickers (/c venue, /t personal) and plan share links (/p) open the app.
  app.get('/.well-known/apple-app-site-association', { schema: { hide: true } }, async (_req, reply) => {
    const appID = config.APPLE_TEAM_ID && config.APPLE_BUNDLE_ID ? `${config.APPLE_TEAM_ID}.${config.APPLE_BUNDLE_ID}` : 'TEAMID.BUNDLEID';
    return reply.type('application/json').send({
      applinks: {
        details: [{ appIDs: [appID], components: [{ '/': '/c/*' }, { '/': '/t/*' }, { '/': '/p/*' }] }],
      },
    });
  });

  const fallback = (kind: 'venue' | 'personal') => async (req: { params: { id: string } }, reply: { type: (t: string) => { send: (b: string) => unknown } }) => {
    let line = kind === 'venue' ? 'A check-in spot.' : 'Someone’s tag. Tap yours back to become friends.';
    if (kind === 'venue') {
      const tag = await db.collection<{ _id: string; placeId?: string }>('tags').findOne({ _id: req.params.id });
      const place = tag?.placeId ? await db.collection<{ _id: string; name: string }>('places').findOne({ _id: tag.placeId }) : null;
      if (place) line = `Check in at ${place.name}.`;
    }
    return reply.type('text/html').send(
      page('It only counts if you go', `<h1>It only counts if you go.</h1><p>${esc(line)}</p>
<p class="muted">This tag works with the app: install it, then tap again.</p>
<a class="btn" href="https://apps.apple.com/">Get the app</a>`),
    );
  };

  const Params = z.object({ id: z.string().max(64) });
  app.get('/c/:id', { schema: { hide: true, params: Params } }, fallback('venue'));
  app.get('/t/:id', { schema: { hide: true, params: Params } }, fallback('personal'));
};

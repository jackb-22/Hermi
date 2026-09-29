/**
 * Dress rehearsal of the AI button against the running demo backend (scripts/demo-up.sh), through its public URL,
 * exactly as the app calls it. Uses a throwaway account (@rehearsal), never the demo accounts, and cancels its plan.
 *
 *   pnpm --filter @itp/api exec tsx scripts/demo-rehearse.ts [--url https://….ngrok-free.dev] [--gap 4000]
 *
 * The URL defaults to .demo/url and the dev token to DEV_TOKEN in .env.demo. Prints each call's time and result;
 * exits 1 if a call fails. --gap spaces the AI calls for free-tier Gemini keys.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const root = join(import.meta.dirname, '../../..');
const { values } = parseArgs({
  options: { url: { type: 'string' }, gap: { type: 'string', default: '4000' } },
});
const url = (values.url ?? readFileSync(join(root, '.demo/url'), 'utf8')).trim().replace(/\/$/, '');
const devToken =
  /^DEV_TOKEN=(.*)$/m.exec(readFileSync(join(root, '.env.demo'), 'utf8'))?.[1]?.trim() ?? '';
const gap = () => new Promise((r) => setTimeout(r, Number(values.gap)));

let auth = '';
let failed = 0;
async function call<T>(
  label: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T | undefined> {
  const t0 = Date.now();
  const res = await fetch(`${url}${path === '/health' ? '' : '/v1'}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-dev-token': devToken,
      'ngrok-skip-browser-warning': '1',
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((e: Error) => ({ ok: false, status: 0, text: async () => e.message }) as Response);
  const ms = Date.now() - t0;
  if (!res.ok) {
    failed++;
    console.log(`✗ ${label} (${ms} ms) HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return undefined;
  }
  console.log(`✓ ${label} (${ms} ms)`);
  return (await res.json()) as T;
}

type Plan = {
  id: string;
  stops: {
    place: { name: string } | null;
    arriveAt: string;
    legMin: number | null;
    legMode: string | null;
  }[];
};
type Ask = {
  plan: Plan;
  preview: Plan | null;
  message: string;
  via: string;
  sources: { title: string }[];
};
const nyTime = (s: string) =>
  new Date(s).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
const timeline = (p: Plan) =>
  p.stops
    .map(
      (s, i) => `${i ? `→(${s.legMode} ${s.legMin}m) ` : ''}${s.place?.name} ${nyTime(s.arriveAt)}`,
    )
    .join(' ');

console.log(`▶ ${url}`);
const health = await call<Record<string, unknown>>('health', 'GET', '/health');
if (health) console.log('  providers:', JSON.stringify(health.providers ?? health));
const login = await call<{ token: string }>('dev login @rehearsal', 'POST', '/auth/dev', {
  username: 'rehearsal',
});
if (!login) process.exit(1);
auth = login.token;

// Three real places near Columbia: food, culture, sports.
const COLUMBIA = { lat: 40.8075, lng: -73.9626 };
const pick = async (cat: string) =>
  (
    await call<{ items: { id: string; name: string }[] }>(
      `places near (${cat})`,
      'GET',
      `/places/near?lat=${COLUMBIA.lat}&lng=${COLUMBIA.lng}&cat=${cat}&r=1500`,
    )
  )?.items[0];
const stops = (await Promise.all(['food', 'culture', 'sports'].map(pick))).filter(Boolean) as {
  id: string;
  name: string;
}[];
const tomorrow1pm = new Date(Date.now() + 86_400_000);
tomorrow1pm.setUTCHours(17, 0, 0, 0);
const plan = await call<Plan>('create plan', 'POST', '/plans', {
  startAt: tomorrow1pm.toISOString(),
  stops: stops.map((s) => ({ placeId: s.id })),
});
if (!plan) process.exit(1);
console.log(`  plan: ${timeline(plan)}`);

const asks: [string, object][] = [
  ['Space it out', { chip: 'space_stops' }],
  ['Best weather day', { chip: 'best_weather_day' }],
  ['Add a stop: music', { chip: 'suggest_activity', category: 'music' }],
  ['chat: question', { prompt: 'is the first stop open then?' }],
  ['chat: change', { prompt: 'add a coffee stop before the last one' }],
  ['chat: off-topic', { prompt: 'write me a poem about the moon' }],
];
for (const [label, body] of asks) {
  await gap();
  const r = await call<Ask>(label, 'POST', `/plans/${plan.id}/ask`, body);
  if (!r) continue;
  console.log(`  via ${r.via}: ${r.message}`);
  for (const s of r.sources) console.log(`  ↗ ${s.title}`);
  if (r.preview) console.log(`  preview: ${timeline(r.preview)}`);
  if (label === 'Space it out' && r.preview) {
    const applied = await call<Plan>('Apply', 'POST', `/plans/${plan.id}/changes/apply`, {});
    if (applied) console.log(`  applied: ${timeline(applied)}`);
  } else if (r.preview) await call('Dismiss', 'POST', `/plans/${plan.id}/changes/dismiss`, {});
}
await call('cancel plan', 'DELETE', `/plans/${plan.id}`);
console.log(failed ? `\n✗ ${failed} call(s) failed` : '\n✓ rehearsal passed');
process.exit(failed ? 1 : 0);

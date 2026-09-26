/**
 * Two phones tapping each other's personal tags, over HTTP:
 *   tsx scripts/simulate-tap.ts --base http://localhost:3000 [--dev-token X]
 * Mints and binds a personal tag for each user via /dev/tags, then taps both ways.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3000' },
    'dev-token': { type: 'string', default: process.env.DEV_TOKEN ?? '' },
  },
});
const BASE = values.base!.replace(/\/$/, '');

async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(values['dev-token'] ? { 'x-dev-token': values['dev-token'] } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

const suffix = randomBytes(2).toString('hex');
const login = async (name: string) =>
  (await call('', 'POST', '/auth/dev', { username: `${name}_${suffix}` })).token as string;
const a = await login('tap_a');
const b = await login('tap_b');
const tagA = (await call(a, 'POST', '/dev/tags', { kind: 'personal' })).url;
const tagB = (await call(b, 'POST', '/dev/tags', { kind: 'personal' })).url;
const here = { lat: 40.8075, lng: -73.9626, accuracy: 10 };

const first = await call(a, 'POST', '/taps', { url: tagB, ...here });
console.log(`A taps B: ${first.status} (expires ${first.expiresAt})`);
const second = await call(b, 'POST', '/taps', { url: tagA, ...here });
console.log(
  `B taps A: ${second.status}, streak ${second.streak?.weeks}w, hangouts ${second.streak?.hangouts}`,
);
if (second.status !== 'friends' && second.status !== 'hangout') throw new Error('tap did not pair');
console.log('TAPS WORK ✔');

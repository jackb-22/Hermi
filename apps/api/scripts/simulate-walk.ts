/**
 * Drives the real HTTP API through one full quest, no UI needed:
 * login → pick 4 real places → plan → AI schedule → Start → trace upload → GPS and tag check-ins
 * → photo capture (presign, PUT, commit) → End → recap. Uses the dev clock to compress ~45 minutes of walking.
 *
 *   tsx scripts/simulate-walk.ts --base http://localhost:3000
 *   tsx scripts/simulate-walk.ts --base https://<app>.ondigitalocean.app --user demo_walker
 *
 * Needs a deployment with DEV_ROUTES=1 and a worker running (RUN_WORKER=inline locally).
 */
import { createHash, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { type LatLng, haversineM } from '@itp/shared';
import { walk } from './lib/walk.ts';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3000' },
    user: { type: 'string', default: `sim_${randomBytes(3).toString('hex')}` },
    lat: { type: 'string', default: '40.8050' },
    lng: { type: 'string', default: '-73.9650' },
  },
});
const BASE = values.base!.replace(/\/$/, '');
let token = '';

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}/v1${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text}`);
  return json as T;
}
const step = (m: string) => console.log(`\n▶ ${m}`);
const ok = (m: string) => console.log(`  ✓ ${m}`);

// 1. Sign in
step(`sign in as ${values.user}`);
token = (await api('POST', '/auth/dev', { username: values.user })).token;
await api('POST', '/me/taste', { is21: true, swipes: [{ cardId: 'coffee_mornings', liked: true }, { cardId: 'bookstores', liked: true }, { cardId: 'live_jazz', liked: true }, { cardId: 'karaoke', liked: false }] });
ok('signed in, taste set');

// 2. Four real places heading north, one per category
step('pick stops');
const cats = ['food', 'shopping', 'nature', 'music'] as const;
let cursor: LatLng = { lat: Number(values.lat), lng: Number(values.lng) };
const stops: { id: string; name: string; loc: LatLng }[] = [];
for (const cat of cats) {
  const near = await api('GET', `/places/near?lat=${cursor.lat}&lng=${cursor.lng}&cat=${cat}&r=500`);
  const pick = near.items.find((p: { id: string }) => !stops.some((s) => s.id === p.id));
  if (!pick) throw new Error(`no ${cat} place near ${cursor.lat},${cursor.lng}`);
  stops.push({ id: pick.id, name: pick.name, loc: pick.loc });
  ok(`${cat}: ${pick.name} (${pick.distanceM} m)`);
  cursor = { lat: pick.loc.lat + 0.0025, lng: pick.loc.lng };
}

// 3. Plan + AI schedule
step('plan and schedule');
let plan = await api('POST', '/plans', { stops: stops.map((s) => ({ placeId: s.id })) });
plan = await api('POST', `/plans/${plan.id}/schedule`);
for (const s of plan.stops) ok(`${s.index}. ${s.label} ${s.arriveAt.slice(11, 16)}Z stay ${s.stayMin}m${s.legMin ? `, leg ${s.legMin}m ${s.legSource}` : ''}`);
ok(`issues: ${plan.issues.length}, ghost fixes: ${plan.ghostChanges.map((g: { label: string }) => g.label).join('; ') || 'none'}, xp preview +${plan.totals.xpPreview}`);

// 4. Build the walk, compressed into the past with the dev clock
const DWELL = 6;
// Start ~400 m south of the first stop: GPS check-ins need a trace leading in from outside the fence.
const start = { lat: stops[0]!.loc.lat - 0.0036, lng: stops[0]!.loc.lng };
const path = [start, ...stops.map((s) => s.loc)];
const t0 = new Date(Date.now() - 90 * 60_000);
const pts = walk(path, t0, { dwellMin: Object.fromEntries(stops.map((_, i) => [i + 1, DWELL])) });
const setClock = async (t: Date) => api('POST', '/dev/clock', { offsetMs: t.getTime() - Date.now() });
await setClock(t0);

step('Start (Action mode)');
const started = await api('POST', '/sessions', { planId: plan.id });
const sid = started.session.id;
ok(`session ${sid}, ${started.geofences.length} geofences`);

let sent = 0;
let totalXp = 0;
for (let i = 0; i < stops.length; i++) {
  const s = stops[i]!;
  // last fix of the dwell at this stop
  let idx = sent;
  while (idx < pts.length && !(haversineM(pts[idx]!, s.loc) < 1 && pts[idx + 1] && haversineM(pts[idx + 1]!, s.loc) > 1)) idx++;
  const batch = pts.slice(sent, idx + 1);
  const now = new Date(new Date(batch.at(-1)!.time).getTime() + 5_000);
  await setClock(now);
  for (let k = 0; k < batch.length; k += 400) await api('POST', `/sessions/${sid}/points`, { points: batch.slice(k, k + 400) });
  sent = idx + 1;

  const useTag = i % 2 === 1;
  let res;
  if (useTag) {
    const tag = await api('POST', '/dev/tags', { kind: 'venue', placeId: s.id });
    res = await api('POST', '/checkins', { tier: 'tag', tagUrl: tag.url, lat: s.loc.lat, lng: s.loc.lng, accuracy: 12 });
  } else {
    res = await api('POST', '/checkins', { tier: 'gps', placeId: s.id, sessionId: sid, lat: s.loc.lat, lng: s.loc.lng, accuracy: 12 });
  }
  totalXp += res.xp.total;
  ok(`check-in ${res.checkin.tier.toUpperCase()} at ${s.name}: +${res.xp.total} XP (${res.xp.items.map((x: { label: string; xp: number }) => `${x.label} ${x.xp}`).join(', ')})`);

  if (i === 1) {
    const bytes = randomBytes(40_000);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const p = await api('POST', '/media/presign', { checkinId: res.checkin.id, kind: 'photo', contentType: 'image/jpeg', sha256: sha, bytes: bytes.length, capturedAt: now.toISOString(), lat: s.loc.lat, lng: s.loc.lng });
    const put = await fetch(p.upload.url, { method: 'PUT', headers: p.upload.headers, body: new Uint8Array(bytes) });
    if (!put.ok) throw new Error(`upload ${put.status} ${await put.text()}`);
    const m = await api('POST', `/media/${p.media.id}/commit`);
    ok(`photo captured and verified (${m.status}) → ${m.verifyUrl}`);
  }
}

step('End');
const rest = pts.slice(sent);
if (rest.length) {
  await setClock(new Date(new Date(rest.at(-1)!.time).getTime() + 5_000));
  await api('POST', `/sessions/${sid}/points`, { points: rest });
}
await api('POST', `/sessions/${sid}/end`, { steps: 2400 });
await api('POST', '/dev/clock', { reset: true });

let recap = null;
for (let i = 0; i < 30 && !recap; i++) {
  const r = await api('GET', `/sessions/${sid}/recap`);
  if (r.status === 'ready') recap = r.recap;
  else await new Promise((res) => setTimeout(res, 1000));
}
if (!recap) throw new Error('recap not ready after 30 s: is a worker running?');
ok(`recap: ${recap.stops.length} stops, ${recap.footKm} km on foot, ${recap.newTiles.length} new tiles, plan completed: ${recap.planCompleted}`);
for (const x of recap.xp.items) ok(`  ${x.label.padEnd(18)} +${x.xp}`);
ok(`TOTAL +${recap.xp.total} XP (check-ins during walk: +${totalXp})`);
console.log('\nLOOP WORKS ✔');

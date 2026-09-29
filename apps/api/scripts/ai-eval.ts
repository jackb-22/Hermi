/**
 * Live eval of the AI button against real providers (Gemini, Routes, Open-Meteo) and the local places DB:
 *   pnpm --filter @itp/api exec tsx --env-file=../../.env scripts/ai-eval.ts [--only <regex>] [--json <file>]
 *
 * Each case gets a fresh copy of a Columbia plan (Hungarian Pastry Shop → Lerner Hall or Butler Library → Movement Harlem),
 * asks, checks invariants, applies, checks the timeline, then deletes the plan. Exits 1 when an invariant fails.
 * Local databases only: it refuses a non-localhost MONGO_URI.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildApp } from '../src/app.ts';
import { closeContext, createContext } from '../src/boot.ts';
import { loadConfig } from '../src/config.ts';

const { values: args } = parseArgs({
  // --gap: ms between cases, for free-tier keys (their per-minute limits are low).
  options: {
    only: { type: 'string' },
    json: { type: 'string' },
    gap: { type: 'string', default: '0' },
  },
});
const config = loadConfig({ ...process.env, RUN_WORKER: 'off', LOG_LEVEL: 'warn' });
if (!/localhost|127\.0\.0\.1/.test(config.MONGO_URI)) {
  console.error('ai-eval writes plans: point MONGO_URI at the local docker database');
  process.exit(2);
}
const ctx = await createContext(config);
const app = await buildApp(ctx);
await app.ready();
console.log(
  `llm=${ctx.providers.llm.name} eta=${ctx.providers.eta.name} weather=${ctx.providers.weather.name}`,
);

const inject = async (method: 'GET' | 'POST', url: string, headers: object, payload?: object) => {
  const r = await app.inject({ method, url: `/v1${url}`, headers: headers as never, payload });
  return { status: r.statusCode, body: r.json() };
};
const login = await inject('POST', '/auth/dev', {}, { username: 'ai_eval' });
const headers = { authorization: `Bearer ${login.body.token}` };

if (login.status !== 200) throw new Error(`dev login failed: ${JSON.stringify(login.body)}`);
/** The first of these names found (the demo's Lerner Hall only exists on the production data). */
const byName = async (...names: string[]) => {
  for (const name of names) {
    const p = await ctx.db.collection('places').findOne({ name });
    if (p) return p._id as unknown as string;
  }
  throw new Error(
    `none of ${names.join(', ')} is in the local places DB (run the Overture import)`,
  );
};
const stops = [
  await byName('The Hungarian Pastry Shop'),
  await byName('Alfred Lerner Hall', 'Butler Library', 'Low Memorial Library'),
  await byName('Movement Harlem'),
];
const tomorrow1pm = () => {
  const d = new Date(ctx.clock.now().getTime() + 86_400_000);
  const day = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return new Date(`${day}T13:00:00-04:00`).toISOString();
};

type Case = { name: string; body: object; expect: 'changes' | 'none' | 'any'; reply?: RegExp };
const cases: Case[] = [
  { name: 'space_stops', body: { chip: 'space_stops' }, expect: 'any' },
  { name: 'best_weather_day', body: { chip: 'best_weather_day' }, expect: 'any' },
  {
    name: 'suggest music',
    body: { chip: 'suggest_activity', category: 'music' },
    expect: 'changes',
  },
  { name: 'suggest food', body: { chip: 'suggest_activity', category: 'food' }, expect: 'changes' },
  {
    name: 'suggest nature',
    body: { chip: 'suggest_activity', category: 'nature' },
    expect: 'changes',
  },
  {
    name: 'chat: question',
    body: { prompt: "what's the plan and when does it end?" },
    expect: 'none',
  },
  { name: 'chat: hours', body: { prompt: 'is the pastry shop open then?' }, expect: 'none' },
  {
    name: 'chat: indoor swap',
    body: {
      prompt: 'it might rain, make the gym the last indoor thing and drop anything outdoors',
    },
    expect: 'any',
  },
  {
    name: 'chat: add coffee',
    body: { prompt: 'add a coffee stop before the climbing gym' },
    expect: 'changes',
  },
  {
    name: 'chat: follow-up',
    body: {
      prompt: 'actually make that a bakery instead',
      history: [
        { role: 'user', text: 'add a coffee stop before the climbing gym' },
        { role: 'model', text: 'Added a coffee stop before Movement Harlem.' },
      ],
    },
    expect: 'any',
  },
  {
    name: 'chat: invite (refuse)',
    body: { prompt: 'invite ben and text him the plan' },
    expect: 'none',
  },
  {
    name: 'chat: off-topic (refuse)',
    body: { prompt: 'write a haiku about Kant' },
    expect: 'none',
    reply: /only help with this plan/,
  },
];

const PLAN_KINDS = new Set([
  'swap',
  'move',
  'add_stop',
  'remove_stop',
  'set_mode',
  'set_start',
  'set_stay',
]);
const NYC = { s: 40.49, n: 40.92, w: -74.26, e: -73.7 };
const results: Record<string, unknown>[] = [];
const failures: string[] = [];

for (const c of cases.filter((c) => !args.only || new RegExp(args.only).test(c.name))) {
  await new Promise((r) => setTimeout(r, Number(args.gap)));
  const plan = await inject('POST', '/plans', headers, {
    startAt: tomorrow1pm(),
    stops: stops.map((placeId) => ({ placeId })),
  });
  const id = plan.body.id as string;
  const t0 = Date.now();
  const r = await inject('POST', `/plans/${id}/ask`, headers, c.body);
  const ms = Date.now() - t0;
  const fail = (why: string) => failures.push(`${c.name}: ${why}`);
  if (r.status !== 200) fail(`HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const changes = (r.body.plan?.ghostChanges ?? []) as {
    kind: string;
    label: string;
    stop?: { placeId: string };
  }[];
  for (const g of changes) {
    if (!PLAN_KINDS.has(g.kind)) fail(`non-plan change ${g.kind}`);
    if (g.stop?.placeId) {
      const p = await ctx.db.collection('places').findOne({ _id: g.stop.placeId as never });
      const [lng, lat] = (p?.loc?.coordinates ?? []) as number[];
      if (!p) fail(`added unknown place ${g.stop.placeId}`);
      else if (!(lat! > NYC.s && lat! < NYC.n && lng! > NYC.w && lng! < NYC.e))
        fail(`${p.name} is outside NYC`);
    }
  }
  if (c.expect === 'changes' && !changes.length) fail('expected a change');
  if (c.reply && !c.reply.test(r.body.message ?? ''))
    fail(`reply ${JSON.stringify(r.body.message)} !~ ${c.reply}`);
  if (c.expect === 'none' && changes.length)
    fail(`expected no change, got ${changes.map((g) => g.kind)}`);

  // Apply and check the timeline is consistent: arrive = previous depart + leg.
  let timeline = '';
  if (changes.length) {
    const after = await inject('POST', `/plans/${id}/changes/apply`, headers, {});
    const s = after.body.stops as {
      arriveAt: string;
      departAt: string;
      legMin: number | null;
      place: { name: string };
    }[];
    for (let i = 1; i < s.length; i++)
      if (
        Date.parse(s[i]!.arriveAt) - Date.parse(s[i - 1]!.departAt) !==
        (s[i]!.legMin ?? 0) * 60_000
      )
        fail(`stop ${i + 1} is not spaced by its leg`);
    timeline = s
      .map(
        (x) =>
          `${x.place.name} ${new Date(x.arriveAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}`,
      )
      .join(' → ');
  }
  await ctx.db.collection('plans').deleteOne({ _id: id as never });

  results.push({
    case: c.name,
    ms,
    via: r.body.via,
    message: r.body.message,
    changes: changes.map((g) => `${g.kind}: ${g.label}`),
    sources: r.body.sources,
    timeline,
  });
  console.log(`\n■ ${c.name}  (${ms} ms, via ${r.body.via})\n  ${r.body.message}`);
  for (const g of changes) console.log(`  · ${g.kind}: ${g.label}`);
  for (const s of r.body.sources ?? []) console.log(`  ↗ ${s.title} ${s.uri}`);
  if (timeline) console.log(`  ⇒ ${timeline}`);
}

const ms = results.map((r) => r.ms as number).sort((a, b) => a - b);
const p50 = ms[Math.floor(ms.length / 2)] ?? 0;
console.log(`\n${results.length} cases, p50 ${p50} ms, max ${ms.at(-1)} ms`);
if (p50 > 5000) failures.push(`p50 latency ${p50} ms > 5000 ms`);
if (args.json) writeFileSync(args.json, JSON.stringify({ results, failures }, null, 2));
await app.close();
await closeContext(ctx);
if (failures.length) {
  console.log(`\n✗ ${failures.length} invariant failures:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('✓ all invariants hold');

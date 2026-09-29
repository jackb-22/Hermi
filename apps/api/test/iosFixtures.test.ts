/**
 * Real server responses for the iOS app's AI button, written as JSON fixtures the Swift tests decode and the
 * screenshot scenarios replay (Sources/HermiDesign/Resources/ai-fixtures). The places are the app's own sample
 * fixtures (same ids, names and coordinates), the clock is fixed and ids are renumbered, so output is stable.
 *
 *   WRITE_IOS_FIXTURES=1 pnpm --filter @itp/api exec vitest run test/iosFixtures.test.ts   # regenerate
 * Without the variable the test fails when a checked-in fixture no longer matches what the server returns.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { haversineM } from '@itp/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { EtaProvider } from '../src/providers/eta.ts';
import { GeminiLlm } from '../src/providers/llm.ts';
import type { DayForecast, WeatherProvider } from '../src/providers/weather.ts';
import { placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

const DIR = join(
  import.meta.dirname,
  '../../ios/HermiPreview/Sources/HermiDesign/Resources/ai-fixtures',
);
const NOW = new Date('2026-10-02T14:00:00Z'); // Fri 10 AM in New York
const START = '2026-10-03T16:00:00.000Z'; // Sat noon, like --hermi-plan-review

// MapSamplePlace.fixtures in MapPreviewState.swift.
const SAMPLES = [
  {
    id: 'garden',
    name: 'Riverside gardens',
    category: 'nature',
    lat: 40.808,
    lng: -73.967,
    tags: ['park', 'outdoor'],
  },
  {
    id: 'cafe',
    name: 'Corner café',
    category: 'food',
    lat: 40.8073,
    lng: -73.9654,
    tags: ['coffee'],
  },
  {
    id: 'gallery',
    name: 'Little gallery',
    category: 'culture',
    lat: 40.8077,
    lng: -73.9625,
    tags: ['gallery', 'indoor'],
  },
  {
    id: 'books',
    name: 'The book nook',
    category: 'shopping',
    lat: 40.805,
    lng: -73.9653,
    tags: ['indoor'],
  },
  { id: 'tea', name: 'Tea room', category: 'drinks', lat: 40.8101, lng: -73.962, tags: ['indoor'] },
  {
    id: 'court',
    name: 'Riverside courts',
    category: 'sports',
    lat: 40.8039,
    lng: -73.9708,
    tags: ['outdoor'],
  },
  {
    id: 'music',
    name: 'Evening jazz',
    category: 'music',
    lat: 40.8026,
    lng: -73.9661,
    tags: ['live_jazz'],
  },
] as const;

let t: Awaited<ReturnType<typeof setupTestApp>>;
let u: Awaited<ReturnType<typeof devLogin>>;
const out: Record<string, unknown> = {};

beforeAll(async () => {
  t = await setupTestApp();
  t.ctx.clock.now = () => new Date(NOW);
  await t.ctx.db.collection('places').insertMany(
    SAMPLES.map((s) => ({
      ...placeDoc({ name: s.name, category: s.category, tags: [...s.tags] as never, at: s }),
      _id: s.id,
      createdAt: NOW,
    })) as never,
  );
  const eta: EtaProvider = {
    name: 'stub',
    eta: async (o, d, mode) => ({
      minutes: Math.max(
        1,
        Math.round(mode === 'transit' ? 8 + haversineM(o, d) / 400 : haversineM(o, d) / 70),
      ),
      source: 'google',
    }),
  };
  const forecast: DayForecast[] = ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map(
    (date, i) => ({
      date,
      highF: [66, 61, 72, 58][i]!,
      lowF: 52,
      precipChance: [0.2, 0.85, 0.05, 0.6][i]!,
      windMph: 6,
    }),
  );
  const weather: WeatherProvider = { name: 'stub', daily: async () => forecast };
  Object.assign(t.ctx.providers, { eta, weather });
  u = await devLogin(t.app, 'ava');
});
afterAll(() => t.teardown());

const newPlan = async () =>
  (
    await t.app.inject({
      method: 'POST',
      url: '/v1/plans',
      headers: u.headers,
      payload: {
        startAt: START,
        stops: [
          { placeId: 'cafe', stayMin: 60 },
          { placeId: 'gallery', stayMin: 60 },
          { placeId: 'garden', stayMin: 30 },
        ],
      },
    })
  ).json();
const post = async (url: string, payload: object) => {
  const r = await t.app.inject({ method: 'POST', url: `/v1${url}`, headers: u.headers, payload });
  expect(r.statusCode, `${url}: ${r.body.slice(0, 200)}`).toBe(200);
  return r.json();
};
/** A Gemini whose SDK replies follow a script (function calls, then text). */
function scripted(turns: ({ name: string; args: Record<string, unknown> } | string)[]) {
  const llm = new GeminiLlm('k', 'fixture-model');
  let n = 0;
  (llm.ai.models as unknown as { generateContent: unknown }).generateContent = async () => {
    const turn = turns[n++] ?? 'Done.';
    if (typeof turn === 'string') return { text: turn, functionCalls: [] };
    const functionCall = { id: `c${n}`, ...turn };
    return {
      functionCalls: [functionCall],
      candidates: [{ content: { role: 'model', parts: [{ functionCall }] } }],
    };
  };
  llm.askMaps = async () => ({
    text: 'Tea room has window seats and stays open until 9 PM.',
    sources: [{ title: 'Tea room', uri: 'https://maps.google.com/?cid=1234567890' }],
  });
  return llm;
}

test('AI button fixtures', async () => {
  const plan = await newPlan();
  out.plan = plan;

  for (const [name, body] of [
    ['space_stops', { chip: 'space_stops' }],
    ['suggest_activity', { chip: 'suggest_activity', category: 'music' }],
    ['best_weather_day', { chip: 'best_weather_day' }],
  ] as const) {
    const p = await newPlan();
    out[`ask-${name}`] = await post(`/plans/${p.id}/ask`, body);
    out[`apply-${name}`] = await post(`/plans/${p.id}/changes/apply`, {});
  }

  const chatPlan = await newPlan();
  t.ctx.providers.llm = scripted([
    { name: 'remove_stop', args: { index: 3, why: 'Drop Riverside gardens: rain after 2 PM' } },
    { name: 'search_places', args: { category: 'drinks', near_index: 2 } },
    {
      name: 'add_stop',
      args: { placeId: 'tea', position: 3, why: 'Tea room instead: indoors, 4 min away' },
    },
    'Swapped the gardens for the Tea room, since rain is likely after 2 PM.',
  ]);
  out['ask-chat'] = await post(`/plans/${chatPlan.id}/ask`, {
    prompt: 'it might rain, make the last stop indoors',
    history: [
      { role: 'user', text: 'is this a good Saturday plan?' },
      { role: 'model', text: 'Yes: three stops within a short walk, ending by 3:30 PM.' },
    ],
  });
  out['apply-chat'] = await post(`/plans/${chatPlan.id}/changes/apply`, {});
  t.ctx.providers.llm = scripted([
    {
      name: 'ask_maps',
      args: { question: 'Does the Tea room have seating and when does it close?', near_index: 3 },
    },
    'Yes: window seats, open until 9 PM.',
  ]);
  out['ask-chat-answer'] = await post(`/plans/${chatPlan.id}/ask`, {
    prompt: 'does the tea room have seats?',
  });
  out['dismiss-chat'] = await post(`/plans/${chatPlan.id}/changes/dismiss`, {});

  // What the app shows when the hourly limit is reached.
  const r = await t.app.inject({
    method: 'POST',
    url: `/v1/plans/${chatPlan.id}/ask`,
    headers: { ...u.headers },
    payload: { prompt: '' },
  });
  out['error-400'] = r.json();

  // Stable ids: every ULID becomes id-N and every share token share-N, in order of appearance.
  const renumber = (prefix: string) => {
    const seen = new Map<string, string>();
    return (m: string) => {
      if (!seen.has(m)) seen.set(m, `${prefix}${seen.size + 1}`);
      return seen.get(m)!;
    };
  };
  const text = JSON.stringify(out, null, 2)
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, renumber('id-'))
    .replace(/(?<=\/p\/)[A-Za-z0-9_-]{12}(?=")/g, renumber('share-'));
  const files = JSON.parse(text) as Record<string, unknown>;
  for (const [name, value] of Object.entries(files)) {
    const path = join(DIR, `${name}.json`);
    const json = `${JSON.stringify(value, null, 2)}\n`;
    if (process.env.WRITE_IOS_FIXTURES === '1') writeFileSync(path, json);
    else {
      const want = readFileSync(path, 'utf8');
      const got = join(tmpdir(), `ios-fixture-${name}.json`);
      if (want !== json) writeFileSync(got, json);
      expect(want, `${name}.json is stale: regenerate (see header); this run wrote ${got}`).toBe(
        json,
      );
    }
  }
});

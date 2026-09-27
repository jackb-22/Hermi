import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { bestDay, nyLocal, nyLocalToUtc, scoreDay } from '../src/domain/weatherDay.ts';
import { syncMemory } from '../src/services/memory.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

describe('weather day and NY time helpers', () => {
  const day = (date: string, highF: number, precipChance: number, windMph = 5) => ({
    date,
    highF,
    lowF: highF - 10,
    precipChance,
    windMph,
  });
  test('rain matters more for outdoor plans; mild beats hot', () => {
    expect(scoreDay(day('a', 70, 0.8), 1)).toBeLessThan(scoreDay(day('a', 70, 0.8), 0));
    expect(scoreDay(day('a', 70, 0.1), 1)).toBeGreaterThan(scoreDay(day('a', 92, 0.1), 1));
    const best = bestDay(
      [day('2026-10-01', 70, 0.1), day('2026-10-02', 70, 0), day('2026-10-03', 70, 0)],
      1,
      '2026-10-02',
    );
    expect(best?.day.date).toBe('2026-10-02');
  });
  test('New York wall clock to UTC across DST', () => {
    expect(nyLocalToUtc('2026-07-04', 19, 30).toISOString()).toBe('2026-07-04T23:30:00.000Z');
    expect(nyLocalToUtc('2026-12-04', 19, 30).toISOString()).toBe('2026-12-05T00:30:00.000Z');
    expect(nyLocalToUtc('2026-11-01', 12, 0).toISOString()).toBe('2026-11-01T17:00:00.000Z');
    expect(nyLocal(new Date('2026-12-05T00:30:00Z'))).toEqual({
      date: '2026-12-04',
      hour: 19,
      minute: 30,
    });
  });
});

const fixtures = () => [
  placeDoc({
    name: 'Riverside Park',
    category: 'nature',
    tags: ['park', 'outdoor'],
    at: offset(ORIGIN, 300, 0),
  }),
  placeDoc({
    name: 'Small Gallery',
    category: 'culture',
    tags: ['gallery', 'indoor'],
    at: offset(ORIGIN, 400, 0),
  }),
  placeDoc({
    name: 'Steakhouse',
    category: 'food',
    tags: ['fine_dining', 'splurge'],
    at: offset(ORIGIN, 200, 0),
  }),
  placeDoc({
    name: 'Dollar Slice',
    category: 'food',
    tags: ['pizza', 'cheap'],
    at: offset(ORIGIN, 250, 0),
  }),
  placeDoc({ name: 'Corner Cafe', category: 'food', tags: ['coffee'], at: offset(ORIGIN, 100, 0) }),
];

/** Tomorrow in New York at a local wall-clock time. */
const tomorrowAt = (now: Date, h: number, m = 0) =>
  nyLocalToUtc(nyLocal(new Date(now.getTime() + 86_400_000)).date, h, m).toISOString();

describe('POST /plans/:id/ask without AI keys (rules for chips)', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let u: Awaited<ReturnType<typeof devLogin>>;
  let id: Record<string, string>;
  beforeAll(async () => {
    t = await setupTestApp();
    id = Object.fromEntries((await insertPlaces(t.ctx.db, fixtures())).map((d) => [d.name, d._id]));
    u = await devLogin(t.app, 'asker');
  });
  afterAll(() => t.teardown());

  const plan = async (names: string[], extra: object = {}) =>
    (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: {
          startAt: tomorrowAt(t.ctx.clock.now(), 16, 30),
          stops: names.map((n) => ({ placeId: id[n] })),
          ...extra,
        },
      })
    ).json();
  const ask = (planId: string, payload: object, headers = u.headers) =>
    t.app.inject({ method: 'POST', url: `/v1/plans/${planId}/ask`, headers, payload });
  const applyAll = async (planId: string) =>
    (
      await t.app.inject({
        method: 'POST',
        url: `/v1/plans/${planId}/changes/apply`,
        headers: u.headers,
        payload: {},
      })
    ).json();
  const names = (p: { stops: { place: { name: string } | null }[] }) =>
    p.stops.map((s) => s.place?.name);

  test('Add dinner: one food stop (not the cafe), as a ghost change until accepted', async () => {
    const p = await plan(['Riverside Park', 'Small Gallery']);
    const r = await ask(p.id, { chip: 'add_dinner' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.via).toBe('code');
    expect(body.plan.stops).toHaveLength(2);
    expect(body.plan.ghostChanges).toEqual([
      expect.objectContaining({ kind: 'add_stop', stop: { placeId: expect.any(String) } }),
    ]);
    const after = await applyAll(p.id);
    expect(after.stops).toHaveLength(3);
    const food = after.stops.find(
      (s: { place: { category: string } }) => s.place.category === 'food',
    );
    expect(food.place.name).not.toBe('Corner Cafe');
    expect(after.ghostChanges).toEqual([]);
  });

  test('Rain-proof it swaps the park for an indoor place', async () => {
    const p = await plan(['Steakhouse', 'Riverside Park']);
    const body = (await ask(p.id, { chip: 'rain_proof' })).json();
    expect(body.plan.ghostChanges.map((g: { kind: string }) => g.kind)).toEqual([
      'remove_stop',
      'add_stop',
    ]);
    expect(names(await applyAll(p.id))).toEqual(['Steakhouse', 'Small Gallery']);
  });

  test('Make it cheaper swaps the steakhouse for the slice shop', async () => {
    const p = await plan(['Steakhouse', 'Small Gallery']);
    await ask(p.id, { chip: 'cheaper' });
    expect(names(await applyAll(p.id))).toEqual(['Dollar Slice', 'Small Gallery']);
  });

  test('Best weather day: code picks the day, keeps the start time and moves end-by along', async () => {
    const start = tomorrowAt(t.ctx.clock.now(), 15, 0);
    const endBy = tomorrowAt(t.ctx.clock.now(), 21, 0);
    const p = await plan(['Riverside Park'], { startAt: start, endBy });
    const days = await t.ctx.providers.weather.daily(ORIGIN);
    const want = bestDay(days, 1, nyLocal(t.ctx.clock.now()).date)!.day.date;
    const body = (await ask(p.id, { chip: 'best_weather_day' })).json();
    if (want === nyLocal(new Date(start)).date) {
      expect(body.plan.ghostChanges).toEqual([]);
      expect(body.message).toMatch(/already the best/);
      return;
    }
    expect(body.plan.ghostChanges).toEqual([expect.objectContaining({ kind: 'set_start' })]);
    const after = await applyAll(p.id);
    expect(nyLocal(new Date(after.startAt))).toMatchObject({ date: want, hour: 15, minute: 0 });
    expect(Date.parse(after.endBy) - Date.parse(after.startAt)).toBe(6 * 3600_000);
  });

  test('free text without a model says so; validation; host only', async () => {
    const p = await plan(['Small Gallery']);
    const r = (await ask(p.id, { prompt: 'somewhere with outdoor seating' })).json();
    expect(r).toMatchObject({ via: 'code', sources: [] });
    expect(r.plan.ghostChanges).toEqual([]);
    expect((await ask(p.id, {})).statusCode).toBe(400);
    expect((await ask(p.id, { chip: 'cheaper', prompt: 'x' })).statusCode).toBe(400);
    const other = await devLogin(t.app, 'notasker');
    expect((await ask(p.id, { chip: 'cheaper' }, other.headers)).statusCode).toBe(403);
  });

  test('a skipped ghost becomes a planner memory', async () => {
    await t.app.inject({
      method: 'POST',
      url: '/v1/ghosts/skip',
      headers: u.headers,
      payload: { placeIds: [id['Steakhouse']] },
    });
    expect(
      await t.ctx.db.collection('ai_memories').findOne({ userId: u.id, source: 'ghost_skip' }),
    ).toMatchObject({
      text: expect.stringContaining('Steakhouse'),
    });
    // Backboard is off, so nothing is queued to sync.
    expect(await t.ctx.db.collection('jobs').countDocuments({ type: 'remember' })).toBe(0);
  });
});

describe('POST /plans/:id/ask through Backboard (stub server)', () => {
  let stub: FastifyInstance;
  const seen: { path: string; body: Record<string, unknown>; key?: string }[] = [];
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let u: Awaited<ReturnType<typeof devLogin>>;
  let id: Record<string, string>;
  let billing = false;

  beforeAll(async () => {
    stub = Fastify();
    stub.addHook('preHandler', async (req) => {
      seen.push({
        path: req.url,
        body: req.body as Record<string, unknown>,
        key: req.headers['x-api-key'] as string,
      });
    });
    stub.post('/assistants', async () => ({ assistant_id: 'asst_1', name: 'x' }));
    stub.post('/assistants/:id/memories', async () => ({ id: 'mem_1' }));
    stub.post('/threads/messages', async () =>
      billing
        ? {
            status: 'COMPLETED',
            thread_id: 'thr_2',
            content:
              "Your free credit is reserved for Memory & RAG, so it can't cover LLM chat. Add credits or start a subscription on the Billing page to continue.",
          }
        : {
            status: 'REQUIRES_ACTION',
            thread_id: 'thr_1',
            run_id: 'run_1',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'search_places',
                  arguments: '{"category":"food","tags":["cheap"]}',
                },
              },
            ],
          },
    );
    let round = 0;
    stub.post('/threads/:thread/runs/:run/submit-tool-outputs', async (req) => {
      const out = (req.body as { tool_outputs: { output: string }[] }).tool_outputs[0]!.output;
      if (round++ === 0) {
        // The model picks from what our search tool returned: proves outputs reach it.
        const found = JSON.parse(out) as { placeId: string; name: string }[];
        const pick = found.find((f) => f.name === 'Dollar Slice')!;
        return {
          status: 'REQUIRES_ACTION',
          thread_id: 'thr_1',
          run_id: 'run_1',
          tool_calls: [
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'add_stop',
                arguments: {
                  placeId: pick.placeId,
                  position: 2,
                  why: 'Cheap slice before the gallery',
                },
              },
            },
          ],
        };
      }
      return { status: 'COMPLETED', thread_id: 'thr_1', content: 'Added a cheap slice stop.' };
    });
    await stub.listen({ port: 0, host: '127.0.0.1' });
    const port = (stub.server.address() as { port: number }).port;
    t = await setupTestApp({
      BACKBOARD_API_KEY: 'bb_test',
      BACKBOARD_BASE_URL: `http://127.0.0.1:${port}`,
    });
    id = Object.fromEntries((await insertPlaces(t.ctx.db, fixtures())).map((d) => [d.name, d._id]));
    u = await devLogin(t.app, 'bbuser');
  });
  afterAll(async () => {
    await t.teardown();
    await stub.close();
  });

  test('tool calls run on our server; the diff comes back as ghost changes; assistant and thread are kept', async () => {
    const p = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: {
          startAt: tomorrowAt(t.ctx.clock.now(), 12),
          stops: [{ placeId: id['Riverside Park'] }, { placeId: id['Small Gallery'] }],
        },
      })
    ).json();
    const r = await t.app.inject({
      method: 'POST',
      url: `/v1/plans/${p.id}/ask`,
      headers: u.headers,
      payload: { prompt: 'something cheap to eat on the way' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({ via: 'backboard', message: 'Added a cheap slice stop.' });
    expect(body.plan.ghostChanges).toEqual([
      expect.objectContaining({
        kind: 'add_stop',
        toIndex: 2,
        label: 'Cheap slice before the gallery',
        stop: { placeId: id['Dollar Slice'] },
      }),
    ]);
    const msg = seen.find((s) => s.path === '/threads/messages')!;
    expect(msg.key).toBe('bb_test');
    expect(msg.body).toMatchObject({
      assistant_id: 'asst_1',
      memory: 'Auto',
      llm_provider: 'google',
    });
    expect(
      (msg.body.tools as { function: { name: string } }[]).map((x) => x.function.name),
    ).toContain('ask_maps');
    expect(
      (await t.ctx.db.collection('users').findOne({ _id: u.id as never }))?.backboardAssistantId,
    ).toBe('asst_1');
    expect((await t.ctx.db.collection('plans').findOne({ _id: p.id }))?.aiThreadId).toBe('thr_1');
  });

  test("Backboard's no-credit notice is not shown as the answer: the chip falls back to rules", async () => {
    billing = true;
    const p = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: {
          startAt: tomorrowAt(t.ctx.clock.now(), 17),
          stops: [{ placeId: id['Riverside Park'] }, { placeId: id['Small Gallery'] }],
        },
      })
    ).json();
    const r = await t.app.inject({
      method: 'POST',
      url: `/v1/plans/${p.id}/ask`,
      headers: u.headers,
      payload: { chip: 'add_dinner' },
    });
    billing = false;
    const body = r.json();
    expect(body.via).toBe('code');
    expect(body.message).not.toMatch(/credit/i);
    expect(body.plan.ghostChanges).toEqual([expect.objectContaining({ kind: 'add_stop' })]);
  });

  test('behaviour memories sync to the assistant through a job', async () => {
    await t.app.inject({
      method: 'POST',
      url: '/v1/ghosts/skip',
      headers: u.headers,
      payload: { placeIds: [id['Corner Cafe']] },
    });
    const job = await t.ctx.db.collection('jobs').findOne({ type: 'remember' });
    expect(job).toBeTruthy();
    await syncMemory(t.ctx, job!.payload as { memoryId: string });
    const call = seen.find((s) => s.path === '/assistants/asst_1/memories');
    expect(call?.body).toMatchObject({
      content: expect.stringContaining('Corner Cafe'),
      metadata: { source: 'ghost_skip' },
    });
    expect(
      await t.ctx.db.collection('ai_memories').findOne({ syncedAt: { $exists: true } }),
    ).toBeTruthy();
  });
});

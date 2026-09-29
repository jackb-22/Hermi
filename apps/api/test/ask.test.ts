import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { bestDay, nyLocal, nyLocalToUtc, scoreDay } from '../src/domain/weatherDay.ts';
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
    // Memories stay in Mongo; nothing is queued to an external memory service.
    expect(await t.ctx.db.collection('jobs').countDocuments({ type: 'remember' })).toBe(0);
  });
});

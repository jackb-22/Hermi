import { haversineM } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { EtaProvider } from '../src/providers/eta.ts';
import { chooseMode } from '../src/services/spacing.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

describe('chooseMode', () => {
  const e = (minutes: number) => ({ minutes, source: 'google' as const });
  test('walk up to 20 min, then transit only if it saves 5+', () => {
    expect(chooseMode('walk', { walk: e(20), transit: e(5) })).toBe('walk');
    expect(chooseMode('walk', { walk: e(21), transit: e(16) })).toBe('transit');
    expect(chooseMode('walk', { walk: e(21), transit: e(17) })).toBe('walk');
    expect(chooseMode('transit', { walk: e(8), transit: e(9) })).toBe('walk');
    expect(chooseMode('walk', { walk: e(30) })).toBe('walk');
  });
  test('bike and car plans keep their mode', () => {
    expect(chooseMode('bike', { bike: e(40) })).toBe('bike');
    expect(chooseMode('car', { car: e(3) })).toBe('car');
  });
});

describe('POST /plans/:id/ask {chip: space_stops}', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let u: Awaited<ReturnType<typeof devLogin>>;
  const id: Record<string, string> = {};
  const calls: string[] = [];
  let failTransit = false;

  beforeAll(async () => {
    t = await setupTestApp();
    const docs = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Cafe', category: 'food', at: ORIGIN }),
      placeDoc({ name: 'Gallery', category: 'culture', at: offset(ORIGIN, 900, 0) }),
      placeDoc({ name: 'Pier', category: 'nature', at: offset(ORIGIN, 3000, 0) }),
    ]);
    for (const d of docs) id[d.name] = d._id;
    // Walking is 80 m/min; transit is 8 min of overhead plus 400 m/min.
    const eta: EtaProvider = {
      name: 'stub',
      eta: async (o, d, mode) => {
        calls.push(mode);
        if (mode === 'transit' && failTransit) throw new Error('routes down');
        const m = haversineM(o, d);
        return {
          minutes: Math.round(mode === 'transit' ? 8 + m / 400 : m / 80),
          source: 'google',
        };
      },
    };
    t.ctx.providers.eta = eta;
    u = await devLogin(t.app, 'spacer');
  });
  afterAll(() => t.teardown());

  const tomorrow = () => new Date(t.ctx.clock.now().getTime() + 86_400_000);
  const plan = async (names: string[], stops: object[] = names.map((n) => ({ placeId: id[n] }))) =>
    (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: { startAt: tomorrow().toISOString(), stops },
      })
    ).json();
  const ask = (planId: string) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/plans/${planId}/ask`,
      headers: u.headers,
      payload: { chip: 'space_stops' },
    });
  const applyAll = async (planId: string) =>
    (
      await t.app.inject({
        method: 'POST',
        url: `/v1/plans/${planId}/changes/apply`,
        headers: u.headers,
        payload: {},
      })
    ).json();

  test('short leg walks, long leg takes transit; arrivals follow departures plus travel', async () => {
    const p = await plan(['Cafe', 'Gallery', 'Pier']);
    const r = await ask(p.id);
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.via).toBe('code');
    expect(body.message).toMatch(/^Spaced with travel times: Walk 11 min → Transit 13 min · ends /);
    expect(body.plan.ghostChanges).toEqual([
      expect.objectContaining({ kind: 'set_mode', mode: 'walk', legMin: 11, legSource: 'google' }),
      expect.objectContaining({
        kind: 'set_mode',
        mode: 'transit',
        legMin: 13,
        legSource: 'google',
      }),
    ]);
    expect(body.plan.ghostChanges[0]).not.toHaveProperty('legKey');
    expect(body.plan.ghostChanges[1].label).toBe('Transit 13 min to Pier');
    // Nothing applied until accepted.
    expect(body.plan.stops[2].legMode).toBe('walk');

    const after = await applyAll(p.id);
    expect(after.ghostChanges).toEqual([]);
    expect(
      after.stops.map((s: { legMode: string; legMin: number; legSource: string }) => [
        s.legMode,
        s.legMin,
        s.legSource,
      ]),
    ).toEqual([
      [null, null, null],
      ['walk', 11, 'google'],
      ['transit', 13, 'google'],
    ]);
    for (let i = 1; i < after.stops.length; i++) {
      const gap = Date.parse(after.stops[i].arriveAt) - Date.parse(after.stops[i - 1].departAt);
      expect(gap).toBe(after.stops[i].legMin * 60_000);
    }

    // Asking again changes nothing.
    const again = (await ask(p.id)).json();
    expect(again.plan.ghostChanges).toEqual([]);
    expect(again.message).toMatch(/^Already spaced right: Walk 11 min → Transit 13 min/);
  });

  test('stays the user set are kept', async () => {
    const p = await plan(
      [],
      [
        { placeId: id.Cafe, stayMin: 25 },
        { placeId: id.Gallery, stayMin: 70 },
      ],
    );
    await ask(p.id);
    const after = await applyAll(p.id);
    expect(after.stops.map((s: { stayMin: number }) => s.stayMin)).toEqual([25, 70]);
    expect(Date.parse(after.stops[1].arriveAt) - Date.parse(after.stops[0].arriveAt)).toBe(
      (25 + 11) * 60_000,
    );
  });

  test('a start that has passed moves to the next quarter hour', async () => {
    const p = await plan(['Cafe', 'Gallery']);
    const past = new Date(t.ctx.clock.now().getTime() - 3 * 3600_000);
    await t.ctx.db.collection('plans').updateOne({ _id: p.id }, { $set: { startAt: past } });
    const body = (await ask(p.id)).json();
    expect(body.plan.ghostChanges[0]).toMatchObject({ kind: 'set_start' });
    const after = await applyAll(p.id);
    const start = Date.parse(after.startAt);
    expect(start).toBeGreaterThanOrEqual(t.ctx.clock.now().getTime());
    expect(new Date(start).getUTCMinutes() % 15).toBe(0);
  });

  test('one stop: nothing to space', async () => {
    const p = await plan(['Cafe']);
    const body = (await ask(p.id)).json();
    expect(body.plan.ghostChanges).toEqual([]);
    expect(body.message).toMatch(/second stop/);
  });

  test('a failing ETA provider falls back to the estimate, labelled as such', async () => {
    failTransit = true;
    try {
      const p = await plan(['Gallery', 'Pier']);
      const body = (await ask(p.id)).json();
      expect(body.plan.ghostChanges).toHaveLength(1);
      const g = body.plan.ghostChanges[0];
      expect(g.legSource).toBe(g.mode === 'walk' ? 'google' : 'estimate');
    } finally {
      failTransit = false;
    }
  });

  test('a leg that changed before Apply keeps the mode but drops the measured minutes', async () => {
    const p = await plan(['Cafe', 'Gallery', 'Pier']);
    await ask(p.id);
    const mid = (await t.ctx.db.collection('plans').findOne({ _id: p.id }))!;
    // Gallery moves first, so Pier is now reached from the Cafe: not the leg that was measured.
    await t.ctx.db
      .collection('plans')
      .updateOne({ _id: p.id }, { $set: { stops: [mid.stops[1], mid.stops[0], mid.stops[2]] } });
    const after = await applyAll(p.id);
    const pier = after.stops.find((s: { place: { name: string } }) => s.place.name === 'Pier');
    expect(pier).toMatchObject({ legMode: 'transit', legSource: 'estimate' });
  });
});

describe('PUT /plans/:id/stops from a client that only sends places', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let u: Awaited<ReturnType<typeof devLogin>>;
  const id: Record<string, string> = {};
  beforeAll(async () => {
    t = await setupTestApp();
    for (const d of await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Cafe', category: 'food', at: ORIGIN }),
      placeDoc({ name: 'Gallery', category: 'culture', at: offset(ORIGIN, 900, 0) }),
      placeDoc({ name: 'Pier', category: 'nature', at: offset(ORIGIN, 3000, 0) }),
    ]))
      id[d.name] = d._id;
    t.ctx.providers.eta = {
      name: 'stub',
      eta: async (o, d, mode) => ({
        minutes: Math.round(
          mode === 'transit' ? 8 + haversineM(o, d) / 400 : haversineM(o, d) / 80,
        ),
        source: 'google',
      }),
    };
    u = await devLogin(t.app, 'placesonly');
  });
  afterAll(() => t.teardown());

  test('a stay edit keeps the measured legs and modes of unchanged stops', async () => {
    const p = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: {
          startAt: new Date(t.ctx.clock.now().getTime() + 86_400_000).toISOString(),
          stops: ['Cafe', 'Gallery', 'Pier'].map((n) => ({ placeId: id[n] })),
        },
      })
    ).json();
    await t.app.inject({
      method: 'POST',
      url: `/v1/plans/${p.id}/ask`,
      headers: u.headers,
      payload: { chip: 'space_stops' },
    });
    await t.app.inject({
      method: 'POST',
      url: `/v1/plans/${p.id}/changes/apply`,
      headers: u.headers,
      payload: {},
    });
    // The app re-sends places, stays and leg modes, never stop ids.
    const put = await t.app.inject({
      method: 'PUT',
      url: `/v1/plans/${p.id}/stops`,
      headers: u.headers,
      payload: {
        stops: [
          { placeId: id.Cafe, stayMin: 45 },
          { placeId: id.Gallery, stayMin: 60, legMode: 'walk' },
          { placeId: id.Pier, stayMin: 60, legMode: 'transit' },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    const legs = put
      .json()
      .stops.map((s: { legMode: string; legMin: number; legSource: string }) => [
        s.legMode,
        s.legMin,
        s.legSource,
      ]);
    expect(legs).toEqual([
      [null, null, null],
      ['walk', 11, 'google'],
      ['transit', 13, 'google'],
    ]);
    // Reordering changes the legs, so they fall back to estimates.
    const moved = (
      await t.app.inject({
        method: 'PUT',
        url: `/v1/plans/${p.id}/stops`,
        headers: u.headers,
        payload: { stops: [{ placeId: id.Pier }, { placeId: id.Cafe }, { placeId: id.Gallery }] },
      })
    ).json();
    expect(moved.stops[1].legSource).toBe('estimate');
    expect(moved.stops[2]).toMatchObject({ legMin: 11, legSource: 'google' });
  });
});

describe('AskResponse.preview', () => {
  test('is the plan after Apply, built the same way', async () => {
    const t = await setupTestApp();
    try {
      const docs = await insertPlaces(t.ctx.db, [
        placeDoc({ name: 'Cafe', category: 'food', at: ORIGIN }),
        placeDoc({ name: 'Pier', category: 'nature', at: offset(ORIGIN, 3000, 0) }),
      ]);
      t.ctx.providers.eta = {
        name: 'stub',
        eta: async (o, d, mode) => ({
          minutes: Math.round(
            mode === 'transit' ? 8 + haversineM(o, d) / 400 : haversineM(o, d) / 80,
          ),
          source: 'google',
        }),
      };
      const u = await devLogin(t.app, 'previewer');
      const p = (
        await t.app.inject({
          method: 'POST',
          url: '/v1/plans',
          headers: u.headers,
          payload: {
            startAt: new Date(t.ctx.clock.now().getTime() + 86_400_000).toISOString(),
            stops: docs.map((d) => ({ placeId: d._id })),
          },
        })
      ).json();
      const asked = (
        await t.app.inject({
          method: 'POST',
          url: `/v1/plans/${p.id}/ask`,
          headers: u.headers,
          payload: { chip: 'space_stops' },
        })
      ).json();
      expect(asked.preview.ghostChanges).toEqual([]);
      expect(asked.preview.stops[1]).toMatchObject({ legMode: 'transit', legMin: 16 });
      const applied = (
        await t.app.inject({
          method: 'POST',
          url: `/v1/plans/${p.id}/changes/apply`,
          headers: u.headers,
          payload: {},
        })
      ).json();
      const times = (x: { stops: { arriveAt: string; legMin: number }[] }) =>
        x.stops.map((s) => [s.arriveAt, s.legMin]);
      expect(times(asked.preview)).toEqual(times(applied));
      // Nothing to change: no preview.
      const again = (
        await t.app.inject({
          method: 'POST',
          url: `/v1/plans/${p.id}/ask`,
          headers: u.headers,
          payload: { chip: 'space_stops' },
        })
      ).json();
      expect(again.preview).toBeNull();
    } finally {
      await t.teardown();
    }
  });
});

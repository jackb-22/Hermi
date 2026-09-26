import { tilesAlongPath, XP } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { detectStays, segmentTrace, tilesFromSegments } from '../src/domain/movement.ts';
import { handlers } from '../src/jobs/handlers.ts';
import { enqueue, Worker } from '../src/jobs/queue.ts';
import { createCheckin } from '../src/services/checkins.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { walk } from './fixtures/trace.ts';
import { devLogin, setupTestApp } from './helpers.ts';

const asTrace = (pts: ReturnType<typeof walk>) =>
  pts.map((p) => ({ ...p, time: new Date(p.time) }));

describe('movement domain', () => {
  const start = new Date('2026-09-26T18:00:00Z');
  test('walking, cycling, driving and a subway gap are told apart', () => {
    const w = asTrace(walk([ORIGIN, offset(ORIGIN, 600, 0)], start, { kmh: 5 }));
    const b = asTrace(
      walk([offset(ORIGIN, 600, 0), offset(ORIGIN, 3000, 0)], w.at(-1)!.time, { kmh: 18 }),
    ).slice(1);
    const c = asTrace(
      walk([offset(ORIGIN, 3000, 0), offset(ORIGIN, 9000, 0)], b.at(-1)!.time, { kmh: 45 }),
    ).slice(1);
    const gapEnd = {
      ...offset(ORIGIN, 14000, 0),
      accuracy: 10,
      time: new Date(c.at(-1)!.time.getTime() + 10 * 60_000),
    };
    const segs = segmentTrace([...w, ...b, ...c, gapEnd]);
    expect(segs.map((s) => s.mode)).toEqual(['walk', 'bike', 'vehicle', 'subway']);
    const tiles = tilesFromSegments(segs);
    expect(tiles.length).toBe(
      tilesAlongPath([ORIGIN, offset(ORIGIN, 600, 0), offset(ORIGIN, 3000, 0)]).length,
    ); // car and subway never color
  });

  test('an 8-minute stay within 75 m is detected; a 5-minute one is not', () => {
    const t = asTrace(
      walk([ORIGIN, offset(ORIGIN, 400, 0), offset(ORIGIN, 800, 0)], start, { dwellMin: { 1: 9 } }),
    );
    expect(detectStays(t)).toHaveLength(1);
    const short = asTrace(
      walk([ORIGIN, offset(ORIGIN, 400, 0), offset(ORIGIN, 800, 0)], start, { dwellMin: { 1: 5 } }),
    );
    expect(detectStays(short)).toHaveLength(0);
  });
});

describe('session end and recap', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let host: Awaited<ReturnType<typeof devLogin>>;
  let friend: Awaited<ReturnType<typeof devLogin>>;
  let stops: string[];
  let worker: Worker;
  const at = [0, 400, 800, 1200].map((n) => offset(ORIGIN, n, 0));

  beforeAll(async () => {
    t = await setupTestApp();
    worker = new Worker(t.ctx, handlers, { info: () => {}, error: (o) => console.error(o) });
    const docs = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Bagels', category: 'food', at: at[0]! }),
      placeDoc({ name: 'Books', category: 'shopping', at: at[1]! }),
      placeDoc({ name: 'Garden', category: 'nature', at: at[2]! }),
      placeDoc({ name: 'Jazz', category: 'music', at: at[3]! }),
      placeDoc({ name: 'Stay Spot', category: 'food', at: offset(ORIGIN, 400, 900) }),
    ]);
    stops = docs.map((d) => d._id);
    host = await devLogin(t.app, 'hosty');
    friend = await devLogin(t.app, 'buddy');
  });
  afterAll(() => t.teardown());

  const upload = async (
    sessionId: string,
    pts: ReturnType<typeof walk>,
    headers: Record<string, string>,
  ) => {
    for (let i = 0; i < pts.length; i += 400) {
      await t.app.inject({
        method: 'POST',
        url: `/v1/sessions/${sessionId}/points`,
        headers,
        payload: { points: pts.slice(i, i + 400) },
      });
    }
  };

  test('four-stop plan: segments, tiles, XP breakdown, completed plan, idempotent re-run', async () => {
    const plan = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: host.headers,
        payload: { stops: stops.slice(0, 4).map((placeId) => ({ placeId })) },
      })
    ).json();
    const s = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: host.headers,
        payload: { planId: plan.id },
      })
    ).json().session;
    const startAt = new Date(Date.now() - 60 * 60_000);
    const pts = walk(at, startAt, { dwellMin: { 0: 6, 1: 6, 2: 6, 3: 6 } });
    await upload(s.id, pts, host.headers);
    // Tag check-ins during each dwell
    for (let i = 0; i < 4; i++) {
      const during = pts.find(
        (p) => Math.abs(p.lat - at[i]!.lat) < 1e-6 && Math.abs(p.lng - at[i]!.lng) < 1e-6,
      )!;
      await createCheckin(t.ctx, {
        userId: host.id,
        placeId: stops[i]!,
        tier: 'tag',
        at: at[i]!,
        accuracy: 10,
        time: new Date(during.time),
        attested: false,
        sessionId: s.id,
      });
    }
    const end = await t.app.inject({
      method: 'POST',
      url: `/v1/sessions/${s.id}/end`,
      headers: host.headers,
      payload: { steps: 2000 },
    });
    expect(end.json().session.status).toBe('ending');
    expect(
      (await t.app.inject({ url: `/v1/sessions/${s.id}/recap`, headers: host.headers })).json(),
    ).toEqual({ status: 'pending', recap: null });
    await worker.drain();

    const r = (
      await t.app.inject({ url: `/v1/sessions/${s.id}/recap`, headers: host.headers })
    ).json();
    expect(r.status).toBe('ready');
    const recap = r.recap;
    const expectedTiles = tilesAlongPath(at).length;
    expect(recap.newTiles).toHaveLength(expectedTiles);
    expect(recap.stops.map((x: { placeName: string }) => x.placeName)).toEqual([
      'Bagels',
      'Books',
      'Garden',
      'Jazz',
    ]);
    expect(recap.footKm).toBeCloseTo(1.2, 1);
    expect(recap.steps).toBe(2000);
    expect(recap.planCompleted).toBe(true);
    const xp = Object.fromEntries(
      recap.xp.items.map((i: { kind: string; xp: number }) => [i.kind, i.xp]),
    );
    expect(xp).toEqual({
      checkin_tag: 4 * XP.checkinTag,
      first_visit: 4 * XP.firstVisit,
      distance: Math.round(recap.footKm * XP.perKmOnFootOrBike),
      tiles: expectedTiles * XP.newTile,
      completed_plan: XP.completedPlan,
    });
    expect(recap.xp.total).toBe(Object.values(xp).reduce((a: number, b) => a + (b as number), 0));
    expect(
      (await t.app.inject({ url: `/v1/plans/${plan.id}`, headers: host.headers })).json().status,
    ).toBe('completed');

    // Re-running the finalize job never double-awards.
    await t.ctx.db
      .collection('sessions')
      .updateOne({ _id: s.id } as never, { $unset: { recap: '' } });
    await enqueue(t.ctx, 'finalize_session', { sessionId: s.id });
    await worker.drain();
    const { rows } = await t.ctx.tiger.query(
      'select sum(xp)::int as xp from xp_events where user_id = $1',
      [host.id],
    );
    expect(rows[0].xp).toBe(recap.xp.total);
    const { rows: segs } = await t.ctx.tiger.query(
      'select count(*)::int as n, sum(steps)::int as steps from movement_segments where session_id = $1',
      [s.id],
    );
    expect(segs[0].steps).toBe(2000);
  });

  test('head out: a detected stay becomes a GPS check-in at the nearest place', async () => {
    const s = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: friend.headers,
        payload: {},
      })
    ).json().session;
    const spot = offset(ORIGIN, 400, 890); // 10 m from Stay Spot
    await upload(
      s.id,
      walk(
        [offset(ORIGIN, 0, 900), spot, offset(ORIGIN, 900, 900)],
        new Date(Date.now() - 40 * 60_000),
        { dwellMin: { 1: 10 } },
      ),
      friend.headers,
    );
    await t.app.inject({
      method: 'POST',
      url: `/v1/sessions/${s.id}/end`,
      headers: friend.headers,
      payload: {},
    });
    await worker.drain();
    const recap = (
      await t.app.inject({ url: `/v1/sessions/${s.id}/recap`, headers: friend.headers })
    ).json().recap;
    expect(recap.stops).toEqual([
      expect.objectContaining({ placeName: 'Stay Spot', tier: 'gps', firstVisit: true }),
    ]);
  });

  test('full party and first plan with someone new', async () => {
    const plan = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: host.headers,
        payload: { stops: [{ placeId: stops[1]! }, { placeId: stops[2]! }] },
      })
    ).json();
    await t.ctx.db.collection('plans').updateOne({ _id: plan.id } as never, {
      $set: { members: [{ userId: friend.id, status: 'joined', at: new Date() }] },
    });
    const sh = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: host.headers,
        payload: { planId: plan.id },
      })
    ).json().session;
    const sf = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: friend.headers,
        payload: { planId: plan.id },
      })
    ).json().session;
    const later = new Date(Date.now() + 7 * 3600_000); // past the 6 h cooldown from the first test
    t.ctx.clock.offsetMs = 7 * 3600_000;
    for (const [u, s] of [
      [host, sh],
      [friend, sf],
    ] as const) {
      await createCheckin(t.ctx, {
        userId: u.id,
        placeId: stops[1]!,
        tier: 'tag',
        at: at[1]!,
        accuracy: 10,
        time: later,
        attested: false,
        sessionId: s.id,
      });
      await createCheckin(t.ctx, {
        userId: u.id,
        placeId: stops[2]!,
        tier: 'tag',
        at: at[2]!,
        accuracy: 10,
        time: new Date(later.getTime() + 60 * 60_000),
        attested: false,
        sessionId: s.id,
      });
    }
    await t.app.inject({
      method: 'POST',
      url: `/v1/sessions/${sh.id}/end`,
      headers: host.headers,
      payload: {},
    });
    await worker.drain();
    t.ctx.clock.offsetMs = 0;
    const recap = (
      await t.app.inject({ url: `/v1/sessions/${sh.id}/recap`, headers: host.headers })
    ).json().recap;
    const kinds = recap.xp.items.map((i: { kind: string }) => i.kind);
    expect(recap.fullParty).toBe(true);
    expect(kinds).toEqual(expect.arrayContaining(['full_party', 'new_person', 'completed_plan']));
  });
});

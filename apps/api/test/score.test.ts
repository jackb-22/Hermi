import { latLngToTile } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { boroughOf } from '../src/services/boroughs.ts';
import { insertPlaces, ORIGIN, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

const DAY = 86_400_000;

describe('boroughs', () => {
  test('tiles resolve to the right borough; the Hudson is no borough', () => {
    expect(boroughOf(latLngToTile({ lat: 40.758, lng: -73.9855 }))).toBe('Manhattan'); // Times Square
    expect(boroughOf(latLngToTile({ lat: 40.6782, lng: -73.9442 }))).toBe('Brooklyn');
    expect(boroughOf(latLngToTile({ lat: 40.7282, lng: -73.7949 }))).toBe('Queens');
    expect(boroughOf(latLngToTile({ lat: 40.77, lng: -74.0 }))).toBeNull(); // Hudson River
  });
});

describe('score, ranks, tiles, stats', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let me: Awaited<ReturnType<typeof devLogin>>;
  let f1: Awaited<ReturnType<typeof devLogin>>;
  let f2: Awaited<ReturnType<typeof devLogin>>;
  let c1: Awaited<ReturnType<typeof devLogin>>;

  beforeAll(async () => {
    t = await setupTestApp();
    me = await devLogin(t.app, 'scorer');
    f1 = await devLogin(t.app, 'friendone');
    f2 = await devLogin(t.app, 'friendtwo');
    c1 = await devLogin(t.app, 'classmate');
    await t.ctx.db
      .collection('users')
      .updateMany({}, { $set: { campus: 'Columbia', verifiedAt: new Date() } });
    for (const f of [f1, f2]) {
      const [a, b] = [me.id, f.id].sort();
      await t.ctx.db.collection('friendships').insertOne({
        _id: `${a}:${b}`,
        a,
        b,
        since: new Date(),
        hangouts: f === f1 ? 9 : 2,
        streakWeeks: 3,
        lastHangoutWeek: 0,
      } as never);
    }
    const now = Date.now();
    const xp = async (u: string, daysAgo: number, n: number) =>
      t.ctx.tiger.query(
        `insert into xp_events (time, user_id, campus, kind, xp) values ($1, $2, 'Columbia', 'checkin_tag', $3)`,
        [new Date(now - daysAgo * DAY), u, n],
      );
    await xp(me.id, 0, 30);
    await xp(me.id, 10, 20);
    await xp(me.id, 27, 40);
    await xp(me.id, 35, 100); // outside the window
    await xp(f1.id, 0, 200);
    await xp(f2.id, 1, 50);
    await xp(c1.id, 2, 500);
    await t.ctx.tiger.query(`call refresh_continuous_aggregate('xp_daily', null, null)`);

    const [p] = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Cafe', category: 'food', at: ORIGIN }),
    ]);
    await t.ctx.tiger.query(
      `insert into checkins (time, id, user_id, place_id, tier) values (now(), 'a', $1, $2, 'tag'), (now() - interval '2 days', 'b', $1, $2, 'gps')`,
      [me.id, p!._id],
    );
    await t.ctx.tiger.query(
      `insert into movement_segments (time, end_time, user_id, session_id, mode, meters, steps) values (now(), now(), $1, 's', 'walk', 2500, 3200), (now(), now(), $1, 's', 'vehicle', 9000, 0)`,
      [me.id],
    );
    await t.ctx.db.collection('sessions').insertOne({
      _id: 's1',
      userId: me.id,
      status: 'ended',
      startedAt: new Date(now - 2 * 3600_000),
      endedAt: new Date(now),
    } as never);
    const ts = latLngToTile({ lat: 40.758, lng: -73.9855 });
    await t.ctx.db
      .collection('user_tiles')
      .insertMany(
        [0, 1, 2, 3].map((i) => ({ userId: me.id, x: ts.x + i, y: ts.y, firstAt: new Date() })),
      );
  });
  afterAll(() => t.teardown());

  test('score is the 30-day sum; delta vs 7 days ago; sparkline and expiring', async () => {
    const r = (await t.app.inject({ url: '/v1/score', headers: me.headers })).json();
    expect(r.score).toBe(90);
    expect(r.delta7d).toBe(90 - 160);
    expect(r.sparkline).toHaveLength(30);
    expect(r.sparkline.at(-1).xp).toBe(30);
    expect(r.expiring.xp).toBe(40);
    expect(r.ranks).toEqual({
      friends: { rank: 2, of: 3 },
      campus: { rank: 3, of: 4, campus: 'Columbia' },
    });
  });

  test('leaderboards: friends and campus', async () => {
    const fr = (
      await t.app.inject({
        url: '/v1/leaderboard',
        query: { scope: 'friends' },
        headers: me.headers,
      })
    ).json();
    expect(
      fr.items.map((i: { user: { username: string }; score: number }) => [
        i.user.username,
        i.score,
      ]),
    ).toEqual([
      ['friendone', 200],
      ['scorer', 90],
      ['friendtwo', 50],
    ]);
    expect(fr.me).toEqual({ rank: 2, score: 90 });
    const campus = (
      await t.app.inject({
        url: '/v1/leaderboard',
        query: { scope: 'campus' },
        headers: me.headers,
      })
    ).json();
    expect(campus.items[0]).toMatchObject({ rank: 1, user: { username: 'classmate' }, score: 500 });
    expect(campus.me).toEqual({ rank: 3, score: 90 });
  });

  test('tiles: mine, a friend’s view of mine, never a stranger’s', async () => {
    const mine = (await t.app.inject({ url: '/v1/tiles', headers: me.headers })).json();
    expect(mine).toMatchObject({ count: 4, zoom: 18 });
    expect(mine.manhattanPct).toBeCloseTo((100 * 4) / 4330, 1);
    expect(mine.boroughs.find((b: { name: string }) => b.name === 'Manhattan').colored).toBe(4);
    expect(
      (
        await t.app.inject({ url: '/v1/tiles', query: { userId: me.id }, headers: f1.headers })
      ).json().count,
    ).toBe(4);
    expect(
      (await t.app.inject({ url: '/v1/tiles', query: { userId: me.id }, headers: c1.headers }))
        .statusCode,
    ).toBe(404);
  });

  test('stats sheet', async () => {
    const s = (await t.app.inject({ url: '/v1/stats', headers: me.headers })).json();
    expect(s.topPlaces).toEqual([expect.objectContaining({ name: 'Cafe', visits: 2 })]);
    expect(
      s.peopleMost.map((p: { user: { username: string }; hangouts: number }) => [
        p.user.username,
        p.hangouts,
      ]),
    ).toEqual([
      ['friendone', 9],
      ['friendtwo', 2],
    ]);
    expect(s.onFoot).toMatchObject({ allTimeKm: 2.5, allTimeSteps: 3200 }); // the vehicle segment never counts
    expect(s.hoursOut.allTime).toBe(2);
  });
});

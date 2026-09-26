import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
let cafeNear: string;
let bar: string;

beforeAll(async () => {
  t = await setupTestApp();
  const docs = [
    placeDoc({
      name: 'Cafe Near',
      category: 'food',
      tags: ['coffee'],
      at: offset(ORIGIN, 50, 0),
      been: 3,
    }),
    placeDoc({
      name: 'Bakery Near',
      category: 'food',
      tags: ['bakery'],
      at: offset(ORIGIN, -60, 20),
    }),
    ...[1, 2, 3, 4, 5].map((i) =>
      placeDoc({
        name: `Diner ${i}`,
        category: 'food',
        tags: ['brunch'],
        at: offset(ORIGIN, 500 + i * 20, 0),
      }),
    ),
    placeDoc({ name: 'Far Pizza', category: 'food', tags: ['pizza'], at: offset(ORIGIN, 3000, 0) }),
    placeDoc({
      name: 'The Bar',
      category: 'drinks',
      tags: ['cocktails'],
      at: offset(ORIGIN, 80, 0),
      adultOnly: true,
    }),
    placeDoc({ name: 'Boba', category: 'drinks', tags: ['cheap'], at: offset(ORIGIN, 90, 0) }),
    placeDoc({ name: 'Park', category: 'nature', tags: ['park'], at: offset(ORIGIN, 100, 100) }),
  ];
  await insertPlaces(t.ctx.db, docs);
  cafeNear = docs[0]!._id;
  bar = docs[8]!._id;
});
afterAll(() => t.teardown());

describe('GET /places/near', () => {
  test('widens radius until at least 5 results, never past the walk cap', async () => {
    const r = await t.app.inject({
      url: '/v1/places/near',
      query: { lat: String(ORIGIN.lat), lng: String(ORIGIN.lng), cat: 'food', r: '100' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.items.length).toBeGreaterThanOrEqual(5);
    expect(body.radiusM).toBeGreaterThan(100);
    expect(body.radiusM).toBeLessThanOrEqual(1200);
    expect(body.items.map((p: { name: string }) => p.name)).not.toContain('Far Pizza');
    expect(body.items[0]).toMatchObject({
      category: 'food',
      walkMin: expect.any(Number),
      distanceM: expect.any(Number),
    });
  });

  test('bars hidden unless the user confirmed 21+', async () => {
    const q = { lat: String(ORIGIN.lat), lng: String(ORIGIN.lng), cat: 'drinks', r: '300' };
    const anon = await t.app.inject({ url: '/v1/places/near', query: q });
    expect(anon.json().items.map((p: { name: string }) => p.name)).toEqual(['Boba']);
    const u = await devLogin(t.app, 'adult');
    await t.ctx.db.collection('users').updateOne({ _id: u.id } as never, { $set: { is21: true } });
    const adult = await t.app.inject({ url: '/v1/places/near', query: q, headers: u.headers });
    expect(
      adult
        .json()
        .items.map((p: { name: string }) => p.name)
        .sort(),
    ).toEqual(['Boba', 'The Bar']);
  });
});

describe('GET /places (bbox)', () => {
  test('top-N per category inside the box', async () => {
    const sw = offset(ORIGIN, -1000, -1000);
    const ne = offset(ORIGIN, 1000, 1000);
    const r = await t.app.inject({
      url: '/v1/places',
      query: { bbox: `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`, limit: '2' },
    });
    expect(r.statusCode).toBe(200);
    const items = r.json().items as { category: string; name: string }[];
    expect(items.filter((p) => p.category === 'food')).toHaveLength(2);
    expect(items.find((p) => p.name === 'Cafe Near')).toBeTruthy(); // most visited ranks first
    expect(items.find((p) => p.name === 'Far Pizza')).toBeUndefined();
  });

  test('rejects an inverted bbox', async () => {
    const r = await t.app.inject({ url: '/v1/places', query: { bbox: '1,1,0,0' } });
    expect(r.json().error.code).toBe('BAD_REQUEST');
  });
});

describe('GET /places/:id', () => {
  test('counts line: here now, friends have been, going', async () => {
    const me = await devLogin(t.app, 'myself');
    const friend = await devLogin(t.app, 'friend');
    const [a, b] = [me.id, friend.id].sort() as [string, string];
    await t.ctx.db.collection('friendships').insertOne({
      _id: `${a}:${b}`,
      a,
      b,
      since: new Date(),
      hangouts: 1,
      streakWeeks: 1,
      lastHangoutWeek: 0,
    } as never);
    await t.ctx.tiger.query(
      `insert into checkins (time, id, user_id, place_id, tier) values (now() - interval '10 minutes', 'c1', $1, $2, 'tag'), (now() - interval '3 hours', 'c2', 'stranger', $2, 'gps')`,
      [friend.id, cafeNear],
    );
    await t.ctx.db.collection('plans').insertOne({
      _id: 'plan1',
      hostId: 'host1',
      startAt: new Date(Date.now() + 86_400_000),
      stops: [{ placeId: cafeNear }],
      members: [
        { userId: 'm1', status: 'joined' },
        { userId: 'm2', status: 'invited' },
      ],
      status: 'planned',
    } as never);
    const r = await t.app.inject({ url: `/v1/places/${cafeNear}`, headers: me.headers });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      name: 'Cafe Near',
      hereNow: 1,
      friendsBeen: 1,
      going: 2,
      been: 3,
    });
  });

  test('404 envelope', async () => {
    const r = await t.app.inject('/v1/places/nope');
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('NOT_FOUND');
    void bar;
  });
});

import { latLngToTile, tileKey } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { novelty, timeFit, transition } from '../src/domain/ghosts.ts';
import { sunTimes } from '../src/domain/sun.ts';
import { mergeRerank } from '../src/providers/llm.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

// Sat 10 Apr 2027, 6:15 PM EDT: past any fake forecast (so no rain), 75 minutes before sunset.
const AT = '2027-04-10T22:15:00Z';

describe('ghost scoring tables', () => {
  const sunset = sunTimes(new Date(AT), ORIGIN).sunset;
  test('sunset for Manhattan is about 7:30 PM EDT', () => {
    expect(Math.abs(sunset.getTime() - Date.parse('2027-04-10T23:30:00Z'))).toBeLessThan(
      5 * 60_000,
    );
  });
  test('coffee mornings, drinks after 6, nature before sunset', () => {
    const morning = new Date('2027-04-10T13:00:00Z'); // 9 AM
    const evening = new Date('2027-04-10T23:30:00Z'); // 7:30 PM
    expect(timeFit('food', ['coffee'], morning, sunset)).toBeGreaterThan(
      timeFit('food', ['coffee'], evening, sunset),
    );
    expect(timeFit('drinks', [], evening, sunset)).toBeGreaterThan(
      timeFit('drinks', [], morning, sunset),
    );
    expect(timeFit('nature', ['park'], new Date(AT), sunset)).toBeGreaterThan(1);
    expect(timeFit('nature', ['park'], evening, sunset)).toBeLessThan(0.2);
    expect(timeFit('nature', [], new Date(AT), sunset, true)).toBeLessThan(
      timeFit('nature', [], new Date(AT), sunset, false),
    );
  });
  test('P(c | prev): prior, then learned from completed plans', () => {
    expect(transition(undefined, 'food')).toBe(1);
    expect(transition('drinks', 'music')).toBeGreaterThan(transition('drinks', 'culture'));
    const learned = transition('drinks', 'culture', { drinks: { culture: 100 } });
    expect(learned).toBeGreaterThan(transition('drinks', 'music', { drinks: { culture: 100 } }));
  });
  test('novelty is the share of never-colored tiles around the venue', () => {
    const t = latLngToTile(ORIGIN);
    expect(novelty(t, new Set())).toBe(1);
    expect(novelty(t, new Set([tileKey(t)]))).toBeCloseTo(8 / 9);
  });
  test('model output is checked: unknown ids dropped, missing kept, labels trimmed', () => {
    const c = (id: string) => ({
      id,
      name: id,
      category: 'food' as const,
      tags: [],
      walkMin: 3,
      fallbackLabel: `fb ${id}`,
    });
    expect(
      mergeRerank(
        [c('a'), c('b'), c('c')],
        [
          { id: 'c', label: 'one two three four five six seven' },
          { id: 'zzz', label: 'invented' },
          { id: 'c', label: 'dup' },
          { id: 'a', label: '' },
        ],
      ),
    ).toEqual([
      { id: 'c', label: 'one two three four five six' },
      { id: 'a', label: 'fb a' },
      { id: 'b', label: 'fb b' },
    ]);
  });
});

let t: Awaited<ReturnType<typeof setupTestApp>>;
let u: Awaited<ReturnType<typeof devLogin>>;
let ids: Record<string, string>;

beforeAll(async () => {
  t = await setupTestApp();
  const docs = await insertPlaces(t.ctx.db, [
    placeDoc({ name: 'Start Diner', category: 'food', tags: ['brunch'], at: ORIGIN }),
    placeDoc({
      name: 'Pizza Place',
      category: 'food',
      tags: ['pizza'],
      at: offset(ORIGIN, 300, 0),
    }),
    placeDoc({
      name: 'Near Museum',
      category: 'culture',
      tags: ['museum'],
      at: offset(ORIGIN, 400, 0),
    }),
    placeDoc({
      name: 'River Park',
      category: 'nature',
      tags: ['park', 'waterfront'],
      at: offset(ORIGIN, 0, -500),
    }),
    placeDoc({
      name: 'Cocktail Bar',
      category: 'drinks',
      tags: ['cocktails'],
      at: offset(ORIGIN, 200, 0),
      adultOnly: true,
    }),
    placeDoc({
      name: 'Far Museum',
      category: 'culture',
      tags: ['museum'],
      at: offset(ORIGIN, 2000, 0),
    }),
    placeDoc({
      name: 'Book Nook',
      category: 'shopping',
      tags: ['bookstore'],
      at: offset(ORIGIN, -300, 0),
    }),
    placeDoc({ name: 'Gym', category: 'sports', tags: ['climbing'], at: offset(ORIGIN, -400, 0) }),
  ]);
  ids = Object.fromEntries(docs.map((d) => [d.name, d._id]));
  u = await devLogin(t.app, 'ghoster');
});
afterAll(() => t.teardown());

const get = (url: string) => t.app.inject({ method: 'GET', url, headers: u.headers });

describe('GET /ghosts', () => {
  test('after a food pin at 6:15 PM: sunset park first, within a 15-minute walk, no drinks under 21', async () => {
    const r = await get(`/v1/ghosts?after=${ids['Start Diner']}&at=${AT}`);
    expect(r.statusCode).toBe(200);
    const g = r.json();
    expect(g).toMatchObject({
      rankedBy: 'code',
      fadeAfterSec: 10,
      anchor: { placeId: ids['Start Diner'] },
    });
    expect(g.items.length).toBe(3);
    expect(g.items[0]).toMatchObject({ category: 'nature', label: 'Sunset at River Park' });
    expect(g.items[0].walkMin).toBe(6);
    const names = g.items.map((i: { place: { name: string } }) => i.place.name);
    expect(names).not.toContain('Far Museum');
    expect(names).not.toContain('Cocktail Bar');
    expect(names).not.toContain('Start Diner');
    for (const i of g.items) {
      expect(i.distanceM).toBeLessThanOrEqual(1200);
      expect(i.score).toBeCloseTo(
        i.factors.pref * i.factors.time * i.factors.transition * (1 + i.factors.novelty),
        2,
      );
      expect(i.label.split(' ').length).toBeLessThanOrEqual(6);
    }
    // Scores are non-increasing: code's order is kept by the fake model.
    expect(g.items[0].score).toBeGreaterThanOrEqual(g.items[1].score);
  });

  test('novelty: colored tiles around a venue lower its factor', async () => {
    const park = offset(ORIGIN, 0, -500);
    const tile = latLngToTile(park);
    await t.ctx.db.collection('user_tiles').insertMany(
      [-1, 0, 1].flatMap((dx) =>
        [-1, 0, 1].map((dy) => ({
          userId: u.id,
          x: tile.x + dx,
          y: tile.y + dy,
          at: new Date(),
        })),
      ),
    );
    const g = (await get(`/v1/ghosts?after=${ids['Start Diner']}&at=${AT}`)).json();
    const p = g.items.find((i: { place: { name: string } }) => i.place.name === 'River Park');
    expect(p?.factors.novelty ?? 0).toBe(0);
    await t.ctx.db.collection('user_tiles').deleteMany({ userId: u.id });
  });

  test('dislikes are hard filters; exclude hides pinned places; lat/lng without a pin works', async () => {
    await t.ctx.db
      .collection('users')
      .updateOne(
        { _id: u.id as never },
        { $set: { dislikes: { categories: ['nature'], tags: [] } } },
      );
    const g = (
      await get(
        `/v1/ghosts?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&at=${AT}&exclude=${ids['Near Museum']}`,
      )
    ).json();
    const names = g.items.map((i: { place: { name: string } }) => i.place.name);
    expect(names).not.toContain('River Park');
    expect(names).not.toContain('Near Museum');
    expect(g.anchor.placeId).toBeNull();
    await t.ctx.db
      .collection('users')
      .updateOne({ _id: u.id as never }, { $unset: { dislikes: '' } });
  });

  test('bad queries', async () => {
    expect((await get('/v1/ghosts')).statusCode).toBe(400);
    expect((await get('/v1/ghosts?after=nope')).statusCode).toBe(404);
  });
});

describe('plan ghosts', () => {
  test('follow the chosen stop, skip plan places, and accept inserts after it', async () => {
    const plan = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: {
          startAt: '2027-04-10T21:00:00Z',
          stops: [{ placeId: ids['Start Diner'] }, { placeId: ids['Book Nook'] }],
        },
      })
    ).json();
    const [first, second] = plan.stops;
    const g = (await get(`/v1/plans/${plan.id}/ghosts?afterStopId=${first.id}`)).json();
    expect(g.anchor).toMatchObject({ stopId: first.id, placeId: ids['Start Diner'] });
    expect(g.at).toBe(first.departAt);
    const names = g.items.map((i: { place: { name: string } }) => i.place.name);
    expect(names).not.toContain('Book Nook');

    const pick = g.items[0].place.id;
    const r = await t.app.inject({
      method: 'POST',
      url: `/v1/plans/${plan.id}/ghosts/accept`,
      headers: u.headers,
      payload: { placeId: pick, afterStopId: first.id },
    });
    expect(r.statusCode).toBe(200);
    const after = r.json();
    expect(after.stops.map((s: { id: string; place: { id: string } }) => s.place.id)).toEqual([
      ids['Start Diner'],
      pick,
      ids['Book Nook'],
    ]);
    expect(after.stops[2].id).toBe(second.id);
    expect(
      await t.ctx.db
        .collection('behavior_events')
        .countDocuments({ userId: u.id, kind: 'ghost_accepted' }),
    ).toBe(1);

    const other = await devLogin(t.app, 'notthehost');
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/v1/plans/${plan.id}/ghosts`,
          headers: other.headers,
        })
      ).statusCode,
    ).toBe(403);
  });

  test('an empty plan needs an anchor; skip is recorded', async () => {
    const plan = (
      await t.app.inject({ method: 'POST', url: '/v1/plans', headers: u.headers, payload: {} })
    ).json();
    expect((await get(`/v1/plans/${plan.id}/ghosts`)).statusCode).toBe(400);
    expect(
      (await get(`/v1/plans/${plan.id}/ghosts?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`)).statusCode,
    ).toBe(200);
    const s = await t.app.inject({
      method: 'POST',
      url: '/v1/ghosts/skip',
      headers: u.headers,
      payload: { placeIds: [ids['Gym']], planId: plan.id },
    });
    expect(s.statusCode).toBe(200);
    expect(
      await t.ctx.db
        .collection('behavior_events')
        .findOne({ userId: u.id, kind: 'ghost_skipped', placeId: ids['Gym'] }),
    ).toMatchObject({ category: 'sports' });
  });
});

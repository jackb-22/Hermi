import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
let host: Awaited<ReturnType<typeof devLogin>>;
let other: Awaited<ReturnType<typeof devLogin>>;
let cafe: string;
let museum: string;
let park: string;

beforeAll(async () => {
  t = await setupTestApp();
  const [c, m, p] = await insertPlaces(t.ctx.db, [
    placeDoc({ name: 'Cafe', category: 'food', tags: ['coffee'], at: ORIGIN }),
    placeDoc({ name: 'Museum', category: 'culture', tags: ['museum'], at: offset(ORIGIN, 800, 0) }),
    placeDoc({ name: 'Park', category: 'nature', tags: ['park'], at: offset(ORIGIN, 1600, 0) }),
  ]);
  [cafe, museum, park] = [c!._id, m!._id, p!._id];
  host = await devLogin(t.app, 'host');
  other = await devLogin(t.app, 'other');
});
afterAll(() => t.teardown());

const create = (payload: object) =>
  t.app.inject({ method: 'POST', url: '/v1/plans', headers: host.headers, payload });

describe('plans', () => {
  test('create schedules immediately: defaults, legs, totals, slot label', async () => {
    const r = await create({
      startAt: '2026-10-03T15:00:00Z',
      stops: [
        { placeId: cafe },
        { placeId: museum },
        { slot: { category: 'food', near: offset(ORIGIN, 1600, 100) } },
      ],
    });
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p).toMatchObject({
      status: 'draft',
      visibility: 'just_me',
      isHost: true,
      name: 'Cafe + 2 more',
    });
    expect(
      p.stops.map((s: { index: number; label: string; stayMin: number }) => [
        s.index,
        s.label,
        s.stayMin,
      ]),
    ).toEqual([
      [1, 'Cafe', 60],
      [2, 'Museum', 90],
      [3, 'Pick a food spot', 60],
    ]);
    expect(p.stops[0]).toMatchObject({
      legMode: null,
      arriveAt: '2026-10-03T15:00:00.000Z',
      departAt: '2026-10-03T16:00:00.000Z',
    });
    expect(p.stops[1].legMin).toBe(13);
    expect(p.stops[1].arriveAt).toBe('2026-10-03T16:13:00.000Z');
    expect(p.issues).toEqual([
      expect.objectContaining({ code: 'UNFILLED_SLOT', stopId: p.stops[2].id }),
    ]);
    expect(p.totals.xpPreview).toBeGreaterThan(50);
    expect(p.shareUrl).toMatch(/\/p\//);
  });

  test('reorder keeps stop ids and user stay; mode change resets legs', async () => {
    const p = (
      await create({
        stops: [{ placeId: cafe }, { placeId: museum, stayMin: 30 }, { placeId: park }],
      })
    ).json();
    const [a, b, c] = p.stops;
    const reordered = await t.app.inject({
      method: 'PUT',
      url: `/v1/plans/${p.id}/stops`,
      headers: host.headers,
      payload: {
        stops: [
          { id: a.id, placeId: cafe },
          { id: c.id, placeId: park },
          { id: b.id, placeId: museum },
        ],
      },
    });
    const r = reordered.json();
    expect(r.stops.map((s: { id: string }) => s.id)).toEqual([a.id, c.id, b.id]);
    expect(r.stops[2]).toMatchObject({ stayMin: 30, staySource: 'user' });
    expect(r.stops[1].legMin).toBe(26); // cafe -> park is twice as far now

    const car = await t.app.inject({
      method: 'PATCH',
      url: `/v1/plans/${p.id}`,
      headers: host.headers,
      payload: { mode: 'car', name: 'Saturday' },
    });
    expect(car.json()).toMatchObject({ mode: 'car', name: 'Saturday' });
    expect(
      car
        .json()
        .stops.slice(1)
        .every((s: { legMode: string }) => s.legMode === 'car'),
    ).toBe(true);
  });

  test('only the host edits; private plans are invisible to others', async () => {
    const p = (await create({ stops: [{ placeId: cafe }] })).json();
    const edit = await t.app.inject({
      method: 'PATCH',
      url: `/v1/plans/${p.id}`,
      headers: other.headers,
      payload: { name: 'mine' },
    });
    expect(edit.statusCode).toBe(403);
    const read = await t.app.inject({ url: `/v1/plans/${p.id}`, headers: other.headers });
    expect(read.statusCode).toBe(404);
  });

  test('unknown place rejected; delete cancels; list shows drafts', async () => {
    const bad = await create({ stops: [{ placeId: 'nope' }] });
    expect(bad.statusCode).toBe(400);
    const p = (await create({ stops: [{ placeId: park }] })).json();
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/v1/plans/${p.id}`,
      headers: host.headers,
    });
    expect(del.json()).toEqual({ ok: true });
    const gone = await t.app.inject({ url: `/v1/plans/${p.id}`, headers: host.headers });
    expect(gone.statusCode).toBe(404);
    const list = await t.app.inject({
      url: '/v1/plans',
      query: { scope: 'drafts' },
      headers: host.headers,
    });
    expect(list.json().items.length).toBeGreaterThanOrEqual(3);
    expect(list.json().items.find((x: { id: string }) => x.id === p.id)).toBeUndefined();
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { checkinWithMedia } from './fixtures/media.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
let me: Awaited<ReturnType<typeof devLogin>>;
let pal: Awaited<ReturnType<typeof devLogin>>;
let other: Awaited<ReturnType<typeof devLogin>>;
let ids: string[];

beforeAll(async () => {
  t = await setupTestApp();
  const docs = await insertPlaces(t.ctx.db, [
    placeDoc({ name: 'Film Forum', category: 'culture', at: ORIGIN }),
    placeDoc({ name: 'Bakery', category: 'food', at: offset(ORIGIN, 300, 0) }),
    placeDoc({ name: 'Park', category: 'nature', at: offset(ORIGIN, 600, 0) }),
    placeDoc({ name: 'Far Away', category: 'food', at: offset(ORIGIN, 9000, 0) }),
  ]);
  ids = docs.map((d) => d._id);
  me = await devLogin(t.app, 'profiler');
  pal = await devLogin(t.app, 'palpal');
  other = await devLogin(t.app, 'stranger');
  const [a, b] = [me.id, pal.id].sort();
  await t.ctx.db.collection('friendships').insertOne({
    _id: `${a}:${b}`,
    a,
    b,
    since: new Date(),
    hangouts: 5,
    streakWeeks: 4,
    lastHangoutWeek: 99999,
    lastHangoutDay: 'x',
  } as never);
  await checkinWithMedia(t.ctx, pal.id, ids[0]!, ORIGIN, []);
});
afterAll(() => t.teardown());

describe('profile and friends', () => {
  test('friend profile: streak, last check-in, counts; ghost mode hides the check-in; blocked is 404', async () => {
    const p = (await t.app.inject({ url: `/v1/profile/${pal.id}`, headers: me.headers })).json();
    expect(p).toMatchObject({
      isMe: false,
      isFriend: true,
      friendCount: 1,
      streak: { hangouts: 5 },
      lastCheckin: { placeName: 'Film Forum' },
      counts: { placesVisited: 1 },
    });
    expect(p.score).toMatchObject({ userId: pal.id, sparkline: expect.any(Array) });
    await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: pal.headers,
      payload: { ghostMode: true },
    });
    expect(
      (await t.app.inject({ url: `/v1/profile/${pal.id}`, headers: me.headers })).json()
        .lastCheckin,
    ).toBeNull();
    expect(
      (await t.app.inject({ url: '/v1/profile/me', headers: pal.headers })).json(),
    ).toMatchObject({ isMe: true, lastCheckin: { placeName: 'Film Forum' } });
    const friends = (await t.app.inject({ url: '/v1/friends', headers: me.headers })).json();
    expect(friends.items).toEqual([
      expect.objectContaining({
        user: expect.objectContaining({ username: 'palpal' }),
        lastCheckin: null,
      }),
    ]);
    await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: pal.headers,
      payload: { ghostMode: false },
    });
    await t.app.inject({
      method: 'POST',
      url: '/v1/blocks',
      headers: other.headers,
      payload: { userId: me.id },
    });
    expect(
      (await t.app.inject({ url: `/v1/profile/${me.id}`, headers: other.headers })).statusCode,
    ).toBe(404);
  });
});

describe('saves and folders', () => {
  test('save place into a folder; list; unsave removes it everywhere', async () => {
    const folder = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/folders',
        headers: me.headers,
        payload: { name: 'Date ideas' },
      })
    ).json();
    const s = await t.app.inject({
      method: 'POST',
      url: '/v1/saves',
      headers: me.headers,
      payload: { type: 'place', refId: ids[1], folderId: folder.id },
    });
    expect(s.json()).toMatchObject({
      saved: { type: 'place', place: { name: 'Bakery' } },
      copiedPlanId: null,
    });
    await t.app.inject({
      method: 'POST',
      url: '/v1/saves',
      headers: me.headers,
      payload: { type: 'place', refId: ids[2] },
    });
    expect(
      (await t.app.inject({ url: '/v1/saves', query: { type: 'place' }, headers: me.headers }))
        .json()
        .items.map((i: { place: { name: string } }) => i.place.name),
    ).toEqual(['Park', 'Bakery']);
    expect(
      (
        await t.app.inject({
          url: '/v1/saves',
          query: { folderId: folder.id },
          headers: me.headers,
        })
      ).json().items,
    ).toHaveLength(1);
    expect((await t.app.inject({ url: '/v1/folders', headers: me.headers })).json().items).toEqual([
      expect.objectContaining({ name: 'Date ideas', count: 1 }),
    ]);
    await t.app.inject({
      method: 'DELETE',
      url: '/v1/saves',
      headers: me.headers,
      payload: { type: 'place', refId: ids[1] },
    });
    expect(
      (await t.app.inject({ url: '/v1/folders', headers: me.headers })).json().items[0].count,
    ).toBe(0);
    await t.app.inject({
      method: 'POST',
      url: '/v1/saves',
      headers: me.headers,
      payload: { type: 'place', refId: ids[1] },
    });
  });

  test('saving someone else’s plan copies it into your plans, ready to start', async () => {
    const theirs = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: pal.headers,
        payload: { name: 'Pal plan', stops: [{ placeId: ids[0] }, { placeId: ids[2] }] },
      })
    ).json();
    const r = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/saves',
        headers: me.headers,
        payload: { type: 'plan', refId: theirs.id },
      })
    ).json();
    expect(r.copiedPlanId).not.toBe(theirs.id);
    // Their planner thread, group chat and matches are theirs; only the stops come along.
    const plans = t.ctx.db.collection('plans');
    await plans.updateOne(
      { _id: theirs.id },
      { $set: { aiThreadId: 'thr_pal', imessageRsvps: ['+1555'], notifiedMatchIds: ['u1'] } },
    );
    const again = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/saves',
        headers: me.headers,
        payload: { type: 'plan', refId: theirs.id },
      })
    ).json();
    const copy = await plans.findOne({ _id: again.copiedPlanId });
    expect(copy).toMatchObject({ sourcePlanId: theirs.id, hostId: me.id });
    expect(copy).not.toHaveProperty('aiThreadId');
    expect(copy).not.toHaveProperty('imessageRsvps');
    expect(copy).not.toHaveProperty('notifiedMatchIds');
    expect(r.saved.plan).toMatchObject({
      name: 'Pal plan',
      isHost: true,
      status: 'draft',
      stops: [{ label: 'Film Forum' }, { label: 'Park' }],
    });
  });

  test('plan from saved places nearby, in walking order; none nearby is 404', async () => {
    const p = await t.app.inject({
      method: 'POST',
      url: '/v1/plans/from-saved',
      headers: me.headers,
      payload: { ...ORIGIN },
    });
    expect(p.json().stops.map((s: { label: string }) => s.label)).toEqual(['Bakery', 'Park']);
    const far = await t.app.inject({
      method: 'POST',
      url: '/v1/plans/from-saved',
      headers: other.headers,
      payload: { ...ORIGIN },
    });
    expect(far.statusCode).toBe(404);
  });
});

describe('verify', () => {
  test('credential appears only once the capture is posted; HTML page and JSON', async () => {
    t.ctx.clock.offsetMs = 7 * 3600_000;
    const { media } = await checkinWithMedia(t.ctx, me.id, ids[1]!, offset(ORIGIN, 300, 0), [
      'photo',
    ]);
    t.ctx.clock.offsetMs = 0;
    const hash = media[0]!.sha256;
    expect((await t.app.inject(`/v1/credentials/${hash}`)).statusCode).toBe(404);
    await t.app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: me.headers,
      payload: { mediaIds: [media[0]!._id] },
    });
    const j = await t.app.inject(`/v1/credentials/${hash}`);
    expect(j.json()).toMatchObject({
      verified: true,
      place: { name: 'Bakery' },
      checkin: { tier: 'tag' },
      author: { username: 'profiler' },
      capturedInApp: true,
    });
    const html = await t.app.inject(`/verify/${hash}`);
    expect(html.statusCode).toBe(200);
    expect(html.body).toContain('VERIFIED IRL');
    expect(html.body).toContain('Bakery');
    const bad = await t.app.inject('/verify/deadbeef');
    expect(bad.statusCode, bad.body).toBe(404);
  });
});

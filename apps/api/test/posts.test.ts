import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { handlers } from '../src/jobs/handlers.ts';
import { Worker } from '../src/jobs/queue.ts';
import { checkinWithMedia } from './fixtures/media.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
let ana: Awaited<ReturnType<typeof devLogin>>;
let ben: Awaited<ReturnType<typeof devLogin>>;
let worker: Worker;
let cafe: string;
let park: string;

beforeAll(async () => {
  t = await setupTestApp();
  worker = new Worker(t.ctx, handlers, { info: () => {}, error: (o) => console.error(o) });
  const [c, p] = await insertPlaces(t.ctx.db, [
    placeDoc({ name: 'Cafe', category: 'food', at: ORIGIN }),
    placeDoc({ name: 'Park', category: 'nature', at: offset(ORIGIN, 500, 0) }),
  ]);
  [cafe, park] = [c!._id, p!._id];
  ana = await devLogin(t.app, 'ana');
  ben = await devLogin(t.app, 'ben');
});
afterAll(() => t.teardown());

const post = (who: typeof ana, payload: object) =>
  t.app.inject({ method: 'POST', url: '/v1/posts', headers: who.headers, payload });

describe('posts', () => {
  test('photos post: pending until the safety check, then live with stamp, ambient and counts', async () => {
    const { media } = await checkinWithMedia(t.ctx, ana.id, cafe, ORIGIN, [
      'photo',
      'photo',
      'audio',
    ]);
    await t.ctx.db
      .collection('media')
      .updateOne({ _id: media[0]!._id } as never, { $set: { ambientId: media[2]!._id } });
    const r = await post(ana, {
      mediaIds: [media[0]!._id, media[1]!._id],
      caption: 'pierogi heaven',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      type: 'photos',
      status: 'pending',
      place: { name: 'Cafe' },
      stamp: { tier: 'tag', placeName: 'Cafe' },
      counts: { been: 1 },
    });
    expect(r.json().media[0].ambientUrl).toEqual(expect.any(String));
    expect(
      (await t.app.inject({ url: `/v1/posts/${r.json().id}`, headers: ben.headers })).statusCode,
    ).toBe(404); // not live yet
    await worker.drain();
    const live = await t.app.inject({ url: `/v1/posts/${r.json().id}`, headers: ben.headers });
    expect(live.json().status).toBe('live');
    expect((await post(ana, { mediaIds: [media[0]!._id] })).statusCode).toBe(409); // already posted
  });

  test('type rules: one video is a Clip; a video with others, audio, unverified or someone else’s media is refused', async () => {
    const { media } = await checkinWithMedia(t.ctx, ben.id, park, offset(ORIGIN, 500, 0), [
      'video',
      'photo',
      'audio',
    ]);
    expect((await post(ben, { mediaIds: [media[0]!._id, media[1]!._id] })).statusCode).toBe(400);
    expect((await post(ben, { mediaIds: [media[2]!._id] })).statusCode).toBe(400);
    expect((await post(ana, { mediaIds: [media[1]!._id] })).statusCode).toBe(404);
    await t.ctx.db
      .collection('media')
      .updateOne({ _id: media[1]!._id } as never, { $set: { status: 'pending' } });
    expect((await post(ben, { mediaIds: [media[1]!._id] })).json().error.code).toBe(
      'MEDIA_NOT_VERIFIED',
    );
    expect((await post(ben, { mediaIds: [media[0]!._id] })).json().type).toBe('clip');
  });

  test('recap post carries the route card and marks the recap posted', async () => {
    const s = {
      _id: 'sess-recap',
      userId: ana.id,
      kind: 'plan',
      status: 'ended',
      startedAt: new Date(),
      pointsAccepted: 0,
      pointsRejected: 0,
    };
    t.ctx.clock.offsetMs = 7 * 3600_000; // past the 6 h cooldown at the cafe
    const a = await checkinWithMedia(t.ctx, ana.id, cafe, ORIGIN, ['photo']);
    const b = await checkinWithMedia(t.ctx, ana.id, park, offset(ORIGIN, 500, 0), ['video']);
    t.ctx.clock.offsetMs = 0;
    const stop = (c: typeof a, name: string, placeId: string) => ({
      checkinId: c.checkin.id,
      placeId,
      placeName: name,
      category: 'food',
      tier: 'tag',
      time: c.checkin.time,
      firstVisit: false,
      bestMediaId: c.media[0]!._id,
      mediaIds: [c.media[0]!._id],
      reviewed: false,
    });
    await t.ctx.db.collection('sessions').insertOne({
      ...s,
      recap: {
        route: [ORIGIN, offset(ORIGIN, 500, 0)],
        stops: [stop(a, 'Cafe', cafe), stop(b, 'Park', park)],
        posted: false,
      },
    } as never);
    const r = await post(ana, {
      sessionId: 'sess-recap',
      includeRoute: true,
      mediaIds: [a.media[0]!._id, b.media[0]!._id],
    });
    expect(r.json()).toMatchObject({
      type: 'recap',
      route: {
        stops: [
          { index: 1, name: 'Cafe' },
          { index: 2, name: 'Park' },
        ],
      },
    });
    expect((await post(ana, { sessionId: 'sess-recap', includeRoute: true })).statusCode).toBe(409);
  });

  test('moderation rejects; rejected posts are never shown', async () => {
    const { media } = await checkinWithMedia(t.ctx, ben.id, cafe, ORIGIN, ['photo']);
    const r = await post(ben, { mediaIds: [media[0]!._id], caption: 'nazi stuff' });
    await worker.drain();
    expect(
      (await t.app.inject({ url: `/v1/posts/${r.json().id}`, headers: ana.headers })).statusCode,
    ).toBe(404);
    const doc = await t.ctx.db.collection('posts').findOne({ _id: r.json().id } as never);
    expect(doc?.status).toBe('rejected');
  });
});

describe('reviews', () => {
  test('bare yes feeds the percentage only; text makes a Review post with the visit photo; one per visit', async () => {
    const cafeDoc = async () => t.ctx.db.collection('places').findOne({ _id: cafe } as never);
    const before = (await cafeDoc())!.wouldGoAgain;
    const mine = await t.ctx.tiger.query(
      `select id from checkins where user_id = $1 and place_id = $2 order by time limit 1`,
      [ana.id, cafe],
    );
    const bare = await t.app.inject({
      method: 'POST',
      url: '/v1/reviews',
      headers: ana.headers,
      payload: { checkinId: mine.rows[0].id, again: true },
    });
    expect(bare.json()).toMatchObject({ post: null });
    expect((await cafeDoc())!.wouldGoAgain).toEqual({
      yes: before.yes + 1,
      total: before.total + 1,
    });
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/v1/reviews',
          headers: ana.headers,
          payload: { checkinId: mine.rows[0].id, again: false },
        })
      ).statusCode,
    ).toBe(409);

    const theirs = await t.ctx.tiger.query(
      `select id from checkins where user_id = $1 and place_id = $2 order by time limit 1`,
      [ben.id, cafe],
    );
    const withText = await t.app.inject({
      method: 'POST',
      url: '/v1/reviews',
      headers: ben.headers,
      payload: { checkinId: theirs.rows[0].id, again: false, text: 'Too loud to talk' },
    });
    expect(withText.json()).toMatchObject({
      place: { wouldGoAgainPct: 50 },
      post: { type: 'review', again: false, text: 'Too loud to talk' },
    });
    expect(withText.json().post.media).toHaveLength(1);
    // "Would go again: No" is remembered for the AI planner.
    expect(
      await t.ctx.db.collection('ai_memories').findOne({ userId: ben.id, source: 'review' }),
    ).toMatchObject({ text: expect.stringMatching(/^Would not go again to .*Too loud to talk/) });
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/v1/reviews',
          headers: ben.headers,
          payload: { checkinId: mine.rows[0].id, again: true },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('safety', () => {
  test('report hides a post from the reporter only; block hides everything from that author', async () => {
    const [gallery] = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Gallery', category: 'culture', at: offset(ORIGIN, 0, 300) }),
    ]);
    const { media } = await checkinWithMedia(t.ctx, ana.id, gallery!._id, offset(ORIGIN, 0, 300), [
      'photo',
    ]);
    const p = (await post(ana, { mediaIds: [media[0]!._id] })).json();
    await worker.drain();
    const carl = await devLogin(t.app, 'carl');
    await t.app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: ben.headers,
      payload: { postId: p.id, reason: 'spam' },
    });
    expect(
      (await t.app.inject({ url: `/v1/posts/${p.id}`, headers: ben.headers })).statusCode,
    ).toBe(404);
    expect(
      (await t.app.inject({ url: `/v1/posts/${p.id}`, headers: carl.headers })).statusCode,
    ).toBe(200);
    // The place sheet's grid: everyone's posts from that place, minus what you reported.
    const grid = async (who: typeof ben) =>
      (
        await t.app.inject({
          url: '/v1/posts',
          query: { placeId: gallery!._id },
          headers: who.headers,
        })
      )
        .json()
        .items.map((i: { id: string }) => i.id);
    expect(await grid(carl)).toEqual([p.id]);
    expect(await grid(ben)).toEqual([]);
    await t.app.inject({
      method: 'POST',
      url: '/v1/blocks',
      headers: carl.headers,
      payload: { userId: ana.id },
    });
    expect(
      (
        await t.app.inject({ url: '/v1/posts', query: { authorId: ana.id }, headers: carl.headers })
      ).json().items,
    ).toEqual([]);
    expect(
      (
        await t.app.inject({ url: '/v1/posts', query: { authorId: ana.id }, headers: ana.headers })
      ).json().items.length,
    ).toBeGreaterThan(0);
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { JobDoc } from '../src/jobs/queue.ts';
import { moderatePost } from '../src/services/posts.ts';
import { checkinWithMedia } from './fixtures/media.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
let u: Awaited<ReturnType<typeof devLogin>>;
let places: string[];

beforeAll(async () => {
  t = await setupTestApp();
  places = (
    await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'A', category: 'food', at: ORIGIN }),
      placeDoc({ name: 'B', category: 'music', at: offset(ORIGIN, 300, 0) }),
    ])
  ).map((p) => p._id);
  u = await devLogin(t.app, 'regress');
});
afterAll(() => t.teardown());

const post = (payload: object, who = u) =>
  t.app.inject({ method: 'POST', url: '/v1/posts', headers: who.headers, payload });

describe('Phase 2 review fixes', () => {
  test('a clip whose rendition never arrives is rejected on the last attempt, not pending forever', async () => {
    const { media } = await checkinWithMedia(t.ctx, u.id, places[1]!, offset(ORIGIN, 300, 0), [
      'video',
    ]);
    const p = (await post({ mediaIds: [media[0]!._id] })).json();
    const job = { attempts: 3, maxAttempts: 8 } as JobDoc;
    await expect(moderatePost(t.ctx, { postId: p.id }, job)).rejects.toThrow(/not ready/);
    await moderatePost(t.ctx, { postId: p.id }, { ...job, attempts: 8 });
    expect(await t.ctx.db.collection('posts').findOne({ _id: p.id } as never)).toMatchObject({
      status: 'rejected',
      moderationReason: 'clip could not be processed',
    });
  });

  test('reviewing a visit first does not block posting its photo; posting it twice still does', async () => {
    const { checkin, media } = await checkinWithMedia(t.ctx, u.id, places[0]!, ORIGIN, ['photo']);
    const review = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/reviews',
        headers: u.headers,
        payload: { checkinId: checkin.id, again: true, text: 'Great bagels' },
      })
    ).json();
    expect(review.post.media.map((m: { id: string }) => m.id)).toEqual([media[0]!._id]);
    expect((await post({ mediaIds: [media[0]!._id] })).statusCode).toBe(200);
    expect((await post({ mediaIds: [media[0]!._id] })).statusCode).toBe(409);
  });

  test('a share-link token cannot skip host approval on an open (find) plan', async () => {
    await t.ctx.db
      .collection('users')
      .updateOne({ _id: u.id } as never, { $set: { verifiedAt: new Date(), campus: 'Columbia' } });
    const plan = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: {
          startAt: new Date(Date.now() + 86_400_000).toISOString(),
          stops: [{ placeId: places[0] }],
        },
      })
    ).json();
    await t.app.inject({
      method: 'POST',
      url: `/v1/plans/${plan.id}/save`,
      headers: u.headers,
      payload: { visibility: 'find' },
    });
    const other = await devLogin(t.app, 'tokenholder');
    const token = plan.shareUrl.split('/p/')[1];
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: `/v1/plans/${plan.id}/join`,
          headers: other.headers,
          payload: { token },
        })
      ).statusCode,
    ).toBe(403);
  });

  test('deleting an account takes its posts down', async () => {
    const gone = await devLogin(t.app, 'leaving');
    const { media } = await checkinWithMedia(t.ctx, gone.id, places[0]!, ORIGIN, ['photo']);
    const p = (await post({ mediaIds: [media[0]!._id] }, gone)).json();
    await t.app.inject({ method: 'DELETE', url: '/v1/me', headers: gone.headers });
    expect(await t.ctx.db.collection('posts').findOne({ _id: p.id } as never)).toMatchObject({
      status: 'removed',
    });
  });
});

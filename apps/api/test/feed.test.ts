import { newId, toGeoJSONPoint } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { feedRank, interleave } from '../src/domain/feedRank.ts';
import type { PostDoc } from '../src/services/posts.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

describe('feed ranking', () => {
  test('friends triple, distance and age decay, taste floor', () => {
    const base = { friend: false, taste: 0.5, distanceM: 0, ageH: 0 };
    expect(feedRank({ ...base, friend: true })).toBeCloseTo(3 * feedRank(base));
    expect(feedRank({ ...base, distanceM: 2000 })).toBeCloseTo(feedRank(base) / Math.E);
    expect(feedRank({ ...base, ageH: 48 })).toBeCloseTo(feedRank(base) / Math.E);
    expect(feedRank({ ...base, taste: -1 })).toBe(feedRank({ ...base, taste: 0.1 }));
  });
  test('every fifth card is a plan; leftover plans follow the posts', () => {
    const out = interleave(['a', 'b', 'c', 'd', 'e', 'f'], [1, 2, 3]).map((c) => c.v);
    expect(out).toEqual(['a', 'b', 'c', 'd', 1, 'e', 'f', 2, 3]);
  });
});

describe('GET /feed', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let me: Awaited<ReturnType<typeof devLogin>>;
  let friend: Awaited<ReturnType<typeof devLogin>>;
  let stranger: Awaited<ReturnType<typeof devLogin>>;
  let placeId: string;

  const mkPost = async (authorId: string, o: Partial<PostDoc> = {}, at = ORIGIN) => {
    const doc: PostDoc = {
      _id: newId(),
      authorId,
      type: 'photos',
      status: 'live',
      placeId,
      loc: toGeoJSONPoint(at),
      mediaIds: [],
      stamp: { placeName: 'Cafe', time: new Date(), tier: 'tag' },
      hiddenFrom: [],
      createdAt: new Date(Date.now() - 3600_000),
      ...o,
    };
    await t.ctx.db.collection<PostDoc>('posts').insertOne(doc);
    return doc._id;
  };
  const feed = async () =>
    (
      await t.app.inject({
        url: '/v1/feed',
        query: { lat: String(ORIGIN.lat), lng: String(ORIGIN.lng) },
        headers: me.headers,
      })
    ).json();

  beforeAll(async () => {
    t = await setupTestApp();
    const [p] = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Cafe', category: 'food', tags: ['coffee'], at: ORIGIN }),
    ]);
    placeId = p!._id;
    me = await devLogin(t.app, 'reader');
    friend = await devLogin(t.app, 'pal');
    stranger = await devLogin(t.app, 'someone');
    const [a, b] = [me.id, friend.id].sort();
    await t.ctx.db.collection('friendships').insertOne({
      _id: `${a}:${b}`,
      a,
      b,
      since: new Date(),
      hangouts: 1,
      streakWeeks: 1,
      lastHangoutWeek: 0,
    } as never);
  });
  afterAll(() => t.teardown());

  test('friends first, near-me next; far, own, hidden, blocked, pending and old posts never appear; ends on purpose', async () => {
    const fp = await mkPost(friend.id, {}, offset(ORIGIN, 1000, 0)); // 3·e^-0.5 beats a stranger's post at 0 m
    const sp = await mkPost(stranger.id);
    await mkPost(stranger.id, {}, offset(ORIGIN, 9000, 0)); // beyond 5 km
    await mkPost(me.id);
    await mkPost(stranger.id, { hiddenFrom: [me.id] });
    await mkPost(stranger.id, { status: 'pending' });
    await mkPost(stranger.id, { createdAt: new Date(Date.now() - 8 * 86_400_000) });
    const f = await feed();
    expect(
      f.cards.map((c: { kind: string; post?: { id: string } }) => c.post?.id ?? c.kind),
    ).toEqual([fp, sp, 'end']);
    expect(f.cards.at(-1).title).toBe("You're caught up. Go outside.");

    const blocker = await devLogin(t.app, 'blocker');
    await t.app.inject({
      method: 'POST',
      url: '/v1/blocks',
      headers: me.headers,
      payload: { userId: stranger.id },
    });
    expect(
      (await feed()).cards.map((c: { post?: { id: string } }) => c.post?.id).filter(Boolean),
    ).toEqual([fp]);
    await t.app.inject({ method: 'DELETE', url: `/v1/blocks/${stranger.id}`, headers: me.headers });
    void blocker;
  });

  test('a friend’s shared plan takes the fifth slot with a Join action', async () => {
    for (let i = 0; i < 4; i++) await mkPost(friend.id);
    await t.ctx.db.collection('plans').insertOne({
      _id: 'shared-plan',
      hostId: friend.id,
      name: 'Friday crawl',
      nameIsDefault: false,
      startAt: new Date(Date.now() + 86_400_000),
      mode: 'walk',
      visibility: 'friends',
      status: 'planned',
      stops: [],
      members: [],
      ghostChanges: [],
      shareToken: 'tok',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    const f = await feed();
    expect(f.cards[4]).toMatchObject({
      kind: 'plan',
      action: 'join',
      plan: { name: 'Friday crawl' },
    });
  });

  test('30 unseen a day, then only the end card', async () => {
    const all = (await feed()).cards
      .filter((c: { kind: string }) => c.kind === 'post')
      .map((c: { post: { id: string } }) => c.post.id);
    await t.app.inject({
      method: 'POST',
      url: '/v1/feed/seen',
      headers: me.headers,
      payload: { postIds: all },
    });
    const fresh = [];
    for (let i = 0; i < 40; i++) fresh.push(await mkPost(stranger.id));
    const f = await feed();
    const shown = f.cards.filter((c: { kind: string }) => c.kind === 'post');
    expect(shown).toHaveLength(30 - all.length);
    expect(shown.some((c: { post: { id: string } }) => all.includes(c.post.id))).toBe(false);
    await t.app.inject({
      method: 'POST',
      url: '/v1/feed/seen',
      headers: me.headers,
      payload: { postIds: shown.map((c: { post: { id: string } }) => c.post.id) },
    });
    const done = await feed();
    expect(done.cards.filter((c: { kind: string }) => c.kind === 'post')).toEqual([]);
    expect(done.unseenLeftToday).toBe(0);
    expect(done.cards.at(-1).kind).toBe('end');
  });
});

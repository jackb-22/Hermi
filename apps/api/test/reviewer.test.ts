import { createHash } from 'node:crypto';
import { newId, TAG_DIMS, type Tag, tagIndex, toGeoJSONPoint } from '@itp/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createCheckin } from '../src/services/checkins.ts';
import { REVIEW_CAMPUS } from '../src/services/eduEmail.ts';
import {
  findMatches,
  matchNotify,
  matchScore,
  planFacts,
  viewerFacts,
} from '../src/services/matching.ts';
import { plans } from '../src/services/plans.ts';
import type { PostDoc } from '../src/services/posts.ts';
import { befriendReviewer, pairKey } from '../src/services/social.ts';
import { users } from '../src/services/users.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

/**
 * The App Review path: REVIEW_EMAIL takes REVIEW_CODE instead of a school inbox, and the accounts it makes
 * (campus "App Review") stay out of leaderboards and matching, and out of strangers' feeds.
 */
const REVIEW_EMAIL = 'review@hermi.world';
const REVIEW_CODE = '424242';
const DAY = 86_400_000;

let t: Awaited<ReturnType<typeof setupTestApp>>;
type Login = Awaited<ReturnType<typeof devLogin>>;
beforeAll(async () => {
  t = await setupTestApp({ REVIEW_EMAIL, REVIEW_CODE });
});
afterAll(() => t.teardown());

const mail = () => t.ctx.providers.email as unknown as { sent: { to: string }[] };
const sha = (x: string) => createHash('sha256').update(x).digest('hex');
let nextIp = 1;
const start = (u: Login, email: string, ip = `198.51.100.${nextIp++}`) =>
  t.app.inject({
    method: 'POST',
    url: '/v1/auth/edu',
    headers: { ...u.headers, 'x-forwarded-for': ip },
    payload: { email, gradYear: 2028 },
  });
const verify = (u: Login, code: string) =>
  t.app.inject({
    method: 'POST',
    url: '/v1/auth/edu/verify',
    headers: u.headers,
    payload: { code },
  });
const call = (u: Login, method: 'GET' | 'POST', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: u.headers, payload });
const pendingOf = (userId: string) =>
  t.ctx.db
    .collection<{ _id: string; codeHash: string; attempts: number; campus: string }>('edu_codes')
    .findOne({ _id: userId });
let pizza: string;
let park: string;
const mkPost = async (authorId: string) => {
  const doc: PostDoc = {
    _id: newId(),
    authorId,
    type: 'photos',
    status: 'live',
    placeId: pizza,
    loc: toGeoJSONPoint(ORIGIN),
    mediaIds: [],
    stamp: { placeName: 'Pizza Spot', time: new Date(), tier: 'tag' },
    hiddenFrom: [],
    createdAt: new Date(Date.now() - 3600_000),
  };
  await t.ctx.db.collection<PostDoc>('posts').insertOne(doc);
  return doc._id;
};
/** Ids of the posts in a viewer's Feed (friends' always, nearby ones when a location is sent). */
const feedPosts = async (u: Login, near = true) =>
  (
    await t.app.inject({
      url: '/v1/feed',
      query: near ? { lat: String(ORIGIN.lat), lng: String(ORIGIN.lng) } : {},
      headers: u.headers,
    })
  )
    .json()
    .cards.filter((c: { kind: string }) => c.kind === 'post')
    .map((c: { post: { id: string } }) => c.post.id);
const befriend = (x: string, y: string) => {
  const [a, b] = [x, y].sort();
  return t.ctx.db.collection('friendships').insertOne({
    _id: `${a}:${b}`,
    a,
    b,
    since: new Date(),
    hangouts: 1,
    streakWeeks: 1,
    lastHangoutWeek: 0,
  } as never);
};
const set = (id: string, fields: object) =>
  users(t.ctx.db).updateOne({ _id: id }, { $set: fields });

/** A reviewer the way Apple's would be made: signed in, then verified through the review address. */
async function reviewer(name: string) {
  const u = await devLogin(t.app, name);
  const s = await start(u, REVIEW_EMAIL);
  expect(s.statusCode, s.body).toBe(200);
  const v = await verify(u, REVIEW_CODE);
  expect(v.statusCode, v.body).toBe(200);
  return u;
}
/** A Columbia student, verified directly. */
async function student(name: string, fields: object = {}) {
  const u = await devLogin(t.app, name);
  await set(u.id, { verifiedAt: new Date(), campus: 'Columbia', gradYear: 2028, ...fields });
  return u;
}

describe('signing in with the review address', () => {
  // Sends are counted per hour; sit in the middle of one so a test cannot straddle a window edge.
  beforeEach(() => {
    const now = Date.now();
    t.ctx.clock.offsetMs = now - (now % 3_600_000) + 1_800_000 - now;
  });
  afterEach(() => {
    t.ctx.clock.offsetMs = 0;
  });

  test('no email is sent, the code verifies, and the account is App Review', async () => {
    const u = await devLogin(t.app, 'rv_first');
    const before = mail().sent.length;
    const s = await start(u, REVIEW_EMAIL);
    expect(s.statusCode, s.body).toBe(200);
    expect(s.json()).toMatchObject({ sent: true, campus: REVIEW_CAMPUS });
    expect(s.json()).not.toHaveProperty('devCode');
    expect(s.body).not.toContain(REVIEW_CODE);
    expect(mail().sent.length).toBe(before);

    const v = await verify(u, REVIEW_CODE);
    expect(v.statusCode, v.body).toBe(200);
    expect(v.json()).toMatchObject({
      verified: true,
      campus: 'App Review',
      gradYear: 2028,
      studentStatus: 'current',
    });
    const doc = (await users(t.ctx.db).findOne({ _id: u.id }))!;
    expect(doc).toMatchObject({ campus: 'App Review', verifiedAt: expect.any(Date) });
    // No school-email hash: the unique index must not make the shared address a one-account claim.
    expect(doc).not.toHaveProperty('eduEmailHash');
    // The pending code is gone, and was only ever stored hashed.
    expect(await pendingOf(u.id)).toBeNull();
  });

  test('the pending code is a hash, without an email hash', async () => {
    const u = await devLogin(t.app, 'rv_stored');
    await start(u, REVIEW_EMAIL);
    const pending = (await pendingOf(u.id))!;
    expect(pending).toMatchObject({ campus: 'App Review', attempts: 0 });
    expect(pending.codeHash).toBe(sha(`${u.id}:${REVIEW_CODE}`));
    expect(pending).not.toHaveProperty('emailHash');
    expect(JSON.stringify(pending)).not.toContain(REVIEW_CODE);
  });

  test('the address is read like a school one: case does not matter', async () => {
    const u = await devLogin(t.app, 'rv_case');
    const s = await start(u, 'Review@HERMI.World');
    expect(s.statusCode, s.body).toBe(200);
    expect((await verify(u, REVIEW_CODE)).statusCode).toBe(200);
  });

  test('any number of accounts can verify with the same address, even at the same moment', async () => {
    const before = await users(t.ctx.db).countDocuments({ campus: REVIEW_CAMPUS });
    const first = await reviewer('rv_many_1');
    const second = await reviewer('rv_many_2');
    expect(first.id).not.toBe(second.id);
    const racers = await Promise.all(['rv_race_1', 'rv_race_2', 'rv_race_3'].map(reviewer));
    expect(racers).toHaveLength(3);
    expect(await users(t.ctx.db).countDocuments({ campus: REVIEW_CAMPUS })).toBe(before + 5);
  });

  test('it skips the per-IP cap but keeps the per-account one', async () => {
    const ip = '203.0.113.77';
    const ipKeys = () =>
      t.ctx.db
        .collection('rate_limits')
        .countDocuments({ _id: { $regex: `^edu:ip:${ip}:` } as never });
    const u = await devLogin(t.app, 'rv_limit');
    for (let i = 0; i < 5; i++) expect((await start(u, REVIEW_EMAIL, ip)).statusCode).toBe(200);
    expect(await ipKeys()).toBe(0);
    const sixth = await start(u, REVIEW_EMAIL, ip);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe('RATE_LIMITED');
    // A school address from the same IP is counted against it, so the zero above means something.
    const other = await devLogin(t.app, 'rv_limit_control');
    expect((await start(other, 'ctl@columbia.edu', ip)).statusCode).toBe(200);
    expect(await ipKeys()).toBe(1);
  });

  test('a wrong code is refused and counted; five spend the code, even for the right one', async () => {
    const u = await devLogin(t.app, 'rv_wrong');
    await start(u, REVIEW_EMAIL);
    for (let i = 1; i <= 5; i++) {
      const bad = await verify(u, '000000');
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('EDU_CODE_INVALID');
      expect((await pendingOf(u.id))!.attempts).toBe(i);
    }
    const spent = await verify(u, REVIEW_CODE);
    expect(spent.json().error.code).toBe('EDU_CODE_EXPIRED');
    const doc = (await users(t.ctx.db).findOne({ _id: u.id }))!;
    expect(doc.verifiedAt).toBeUndefined();
    expect(doc.campus).toBeUndefined();
    // A fresh send starts over.
    await start(u, REVIEW_EMAIL);
    expect((await verify(u, REVIEW_CODE)).statusCode).toBe(200);
  });

  test('the code only works for the account it was asked for, and not without asking', async () => {
    const asker = await devLogin(t.app, 'rv_asker');
    const bystander = await devLogin(t.app, 'rv_bystander');
    await start(asker, REVIEW_EMAIL);
    const r = await verify(bystander, REVIEW_CODE);
    expect(r.json().error.code).toBe('EDU_CODE_EXPIRED');
    expect((await users(t.ctx.db).findOne({ _id: bystander.id }))!.verifiedAt).toBeUndefined();
  });

  test('only the exact address: a +tag, a lookalike or the code in a school address is just refused', async () => {
    const u = await devLogin(t.app, 'rv_exact');
    const before = mail().sent.length;
    for (const email of [
      'review+1@hermi.world',
      'xreview@hermi.world',
      'review@hermi.world.evil.com',
    ]) {
      const r = await start(u, email);
      expect(r.statusCode, email).toBe(400);
      expect(r.json().error.code, email).toBe('EDU_DOMAIN_NOT_ALLOWED');
    }
    expect(mail().sent.length).toBe(before);
    // A school address still gets a random code by email, never the review code, and a hash.
    const school = await start(u, 'rv.real@columbia.edu');
    expect(school.statusCode).toBe(200);
    expect(school.json().devCode).toMatch(/^\d{6}$/);
    expect(mail().sent.at(-1)?.to).toBe('rv.real@columbia.edu');
    if (school.json().devCode !== REVIEW_CODE)
      expect((await verify(u, REVIEW_CODE)).json().error.code).toBe('EDU_CODE_INVALID');
    expect((await verify(u, school.json().devCode)).json()).toMatchObject({ campus: 'Columbia' });
    expect((await users(t.ctx.db).findOne({ _id: u.id }))!.eduEmailHash).toEqual(
      expect.any(String),
    );
  });

  test('a signed-in account that was deleted cannot use it', async () => {
    const u = await devLogin(t.app, 'rv_deleted');
    await set(u.id, { deletedAt: new Date() });
    expect((await start(u, REVIEW_EMAIL)).statusCode).toBe(401);
  });
});

describe('kept apart from students', () => {
  let host: Login;
  let bob: Login;
  let rev1: Login;
  let rev2: Login;
  const vec = (tags: Tag[]) => {
    const v = new Array<number>(TAG_DIMS).fill(0);
    for (const x of tags) v[tagIndex(x)] = 1 / Math.sqrt(tags.length);
    return v;
  };
  const taste = { openToPlans: true, is21: true, prefVector: vec(['pizza', 'park']) };
  const tomorrow = (h = 0) => new Date(Date.now() + DAY + h * 3600_000).toISOString();

  /** The host saves an open (Find someone) plan with pizza and a park. */
  async function openPlan(by: Login, startAt = tomorrow()) {
    const p = (
      await call(by, 'POST', '/v1/plans', {
        name: 'Open pizza walk',
        startAt,
        stops: [{ placeId: pizza }, { placeId: park }],
      })
    ).json();
    const saved = await call(by, 'POST', `/v1/plans/${p.id}/save`, { visibility: 'find' });
    expect(saved.statusCode, saved.body).toBe(200);
    return p.id as string;
  }
  /** Matches are read through $vectorSearch, which lags behind writes; wait for the one we expect. */
  async function matchesOf(planId: string, expectUser?: string) {
    const plan = (await plans(t.ctx.db).findOne({ _id: planId }))!;
    for (let i = 0; i < 60; i++) {
      const got = (await findMatches(t.ctx, plan)).map((m) => m.userId);
      if (!expectUser || got.includes(expectUser)) return got.sort();
      await new Promise((r) => setTimeout(r, 250));
    }
    return (await findMatches(t.ctx, plan)).map((m) => m.userId).sort();
  }
  const xp = (userId: string, campus: string, n: number) =>
    t.ctx.tiger.query(
      `insert into xp_events (time, user_id, campus, kind, xp) values (now(), $1, $2, 'checkin_tag', $3)`,
      [userId, campus, n],
    );
  const planIds = (list: { plan: { id: string } }[]) => list.map((o) => o.plan.id);

  beforeAll(async () => {
    [pizza, park] = (
      await insertPlaces(t.ctx.db, [
        placeDoc({ name: 'Pizza Spot', category: 'food', tags: ['pizza'], at: ORIGIN }),
        placeDoc({
          name: 'Green Park',
          category: 'nature',
          tags: ['park'],
          at: offset(ORIGIN, 500, 0),
        }),
      ])
    ).map((p) => p._id) as [string, string];
    host = await student('ka_host');
    bob = await student('ka_bob', taste);
    rev1 = await reviewer('ka_rev1');
    rev2 = await reviewer('ka_rev2');
    // Reviewers like the same things as the students: only the campus keeps them apart.
    await set(rev1.id, taste);
    await set(rev2.id, taste);
  });

  test('leaderboards: reviewers are on none, and do not count in anyone’s rank', async () => {
    await xp(host.id, 'Columbia', 100);
    await xp(bob.id, 'Columbia', 50);
    await xp(rev1.id, REVIEW_CAMPUS, 900); // would be first on any board it was on
    await xp(rev2.id, REVIEW_CAMPUS, 10);
    await t.ctx.tiger.query(
      `call refresh_continuous_aggregate('xp_daily', null, date_trunc('day', now()))`,
    );
    const students = await users(t.ctx.db).countDocuments({
      campus: 'Columbia',
      verifiedAt: { $exists: true },
    });

    const board = (await call(host, 'GET', '/v1/leaderboard?scope=campus')).json();
    expect(board.campus).toBe('Columbia');
    const ids = board.items.map((i: { user: { id: string } }) => i.user.id);
    expect(ids).toContain(bob.id);
    expect(ids).not.toContain(rev1.id);
    expect(ids).not.toContain(rev2.id);
    expect(board.items[0].user.id).toBe(host.id); // not the reviewer's 900
    expect(board.items).toHaveLength(students);
    const score = (await call(host, 'GET', '/v1/score')).json();
    expect(score.ranks.campus).toMatchObject({ rank: 1, of: students, campus: 'Columbia' });

    // The reviewer's own Campus tab is empty, with no board named, and their Score has no campus rank.
    const mine = await call(rev1, 'GET', '/v1/leaderboard?scope=campus');
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toEqual({ scope: 'campus', campus: null, items: [], me: null });
    expect((await call(rev1, 'GET', '/v1/score')).json().ranks.campus).toBeNull();
    // Seen from outside, as a student looking at their profile, it is the same.
    expect((await call(host, 'GET', `/v1/score?userId=${rev1.id}`)).json().ranks.campus).toBeNull();
    // Friends tab still works, and does not name a campus either.
    const friends = (await call(rev1, 'GET', '/v1/leaderboard')).json();
    expect(friends).toMatchObject({ scope: 'friends', campus: null });
    expect(friends.items.map((i: { user: { id: string } }) => i.user.id)).toEqual([rev1.id]);
  });

  test('Find someone: a student’s open plan matches students, never a reviewer', async () => {
    const id = await openPlan(host);
    // Same taste, same city: bob matches, the reviewers do not.
    expect(await matchesOf(id, bob.id)).toEqual([bob.id]);

    const asBob = await call(bob, 'GET', '/v1/social');
    expect(planIds(asBob.json().openPlans)).toContain(id);
    for (const rev of [rev1, rev2]) {
      expect(planIds((await call(rev, 'GET', '/v1/social')).json().openPlans)).not.toContain(id);
      const feed = (await call(rev, 'GET', '/v1/feed')).json();
      const cards = feed.cards.filter((c: { kind: string }) => c.kind === 'plan');
      expect(planIds(cards)).not.toContain(id);
      expect((await call(rev, 'POST', `/v1/plans/${id}/request`)).statusCode).toBe(403);
      expect((await call(rev, 'GET', `/v1/plans/${id}`)).statusCode).toBe(404);
    }
    // Control: the same reads work for a student.
    expect((await call(bob, 'GET', `/v1/plans/${id}`)).statusCode).toBe(200);
    const feed = (await call(bob, 'GET', '/v1/feed')).json();
    expect(planIds(feed.cards.filter((c: { kind: string }) => c.kind === 'plan'))).toContain(id);
  });

  test('Find someone: a reviewer can make an open plan; it matches nobody, notifies nobody', async () => {
    const id = await openPlan(rev1, tomorrow(5));
    const plan = (await plans(t.ctx.db).findOne({ _id: id }))!;
    expect(await findMatches(t.ctx, plan)).toEqual([]);
    await matchNotify(t.ctx, { planId: id });
    expect(
      await t.ctx.db
        .collection('jobs')
        .countDocuments({ type: 'push', 'payload.msg.data.planId': id }),
    ).toBe(0);
    expect((await plans(t.ctx.db).findOne({ _id: id }))!.matchCount).toBe(0);
    // No student sees it, and none can ask to join.
    for (const who of [bob, host]) {
      expect(planIds((await call(who, 'GET', '/v1/social')).json().openPlans)).not.toContain(id);
      expect((await call(who, 'POST', `/v1/plans/${id}/request`)).statusCode).toBe(403);
      expect((await call(who, 'GET', `/v1/plans/${id}`)).statusCode).toBe(404);
    }
    // Nor another reviewer.
    expect((await call(rev2, 'POST', `/v1/plans/${id}/request`)).statusCode).toBe(403);
  });

  test('a host with no campus does not skip the check: a reviewer nearby still never matches', async () => {
    // With no campus on the host there is no campus filter, only distance. Two lookalikes, one student
    // and one reviewer, both last seen at the first stop.
    const nocampus = await student('ka_nocampus');
    await t.ctx.db
      .collection('users')
      .updateOne({ _id: nocampus.id } as never, { $unset: { campus: '' } });
    const near = await student('ka_near', taste);
    const nearRev = await reviewer('ka_nearrev');
    await set(nearRev.id, taste);
    for (const u of [near, nearRev])
      await createCheckin(t.ctx, {
        userId: u.id,
        placeId: pizza,
        tier: 'tag',
        at: ORIGIN,
        accuracy: 10,
        time: new Date(Date.now() - 3600_000),
        attested: false,
      });
    const id = await openPlan(nocampus, tomorrow(9));
    const plan = (await plans(t.ctx.db).findOne({ _id: id }))!;
    const [pf] = await planFacts(t.ctx, [plan]);
    const vfs = await viewerFacts(
      t.ctx,
      await users(t.ctx.db)
        .find({ _id: { $in: [near.id, nearRev.id] } })
        .toArray(),
      { from: pf!.start, to: pf!.end },
    );
    expect(matchScore(pf!, vfs.get(near.id)!)).toBeGreaterThan(0);
    expect(matchScore(pf!, vfs.get(nearRev.id)!)).toBeNull();
    expect((await findMatches(t.ctx, plan)).map((m) => m.userId)).not.toContain(nearRev.id);
  });

  describe('the Feed', () => {
    test('strangers nearby are not shown across the line, either way; friends are', async () => {
      const reader = await student('ka_reader');
      const hers = await mkPost(host.id);
      const bobs = await mkPost(bob.id);
      const revs = await mkPost(rev1.id);
      // The student sees the other student's post near them, not the reviewer's.
      expect(await feedPosts(reader)).toEqual(expect.arrayContaining([hers, bobs]));
      expect(await feedPosts(reader)).not.toContain(revs);
      // The reviewer sees no one nearby at all.
      expect(await feedPosts(rev2)).toEqual([]);
      expect(await feedPosts(rev1)).toEqual([]);

      // Friends come by consent: after a tap, each sees the other's post.
      await befriend(reader.id, rev1.id);
      const readersPost = await mkPost(reader.id);
      expect(await feedPosts(reader)).toContain(revs);
      expect(await feedPosts(rev1)).toEqual([readersPost]);
      expect(await feedPosts(rev2)).toEqual([]);
    });
  });

  describe('the place sheet', () => {
    const grid = async (u: Login, extra = '') =>
      (await call(u, 'GET', `/v1/posts?placeId=${pizza}${extra}`))
        .json()
        .items.map((p: { id: string }) => p.id)
        .sort();

    const profile = async (u: Login, authorId: string) =>
      (await call(u, 'GET', `/v1/posts?authorId=${authorId}`)).json().items;
    const readable = async (u: Login, postId: string) =>
      (await call(u, 'GET', `/v1/posts/${postId}`)).statusCode === 200;

    test('a real viewer sees no reviewer’s posts there unless friends; a reviewer sees only their own and friends’', async () => {
      const viewer = await student('ps_viewer');
      const author = await student('ps_author');
      const revAuthor = await reviewer('ps_rev_author');
      const revViewer = await reviewer('ps_rev_viewer');
      const [a, r, v] = [
        await mkPost(author.id),
        await mkPost(revAuthor.id),
        await mkPost(revViewer.id),
      ];
      // A real viewer still sees ordinary posts there, and no reviewer's.
      expect(await grid(viewer)).toContain(a);
      expect(await grid(viewer)).not.toContain(r);
      expect(await grid(viewer)).not.toContain(v);
      expect(await grid(viewer, `&authorId=${author.id}`)).toEqual([a]);
      // A reviewer sees only their own, and asking for someone by id does not get around it.
      expect(await grid(revViewer)).toEqual([v]);
      expect(await grid(revViewer, `&authorId=${author.id}`)).toEqual([]);
      expect(await grid(viewer, `&authorId=${revAuthor.id}`)).toEqual([]);
      expect(await grid(revAuthor)).toEqual([r]);
      // The rule sits in the filter every post read shares, so profile grids and single posts obey it.
      expect(await profile(viewer, revAuthor.id)).toEqual([]);
      expect(await profile(revViewer, author.id)).toEqual([]);
      expect(await profile(revViewer, revViewer.id)).toHaveLength(1);
      expect(await readable(viewer, a)).toBe(true);
      expect(await readable(viewer, r)).toBe(false);
      expect(await readable(revViewer, a)).toBe(false);
      expect(await readable(revViewer, v)).toBe(true);

      // A friend is there by consent (in practice the team account): each side then sees the
      // other's posts, and only that friend's.
      await befriend(revViewer.id, author.id);
      expect(await grid(revViewer)).toEqual([a, v].sort());
      expect(await profile(revViewer, author.id)).toHaveLength(1);
      expect(await readable(revViewer, a)).toBe(true);
      await befriend(viewer.id, revAuthor.id);
      expect(await grid(viewer)).toContain(r);
      expect(await grid(viewer)).not.toContain(v);
      expect(await profile(viewer, revAuthor.id)).toHaveLength(1);
      expect(await readable(viewer, r)).toBe(true);
      expect(await readable(viewer, v)).toBe(false);
    });
  });

  describe('a real friend for App Review (REVIEW_FRIEND_ID)', () => {
    let team: Login;
    const friendsOf = (id: string) =>
      t.ctx.db
        .collection<{ _id: string; a: string; b: string; hangouts: number; streakWeeks: number }>(
          'friendships',
        )
        .find({ $or: [{ a: id }, { b: id }] })
        .toArray();
    const unset = () => {
      t.ctx.config.REVIEW_FRIEND_ID = undefined;
    };
    beforeAll(async () => {
      team = await student('team_account');
    });
    // Config is read per request, so the tests switch the setting on the running app.
    beforeEach(() => {
      t.ctx.config.REVIEW_FRIEND_ID = team.id;
    });
    afterEach(async () => {
      unset();
      await users(t.ctx.db).updateOne(
        { _id: team.id },
        { $unset: { deletedAt: '', bannedAt: '' } },
      );
    });

    test('unset is a no-op: reviewers verify and have no friends', async () => {
      unset();
      const r = await reviewer('tf_unset');
      expect(await friendsOf(r.id)).toEqual([]);
    });

    test('a missing, deleted or banned account is skipped and logged, and the reviewer still verifies', async () => {
      const warn = vi.spyOn(t.app.log, 'warn');
      const skipped = async (name: string, friendId: string, reason: string) => {
        warn.mockClear();
        const r = await reviewer(name); // verifies: the helper expects a 200
        expect(await friendsOf(r.id)).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
          { userId: r.id, friendId, reason },
          'App Review friendship not made',
        );
      };
      try {
        t.ctx.config.REVIEW_FRIEND_ID = 'no-such-user';
        await skipped('tf_missing', 'no-such-user', 'unavailable');

        t.ctx.config.REVIEW_FRIEND_ID = team.id;
        await set(team.id, { deletedAt: new Date() });
        await skipped('tf_deleted', team.id, 'unavailable');
        await users(t.ctx.db).updateOne({ _id: team.id }, { $unset: { deletedAt: '' } });

        await set(team.id, { bannedAt: new Date() });
        await skipped('tf_banned', team.id, 'unavailable');
      } finally {
        warn.mockRestore();
      }
    });

    test('a reviewer cannot be their own friend', async () => {
      const r = await devLogin(t.app, 'tf_self');
      expect(await befriendReviewer(t.ctx.db, r.id, r.id, new Date())).toBe('unavailable');
      expect(await friendsOf(r.id)).toEqual([]);
    });

    test('a reviewer who verifies becomes the team account’s friend, once, in the ordinary shape', async () => {
      const warn = vi.spyOn(t.app.log, 'warn');
      try {
        const r = await reviewer('tf_one');
        const [a, b] = [r.id, team.id].sort();
        const [made] = await friendsOf(r.id);
        expect(made).toMatchObject({ _id: pairKey(a!, b!), a, b, hangouts: 0, streakWeeks: 0 });
        // The same fields a tap-made friendship has (logHangout), so every reader treats it alike.
        expect(Object.keys(made!).sort()).toEqual(
          ['_id', 'a', 'b', 'since', 'hangouts', 'streakWeeks', 'lastHangoutWeek'].sort(),
        );
        const profile = (await call(r, 'GET', `/v1/profile/${team.id}`)).json();
        expect(profile).toMatchObject({ isFriend: true, streak: { weeks: 0, hangouts: 0 } });
        const list = (await call(r, 'GET', '/v1/friends')).json().items;
        expect(list.map((f: { user: { id: string } }) => f.user.id)).toEqual([team.id]);
        // Verifying again, or calling it directly, makes no second one, and is not a problem to log.
        await start(r, REVIEW_EMAIL);
        expect((await verify(r, REVIEW_CODE)).statusCode).toBe(200);
        expect(await befriendReviewer(t.ctx.db, r.id, team.id, new Date())).toBe('exists');
        expect(await friendsOf(r.id)).toEqual([made]);
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    test('a friendship that already exists is left as it is', async () => {
      const r = await devLogin(t.app, 'tf_existing');
      const [a, b] = [r.id, team.id].sort();
      await t.ctx.db.collection('friendships').insertOne({
        _id: pairKey(a!, b!),
        a,
        b,
        since: new Date('2026-01-01'),
        hangouts: 7,
        streakWeeks: 3,
        lastHangoutWeek: 0,
      } as never);
      await start(r, REVIEW_EMAIL);
      expect((await verify(r, REVIEW_CODE)).statusCode).toBe(200);
      expect(await friendsOf(r.id)).toEqual([
        expect.objectContaining({ hangouts: 7, streakWeeks: 3 }),
      ]);
    });

    test('only reviewers get it: a student who verifies by school email does not', async () => {
      const u = await devLogin(t.app, 'tf_student');
      const s = await start(u, 'tf.student@columbia.edu');
      expect(s.statusCode, s.body).toBe(200);
      expect((await verify(u, s.json().devCode)).json()).toMatchObject({ campus: 'Columbia' });
      expect(await friendsOf(u.id)).toEqual([]);
      // The team account itself is untouched by reviewers until one verifies.
      expect(await friendsOf(team.id)).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ a: u.id })]),
      );
    });

    test('a reviewer who blocked the account first is not made its friend', async () => {
      const r = await devLogin(t.app, 'tf_blocker');
      expect((await call(r, 'POST', '/v1/blocks', { userId: team.id })).statusCode).toBe(200);
      await start(r, REVIEW_EMAIL);
      const warn = vi.spyOn(t.app.log, 'warn');
      try {
        expect((await verify(r, REVIEW_CODE)).statusCode).toBe(200);
        expect(warn).toHaveBeenCalledWith(
          { userId: r.id, friendId: team.id, reason: 'blocked' },
          'App Review friendship not made',
        );
      } finally {
        warn.mockRestore();
      }
      expect(await friendsOf(r.id)).toEqual([]);
    });

    test('the Feed then has the team’s posts and plans, report and block work, and nothing else opens up', async () => {
      const r = await reviewer('tf_feed');
      await set(r.id, taste);
      const post = await mkPost(team.id);
      const shared = (
        await call(team, 'POST', '/v1/plans', {
          name: 'Team brunch',
          startAt: tomorrow(1),
          stops: [{ placeId: pizza }],
        })
      ).json();
      expect(
        (await call(team, 'POST', `/v1/plans/${shared.id}/save`, { visibility: 'friends' }))
          .statusCode,
      ).toBe(200);
      const open = await openPlan(team, tomorrow(3));

      // Real content, with no location sent: it comes through the friendship.
      expect(await feedPosts(r, false)).toContain(post);
      const cards = (await call(r, 'GET', '/v1/feed')).json().cards;
      const plansShown = cards.filter((c: { kind: string }) => c.kind === 'plan');
      expect(plansShown.map((c: { plan: { id: string } }) => c.plan.id)).toContain(shared.id);
      expect(plansShown.find((c: { plan: { id: string } }) => c.plan.id === shared.id).action).toBe(
        'join',
      );
      // Their open (Find someone) plan is not: the reviewer is still in no one's matching.
      expect(plansShown.map((c: { plan: { id: string } }) => c.plan.id)).not.toContain(open);
      expect(planIds((await call(r, 'GET', '/v1/social')).json().openPlans)).not.toContain(open);
      expect((await call(r, 'POST', `/v1/plans/${open}/request`)).statusCode).toBe(403);
      const openPlanDoc = (await plans(t.ctx.db).findOne({ _id: open }))!;
      expect((await findMatches(t.ctx, openPlanDoc)).map((m) => m.userId)).not.toContain(r.id);
      // The team account is not on the reviewer's leaderboard, and no strangers came with it.
      expect((await call(r, 'GET', '/v1/leaderboard?scope=campus')).json().items).toEqual([]);
      expect(await feedPosts(r)).toEqual([post]);

      // Guideline 1.2: the reviewer can report the post and block its author, and it goes away.
      const report = await call(r, 'POST', '/v1/reports', { postId: post, reason: 'testing' });
      expect(report.statusCode, report.body).toBe(200);
      expect((await call(r, 'POST', '/v1/blocks', { userId: team.id })).statusCode).toBe(200);
      expect(await feedPosts(r, false)).not.toContain(post);
      expect((await call(r, 'GET', `/v1/posts/${post}`)).statusCode).toBe(404);
    });
  });

  test('reviewers can still use the app', async () => {
    const me = await call(rev2, 'GET', '/v1/me');
    expect(me.json()).toMatchObject({ verified: true, campus: 'App Review' });
    const profile = await call(rev2, 'GET', '/v1/profile/me');
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ isMe: true, user: { campus: 'App Review' } });
    expect((await call(rev2, 'GET', '/v1/feed')).statusCode).toBe(200);
    expect((await call(rev2, 'GET', '/v1/social')).statusCode).toBe(200);
    expect((await call(rev2, 'GET', `/v1/places/${pizza}`)).statusCode).toBe(200);
    // Make a plan and share it with friends.
    const p = (
      await call(rev2, 'POST', '/v1/plans', { startAt: tomorrow(), stops: [{ placeId: pizza }] })
    ).json();
    const saved = await call(rev2, 'POST', `/v1/plans/${p.id}/save`, { visibility: 'friends' });
    expect(saved.statusCode, saved.body).toBe(200);
  });

  test('a reviewer’s shared plan page does not call the host a verified student', async () => {
    const page = async (u: Login) => {
      const p = (
        await call(u, 'POST', '/v1/plans', { startAt: tomorrow(2), stops: [{ placeId: pizza }] })
      ).json();
      await call(u, 'POST', `/v1/plans/${p.id}/save`, { visibility: 'friends' });
      const mine = (await call(u, 'GET', '/v1/plans?scope=upcoming')).json().items;
      const plan = mine.find((x: { id: string }) => x.id === p.id);
      return (await t.app.inject(`/p/${plan.shareUrl.split('/p/')[1]}`)).body;
    };
    expect(await page(host)).toContain('verified Columbia student');
    const forReviewer = await page(rev2);
    expect(forReviewer).toContain('Hosted by');
    expect(forReviewer).not.toContain('verified');
    expect(forReviewer).not.toContain('App Review');
  });
});

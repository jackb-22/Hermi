import { TAG_DIMS } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { personalTag } from './fixtures/tags.ts';
import { devLogin, setupTestApp } from './helpers.ts';

/** T15: what a signed-in user can read about other people's plans, scores and tap cards. */
let t: Awaited<ReturnType<typeof setupTestApp>>;
type User = Awaited<ReturnType<typeof devLogin>>;
let host: User;
let pal: User; // host's friend
let invitee: User; // host's friend, invited to the invite-only plan
let student: User; // verified and matched to open plans, not a friend
let rando: User; // nobody's friend, unverified
let placeIds: string[];

// One plan per visibility, all hosted by `host`.
const plan: Record<'justMe' | 'invite' | 'friends' | 'find', string> = {
  justMe: '',
  invite: '',
  friends: '',
  find: '',
};

const call = (
  who: User,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) => t.app.inject({ method, url, headers: who.headers, payload });
const befriend = async (x: string, y: string) => {
  const [a, b] = [x, y].sort();
  await t.ctx.db.collection('friendships').insertOne({
    _id: `${a}:${b}`,
    a,
    b,
    since: new Date(),
    hangouts: 1,
    streakWeeks: 1,
    lastHangoutWeek: 0,
  } as never);
};
const unfriend = (x: string, y: string) =>
  t.ctx.db.collection('friendships').deleteOne({ _id: [x, y].sort().join(':') } as never);
const newPlan = async (
  who: User,
  name: string,
  save?: { visibility: string; inviteeIds?: string[] },
  days = 1,
) => {
  const p = (
    await call(who, 'POST', '/v1/plans', {
      name,
      startAt: new Date(Date.now() + days * 86_400_000).toISOString(),
      stops: placeIds.map((placeId) => ({ placeId })),
    })
  ).json();
  if (save) await call(who, 'POST', `/v1/plans/${p.id}/save`, save);
  return p.id as string;
};
const setPlan = (id: string, set: object) =>
  t.ctx.db.collection('plans').updateOne({ _id: id } as never, { $set: set });
const setUser = (id: string, set: object) =>
  t.ctx.db.collection('users').updateOne({ _id: id } as never, { $set: set });
const listed = async (viewer: User, userId: string) =>
  (await call(viewer, 'GET', `/v1/plans?userId=${userId}`))
    .json()
    .items.map((p: { id: string }) => p.id);
const save = (who: User, refId: string) => call(who, 'POST', '/v1/saves', { type: 'plan', refId });
const planCount = () => t.ctx.db.collection('plans').countDocuments();

beforeAll(async () => {
  t = await setupTestApp();
  placeIds = (
    await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Diner', category: 'food', at: ORIGIN }),
      placeDoc({ name: 'Lawn', category: 'nature', at: offset(ORIGIN, 400, 0) }),
    ])
  ).map((p) => p._id);
  host = await devLogin(t.app, 'accesshost');
  pal = await devLogin(t.app, 'accesspal');
  invitee = await devLogin(t.app, 'accessinvitee');
  student = await devLogin(t.app, 'accessstudent');
  rando = await devLogin(t.app, 'accessrando');
  await befriend(host.id, pal.id);
  await befriend(host.id, invitee.id);
  for (const id of [host.id, student.id])
    await setUser(id, { verifiedAt: new Date(), campus: 'Columbia' });
  // Find someone shows open plans only to matched students: Open to plans on, with an overlapping taste.
  await setUser(student.id, {
    openToPlans: true,
    prefVector: new Array(TAG_DIMS).fill(1 / Math.sqrt(TAG_DIMS)),
  });
  plan.justMe = await newPlan(host, 'Just me plan');
  plan.invite = await newPlan(
    host,
    'Invite plan',
    { visibility: 'invite', inviteeIds: [invitee.id] },
    2,
  );
  plan.friends = await newPlan(host, 'Friends plan', { visibility: 'friends' }, 3);
  plan.find = await newPlan(host, 'Open plan', { visibility: 'find' }, 4);
});
afterAll(() => t.teardown());

describe('saving a plan', () => {
  test('a plan you cannot view is 404 and copies nothing, the same as a plan that does not exist', async () => {
    const before = await planCount();
    const missing = await save(rando, 'no-such-plan');
    expect(missing.statusCode).toBe(404);
    for (const id of [plan.justMe, plan.invite, plan.friends, plan.find]) {
      const r = await save(rando, id);
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual(missing.json());
    }
    // A friend still cannot see a private plan or an invite-only one they were not invited to.
    expect((await save(pal, plan.justMe)).statusCode).toBe(404);
    expect((await save(pal, plan.invite)).statusCode).toBe(404);
    expect((await save(student, plan.friends)).statusCode).toBe(404);
    expect(await planCount()).toBe(before);
    expect(
      await t.ctx.db
        .collection('saves')
        .countDocuments({ userId: { $in: [rando.id, pal.id, student.id] }, type: 'plan' }),
    ).toBe(0);
  });

  test('a plan you may view is copied into your own plans', async () => {
    const copyOf = async (who: User, id: string) => {
      const r = await save(who, id);
      expect(r.statusCode, r.body).toBe(200);
      const { copiedPlanId, saved } = r.json();
      expect(copiedPlanId).not.toBe(id);
      expect(saved.plan).toMatchObject({ isHost: true, status: 'draft', visibility: 'just_me' });
      return t.ctx.db.collection('plans').findOne({ _id: copiedPlanId } as never);
    };
    expect(await copyOf(pal, plan.friends)).toMatchObject({
      hostId: pal.id,
      sourcePlanId: plan.friends,
      members: [],
    });
    expect(await copyOf(invitee, plan.invite)).toMatchObject({ hostId: invitee.id });
    expect(await copyOf(student, plan.find)).toMatchObject({ hostId: student.id });
    // The host saving their own plan is a bookmark, not a copy.
    const own = (await save(host, plan.friends)).json();
    expect(own.copiedPlanId).toBeNull();
    expect(own.saved.plan).toMatchObject({ id: plan.friends });
  });

  test('a blocked friend, a deleted host and a cancelled plan are all 404', async () => {
    await call(pal, 'POST', '/v1/blocks', { userId: host.id });
    expect((await save(pal, plan.friends)).statusCode).toBe(404);
    await call(pal, 'DELETE', `/v1/blocks/${host.id}`);
    expect((await save(pal, plan.friends)).statusCode).toBe(200);
    await call(host, 'POST', '/v1/blocks', { userId: invitee.id }); // the other direction
    expect((await save(invitee, plan.friends)).statusCode).toBe(404);
    await call(host, 'DELETE', `/v1/blocks/${invitee.id}`);
    expect((await save(invitee, plan.friends)).statusCode).toBe(200);

    await setUser(host.id, { deletedAt: new Date() });
    expect((await save(pal, plan.friends)).statusCode).toBe(404);
    await t.ctx.db
      .collection('users')
      .updateOne({ _id: host.id } as never, { $unset: { deletedAt: '' } });

    const gone = await newPlan(host, 'Cancelled', { visibility: 'friends' });
    await call(host, 'DELETE', `/v1/plans/${gone}`);
    expect((await save(pal, gone)).statusCode).toBe(404);
  });

  test('a ghost-mode host’s completed outing is hidden from friends; a plan still ahead is not', async () => {
    await call(host, 'PATCH', '/v1/me', { ghostMode: true });
    expect((await save(pal, plan.friends)).statusCode).toBe(200);
    await setPlan(plan.friends, { status: 'completed' });
    expect((await save(pal, plan.friends)).statusCode).toBe(404);
    expect((await call(pal, 'GET', `/v1/plans/${plan.friends}`)).statusCode).toBe(404);
    expect(await listed(pal, host.id)).not.toContain(plan.friends);
    // The host still sees it, and so does anyone on it.
    expect((await call(host, 'GET', `/v1/plans/${plan.friends}`)).statusCode).toBe(200);
    await call(host, 'PATCH', '/v1/me', { ghostMode: false });
    expect((await save(pal, plan.friends)).statusCode).toBe(200);
    await setPlan(plan.friends, { status: 'planned' });
  });

  test('adding a plan to a folder follows the same rule, and a saved reference stops showing once you cannot view it', async () => {
    const folder = (await call(pal, 'POST', '/v1/folders', { name: 'Ideas' })).json();
    const add = (refId: string) =>
      call(pal, 'POST', `/v1/folders/${folder.id}/items`, { type: 'plan', refId });
    expect((await add(plan.justMe)).statusCode).toBe(404);
    expect((await add('no-such-plan')).statusCode).toBe(404);
    expect((await add(plan.friends)).statusCode).toBe(200);
    const shown = async () =>
      (await call(pal, 'GET', '/v1/saves?type=plan'))
        .json()
        .items.map((i: { refId: string }) => i.refId);
    expect(await shown()).toContain(plan.friends);
    // A row written before the rule (or kept past an unfriending) is not hydrated into a plan.
    await t.ctx.db.collection('saves').insertOne({
      _id: 'legacy-save',
      userId: pal.id,
      type: 'plan',
      refId: plan.justMe,
      createdAt: new Date(),
    } as never);
    expect(await shown()).not.toContain(plan.justMe);
    await unfriend(host.id, pal.id);
    expect(await shown()).not.toContain(plan.friends);
    await befriend(host.id, pal.id);
    expect(await shown()).toContain(plan.friends);
  });
});

describe('listing someone else’s plans', () => {
  test('the list shows exactly the plans you could open one by one', async () => {
    const all = Object.values(plan);
    const viewers = { host, pal, invitee, student, rando };
    for (const [name, viewer] of Object.entries(viewers)) {
      const ids = await listed(viewer, host.id);
      for (const id of all) {
        const open = (await call(viewer, 'GET', `/v1/plans/${id}`)).statusCode === 200;
        expect([name, id, ids.includes(id)]).toEqual([name, id, open]);
      }
    }
  });

  test('stranger sees nothing; a friend sees friends and open plans; the invited see the invite; a match sees the open plan', async () => {
    expect(await listed(rando, host.id)).toEqual([]);
    expect((await listed(pal, host.id)).sort()).toEqual([plan.friends, plan.find].sort());
    expect((await listed(invitee, host.id)).sort()).toEqual(
      [plan.friends, plan.find, plan.invite].sort(),
    );
    expect(await listed(student, host.id)).toEqual([plan.find]);
    expect((await listed(host, host.id)).sort()).toEqual(Object.values(plan).sort());
  });

  test('every scope obeys the rule', async () => {
    for (const scope of ['upcoming', 'drafts', 'completed', 'all']) {
      const r = await call(rando, 'GET', `/v1/plans?userId=${host.id}&scope=${scope}`);
      expect(r.json()).toEqual({ items: [], nextCursor: null });
    }
  });

  test('a plan someone joined is listed by its host’s rules, not by theirs', async () => {
    const joined = await newPlan(student, 'Student plan', { visibility: 'friends' });
    await befriend(student.id, pal.id);
    await call(pal, 'POST', `/v1/plans/${joined}/join`, {});
    // rando is nobody's friend; host is pal's friend but not the student's.
    expect(await listed(rando, pal.id)).toEqual([]);
    expect(await listed(host, pal.id)).not.toContain(joined);
    expect(await listed(student, pal.id)).toContain(joined);
    await unfriend(student.id, pal.id);
  });

  test('deleted, blocked and unknown users are 404, like their profile', async () => {
    expect((await call(rando, 'GET', '/v1/plans?userId=no-such-user')).statusCode).toBe(404);
    await call(pal, 'POST', '/v1/blocks', { userId: host.id });
    expect((await call(pal, 'GET', `/v1/plans?userId=${host.id}`)).statusCode).toBe(404);
    expect((await call(host, 'GET', `/v1/plans?userId=${pal.id}`)).statusCode).toBe(404);
    expect((await call(pal, 'GET', `/v1/profile/${host.id}`)).statusCode).toBe(404);
    await call(pal, 'DELETE', `/v1/blocks/${host.id}`);
    await setUser(host.id, { deletedAt: new Date() });
    expect((await call(pal, 'GET', `/v1/plans?userId=${host.id}`)).statusCode).toBe(404);
    await t.ctx.db
      .collection('users')
      .updateOne({ _id: host.id } as never, { $unset: { deletedAt: '' } });
    expect((await call(pal, 'GET', `/v1/plans?userId=${host.id}`)).statusCode).toBe(200);
  });

  test('the profile plan count matches what the Plans tab lists', async () => {
    const expected: [User, number][] = [
      [rando, 0],
      [pal, 2],
      [invitee, 3],
      [student, 1],
      [host, 4],
    ];
    for (const [viewer, n] of expected) {
      const p = (await call(viewer, 'GET', `/v1/profile/${host.id}`)).json();
      expect([viewer.id, p.counts.plans]).toEqual([viewer.id, n]);
      expect(await listed(viewer, host.id)).toHaveLength(n);
    }
  });
});

describe('GET /score', () => {
  test('anyone signed in sees a profile’s Score row, the same as on the profile; your own still works', async () => {
    const onProfile = (await call(rando, 'GET', `/v1/profile/${pal.id}`)).json().score;
    const r = await call(rando, 'GET', `/v1/score?userId=${pal.id}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(onProfile);
    expect((await call(pal, 'GET', `/v1/score?userId=${pal.id}`)).json().userId).toBe(pal.id);
    expect((await call(pal, 'GET', '/v1/score')).json().userId).toBe(pal.id);
  });

  test('a deleted, blocked or unknown user is 404', async () => {
    expect((await call(rando, 'GET', '/v1/score?userId=no-such-user')).statusCode).toBe(404);
    const gone = await devLogin(t.app, 'accessgone');
    expect((await call(rando, 'GET', `/v1/score?userId=${gone.id}`)).statusCode).toBe(200);
    await setUser(gone.id, { deletedAt: new Date() });
    expect((await call(rando, 'GET', `/v1/score?userId=${gone.id}`)).statusCode).toBe(404);
    // Blocked in either direction.
    await call(rando, 'POST', '/v1/blocks', { userId: invitee.id });
    expect((await call(rando, 'GET', `/v1/score?userId=${invitee.id}`)).statusCode).toBe(404);
    expect((await call(invitee, 'GET', `/v1/score?userId=${rando.id}`)).statusCode).toBe(404);
    await call(rando, 'DELETE', `/v1/blocks/${invitee.id}`);
    expect((await call(invitee, 'GET', `/v1/score?userId=${rando.id}`)).statusCode).toBe(200);
  });
});

describe('GET /taps/pending', () => {
  let maya: User;
  let mayaTag: Awaited<ReturnType<typeof personalTag>>;
  const here = { ...ORIGIN, accuracy: 10 };
  const pending = (who: User, friendId: string) =>
    t.app.inject({ url: '/v1/taps/pending', query: { friendId }, headers: who.headers });

  beforeAll(async () => {
    maya = await devLogin(t.app, 'accessmaya');
    mayaTag = await personalTag(t.ctx.db);
    const bound = await call(maya, 'POST', '/v1/me/tag', { url: mayaTag.url });
    expect(bound.statusCode, bound.body).toBe(200);
  });

  test('someone who never tapped their tag gets 404, the same as for an unknown id', async () => {
    const r = await pending(rando, maya.id);
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual((await pending(rando, 'no-such-user')).json());
    // Someone with no tag at all.
    expect((await pending(rando, student.id)).statusCode).toBe(404);
  });

  test('after tapping their tag you may poll their card for a few minutes, then it is 404 again', async () => {
    const tap = await t.app.inject({
      method: 'POST',
      url: '/v1/taps',
      headers: rando.headers,
      payload: { url: mayaTag.url, ...here },
    });
    expect(tap.json()).toMatchObject({ status: 'waiting', friend: { username: 'accessmaya' } });
    const r = await pending(rando, maya.id);
    expect(r.json()).toMatchObject({ status: 'waiting', friend: { id: maya.id } });
    t.ctx.clock.offsetMs = 15 * 60_000;
    expect((await pending(rando, maya.id)).statusCode).toBe(404);
    t.ctx.clock.offsetMs = 0;
  });

  test('a friend may always poll, with or without a recent tap', async () => {
    await befriend(maya.id, pal.id);
    const r = await pending(pal, maya.id);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      status: 'waiting',
      expiresAt: null,
      friend: { id: maya.id },
      streak: { hangouts: 1 },
    });
  });

  test('blocked or deleted: 404 even for a friend', async () => {
    await call(pal, 'POST', '/v1/blocks', { userId: maya.id });
    expect((await pending(pal, maya.id)).statusCode).toBe(404);
    expect((await pending(maya, pal.id)).statusCode).toBe(404);
    await call(pal, 'DELETE', `/v1/blocks/${maya.id}`);
    expect((await pending(pal, maya.id)).statusCode).toBe(200);
    await setUser(maya.id, { deletedAt: new Date() });
    expect((await pending(pal, maya.id)).statusCode).toBe(404);
  });
});

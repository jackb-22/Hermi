import { TAG_DIMS } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { handlers } from '../src/jobs/handlers.ts';
import { Worker } from '../src/jobs/queue.ts';
import type { FakePush } from '../src/providers/push.ts';
import { createCheckin } from '../src/services/checkins.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
let host: Awaited<ReturnType<typeof devLogin>>;
let pal: Awaited<ReturnType<typeof devLogin>>;
let pal2: Awaited<ReturnType<typeof devLogin>>;
let student: Awaited<ReturnType<typeof devLogin>>;
let stranger: Awaited<ReturnType<typeof devLogin>>;
let worker: Worker;
let placeIds: string[];

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
const newPlan = async (name?: string, days = 1) =>
  (
    await t.app.inject({
      method: 'POST',
      url: '/v1/plans',
      headers: host.headers,
      payload: {
        name,
        startAt: new Date(Date.now() + days * 86_400_000).toISOString(),
        stops: placeIds.map((placeId) => ({ placeId })),
      },
    })
  ).json();
const call = (who: typeof host, method: 'POST' | 'GET', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: who.headers, payload });

beforeAll(async () => {
  t = await setupTestApp();
  worker = new Worker(t.ctx, handlers, { info: () => {}, error: (o) => console.error(o) });
  placeIds = (
    await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Diner', category: 'food', at: ORIGIN }),
      placeDoc({ name: 'Lawn', category: 'nature', at: offset(ORIGIN, 400, 0) }),
    ])
  ).map((p) => p._id);
  host = await devLogin(t.app, 'hosting');
  pal = await devLogin(t.app, 'palone');
  pal2 = await devLogin(t.app, 'paltwo');
  student = await devLogin(t.app, 'student');
  stranger = await devLogin(t.app, 'rando');
  await befriend(host.id, pal.id);
  await befriend(host.id, pal2.id);
  await t.ctx.db.collection('users').updateMany({ _id: { $in: [host.id, student.id] } } as never, {
    $set: { verifiedAt: new Date(), campus: 'Columbia' },
  });
  // Find someone shows open plans only to matched students: Open to plans on, with a taste that overlaps.
  await t.ctx.db.collection('users').updateOne({ _id: student.id } as never, {
    $set: { openToPlans: true, prefVector: new Array(TAG_DIMS).fill(1 / Math.sqrt(TAG_DIMS)) },
  });
  await call(pal, 'POST', '/v1/me/push-token', { token: 'ExponentPushToken[pal-device]' });
  await call(host, 'POST', '/v1/me/push-token', { token: 'ExponentPushToken[host-device]' });
});
afterAll(() => t.teardown());

describe('save and invite', () => {
  test('only friends can be invited; invitees get a push; the name is suggested when not given', async () => {
    const p = await newPlan();
    expect(
      (
        await call(host, 'POST', `/v1/plans/${p.id}/save`, {
          visibility: 'invite',
          inviteeIds: [stranger.id],
        })
      ).statusCode,
    ).toBe(400);
    const saved = (
      await call(host, 'POST', `/v1/plans/${p.id}/save`, {
        visibility: 'invite',
        inviteeIds: [pal.id],
      })
    ).json();
    expect(saved).toMatchObject({
      status: 'planned',
      visibility: 'invite',
      name: 'Diner and more',
      members: [{ userId: pal.id, status: 'invited' }],
    });
    await worker.drain();
    const push = t.ctx.providers.push as FakePush;
    expect(push.sent.at(-1)).toMatchObject({
      tokens: ['ExponentPushToken[pal-device]'],
      msg: { data: { kind: 'plan_invite', planId: p.id } },
    });

    expect((await call(stranger, 'POST', `/v1/plans/${p.id}/join`, {})).statusCode).toBe(403);
    const joined = (await call(pal, 'POST', `/v1/plans/${p.id}/join`, {})).json();
    expect(joined.members).toEqual([expect.objectContaining({ userId: pal.id, status: 'joined' })]);
    const byLink = (
      await call(stranger, 'POST', `/v1/plans/${p.id}/join`, { token: p.shareUrl.split('/p/')[1] })
    ).json();
    expect(byLink.members.map((m: { status: string }) => m.status)).toEqual(['joined', 'joined']);
    expect((await call(pal, 'POST', `/v1/plans/${p.id}/decline`)).json().members[0].status).toBe(
      'declined',
    );
  });

  test('friends-visible plan: any friend can join directly', async () => {
    const p = await newPlan('Open to friends');
    await call(host, 'POST', `/v1/plans/${p.id}/save`, { visibility: 'friends' });
    expect(
      (await call(pal2, 'POST', `/v1/plans/${p.id}/join`, {})).json().members[0],
    ).toMatchObject({ userId: pal2.id, status: 'joined' });
  });

  test('find someone: verified host, verified requester, host approves', async () => {
    const p = await newPlan('Open plan');
    expect(
      (
        await call(
          pal,
          'POST',
          `/v1/plans/${(await (async () => (await t.app.inject({ method: 'POST', url: '/v1/plans', headers: pal.headers, payload: { stops: [] } })).json())()).id}/save`,
          { visibility: 'find' },
        )
      ).statusCode,
    ).toBe(403);
    await call(host, 'POST', `/v1/plans/${p.id}/save`, { visibility: 'find' });
    expect((await call(student, 'POST', `/v1/plans/${p.id}/join`, {})).statusCode).toBe(403);
    expect((await call(stranger, 'POST', `/v1/plans/${p.id}/request`)).statusCode).toBe(403); // unverified
    expect(
      (await call(student, 'POST', `/v1/plans/${p.id}/request`)).json().members[0],
    ).toMatchObject({ userId: student.id, status: 'requested' });
    expect((await call(student, 'POST', `/v1/plans/${p.id}/request`)).statusCode).toBe(409);
    const approved = (
      await call(host, 'POST', `/v1/plans/${p.id}/requests/${student.id}/approve`)
    ).json();
    expect(approved.members[0].status).toBe('joined');
  });
});

describe('social layer', () => {
  test('friends out within 3 h (not in ghost mode), friends’ plans, open plans, share page', async () => {
    await createCheckin(t.ctx, {
      userId: pal.id,
      placeId: placeIds[0]!,
      tier: 'tag',
      at: ORIGIN,
      accuracy: 10,
      time: new Date(Date.now() - 3600_000),
      attested: false,
    });
    await createCheckin(t.ctx, {
      userId: pal2.id,
      placeId: placeIds[1]!,
      tier: 'tag',
      at: offset(ORIGIN, 400, 0),
      accuracy: 10,
      time: new Date(Date.now() - 4 * 3600_000),
      attested: false,
    });
    const s = (await call(host, 'GET', '/v1/social')).json();
    expect(s.friendsOut).toEqual([
      expect.objectContaining({
        user: expect.objectContaining({ username: 'palone' }),
        place: expect.objectContaining({ name: 'Diner' }),
      }),
    ]);
    await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: pal.headers,
      payload: { ghostMode: true },
    });
    expect((await call(host, 'GET', '/v1/social')).json().friendsOut).toEqual([]);

    const forPal2 = (await call(pal2, 'GET', '/v1/social')).json();
    expect(
      forPal2.friendPlans.map((f: { plan: { name: string }; action: string }) => [
        f.plan.name,
        f.action,
      ]),
    ).toEqual(expect.arrayContaining([['Open to friends', 'joined']]));
    // The student joined the first open plan, so they are busy then; this one is the next day.
    const second = await newPlan('Second open plan', 2);
    await call(host, 'POST', `/v1/plans/${second.id}/save`, { visibility: 'find' });
    const forStudent = (await call(student, 'GET', '/v1/social')).json();
    expect(
      forStudent.openPlans.map((o: { plan: { name: string }; action: string }) => [
        o.plan.name,
        o.action,
      ]),
    ).toEqual([['Second open plan', 'request']]);
    expect(
      forStudent.friendPlans.map((f: { plan: { name: string }; action: string }) => [
        f.plan.name,
        f.action,
      ]),
    ).toEqual([['Open plan', 'joined']]);
    const far = `${offset(ORIGIN, 5000, 5000).lng},${offset(ORIGIN, 5000, 5000).lat},${offset(ORIGIN, 6000, 6000).lng},${offset(ORIGIN, 6000, 6000).lat}`;
    expect(
      (
        await t.app.inject({ url: '/v1/social', query: { bbox: far }, headers: student.headers })
      ).json().openPlans,
    ).toEqual([]);

    const plan = (await call(host, 'GET', '/v1/plans?scope=upcoming')).json().items[0];
    const share = await t.app.inject(`/p/${plan.shareUrl.split('/p/')[1]}`);
    expect(share.statusCode).toBe(200);
    expect(share.body).toContain('Diner');
  });

  test('Social map lines: planned dotted, under way mixed, completed solid; the place they are at blinks', async () => {
    const walker = await devLogin(t.app, 'walker');
    await befriend(host.id, walker.id);
    const make = async (name: string) => {
      const p = (
        await call(walker, 'POST', '/v1/plans', {
          name,
          startAt: new Date(Date.now() + 3600_000).toISOString(),
          stops: placeIds.map((placeId) => ({ placeId })),
        })
      ).json();
      await call(walker, 'POST', `/v1/plans/${p.id}/save`, { visibility: 'friends' });
      return p.id as string;
    };
    const planned = await make('Later walk');
    const today = await make('Walk now');
    const done = await make('Yesterday walk');
    const coll = t.ctx.db.collection<{ _id: string }>('plans');
    await coll.updateOne(
      { _id: done },
      { $set: { status: 'completed', completedAt: new Date(), 'stops.0.done': true } },
    );

    // Walker starts today's plan and checks in at the first stop two hours ago (beyond the hour).
    const s = (await call(walker, 'POST', '/v1/sessions', { planId: today })).json();
    await createCheckin(t.ctx, {
      userId: walker.id,
      placeId: placeIds[0]!,
      tier: 'tag',
      at: ORIGIN,
      accuracy: 10,
      time: new Date(Date.now() - 2 * 3600_000),
      attested: false,
      sessionId: s.session.id,
    });
    const social = async () => (await call(host, 'GET', '/v1/social')).json();
    type Route = { planId: string; line: unknown[] };
    const byPlan = (r: { routes: Route[] }): Record<string, Route> =>
      Object.fromEntries(r.routes.map((x) => [x.planId, x]));
    let r = await social();
    expect(byPlan(r)[planned]).toMatchObject({
      status: 'planned',
      style: 'dotted',
      doneThrough: 0,
    });
    expect(byPlan(r)[planned]!.line).toHaveLength(2);
    expect(byPlan(r)[today]).toMatchObject({ status: 'active', style: 'mixed', doneThrough: 1 });
    expect(byPlan(r)[done]).toMatchObject({ status: 'completed', style: 'solid', doneThrough: 1 });
    expect(byPlan(r)[done]!.line).toEqual([ORIGIN]); // only where they checked in, never a trace
    // Still on the outing: that check-in blinks, though it is two hours old.
    expect(
      r.friendsOut.find((f: { user: { id: string } }) => f.user.id === walker.id),
    ).toMatchObject({ active: true, place: { id: placeIds[0] } });

    await call(walker, 'POST', `/v1/sessions/${s.session.id}/end`, {});
    r = await social();
    expect(r.friendsOut.find((f: { user: { id: string } }) => f.user.id === walker.id).active).toBe(
      false,
    );

    // Ghost mode hides where they went (the completed line), not the plans they chose to share.
    await call(walker, 'PATCH' as never, '/v1/me', { ghostMode: true });
    r = await social();
    expect(byPlan(r)[done]).toBeUndefined();
    expect(byPlan(r)[planned]).toBeDefined();
  });
});

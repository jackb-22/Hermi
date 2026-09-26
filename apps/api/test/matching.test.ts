import { TAG_DIMS, type Tag, tagIndex } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createCheckin } from '../src/services/checkins.ts';
import { findMatches, matchNotify } from '../src/services/matching.ts';
import { plans } from '../src/services/plans.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
type Login = Awaited<ReturnType<typeof devLogin>>;
let host: Login;
const who: Record<string, Login> = {};
let pizza: string;
let park: string;
let bar: string;
let farPlace: string;

const vec = (tags: Tag[]) => {
  const v = new Array<number>(TAG_DIMS).fill(0);
  for (const x of tags) v[tagIndex(x)] = 1 / Math.sqrt(tags.length);
  return v;
};
const set = (id: string, fields: object) =>
  t.ctx.db.collection('users').updateOne({ _id: id } as never, { $set: fields });
const matchable = {
  verifiedAt: new Date(),
  campus: 'Columbia',
  openToPlans: true,
  prefVector: vec(['pizza', 'park']),
};
const call = (u: Login, method: 'GET' | 'POST', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: u.headers, payload });
const tomorrow = (h = 0) => new Date(Date.now() + 86_400_000 + h * 3600_000).toISOString();

beforeAll(async () => {
  t = await setupTestApp();
  const docs = await insertPlaces(t.ctx.db, [
    placeDoc({ name: 'Pizza Spot', category: 'food', tags: ['pizza'], at: ORIGIN }),
    placeDoc({
      name: 'Green Park',
      category: 'nature',
      tags: ['park'],
      at: offset(ORIGIN, 500, 0),
    }),
    placeDoc({
      name: 'Late Bar',
      category: 'drinks',
      tags: ['cocktails'],
      at: offset(ORIGIN, 300, 0),
      adultOnly: true,
    }),
    placeDoc({ name: 'Far Diner', category: 'food', tags: ['pizza'], at: offset(ORIGIN, 5000, 0) }),
  ]);
  [pizza, park, bar, farPlace] = docs.map((d) => d._id) as [string, string, string, string];
  host = await devLogin(t.app, 'openhost');
  await set(host.id, { verifiedAt: new Date(), campus: 'Columbia' });
  for (const name of [
    'good',
    'othercampus',
    'faraway',
    'closed',
    'hatesfood',
    'blocked',
    'busy',
    'clubber',
    'young',
  ])
    who[name] = await devLogin(t.app, `m_${name}`);
  await set(who.good!.id, { ...matchable, is21: true });
  await set(who.othercampus!.id, { ...matchable, campus: 'NYU' });
  await set(who.faraway!.id, matchable);
  await set(who.closed!.id, { ...matchable, openToPlans: false });
  await set(who.hatesfood!.id, { ...matchable, dislikes: { categories: ['food'], tags: [] } });
  await set(who.blocked!.id, matchable);
  await set(who.busy!.id, matchable);
  await set(who.clubber!.id, { ...matchable, prefVector: vec(['club']) });
  await set(who.young!.id, { ...matchable, is21: false });
  // Last seen 5 km away.
  await createCheckin(t.ctx, {
    userId: who.faraway!.id,
    placeId: farPlace,
    tier: 'tag',
    at: offset(ORIGIN, 5000, 0),
    accuracy: 10,
    time: new Date(Date.now() - 3600_000),
    attested: false,
  });
  await t.ctx.db
    .collection('blocks')
    .insertOne({ blocker: who.blocked!.id, blocked: host.id, createdAt: new Date() });
  // Busy: hosts their own plan at the same time.
  const own = (
    await call(who.busy!, 'POST', '/v1/plans', { startAt: tomorrow(), stops: [{ placeId: park }] })
  ).json();
  await t.ctx.db.collection('plans').updateOne({ _id: own.id }, { $set: { status: 'planned' } });
});
afterAll(() => t.teardown());

const openPlan = async (stops: string[], startAt = tomorrow()) => {
  const p = (
    await call(host, 'POST', '/v1/plans', {
      name: 'Open pizza walk',
      startAt,
      stops: stops.map((placeId) => ({ placeId })),
    })
  ).json();
  expect(
    (await call(host, 'POST', `/v1/plans/${p.id}/save`, { visibility: 'find' })).statusCode,
  ).toBe(200);
  return p.id as string;
};

describe('Find someone', () => {
  test('only the student who passes every hard filter matches', async () => {
    const id = await openPlan([pizza, park]);
    const plan = (await plans(t.ctx.db).findOne({ _id: id }))!;
    // No 21+ stop here, so the under-21 student matches too; every other candidate fails one hard filter.
    expect((await findMatches(t.ctx, plan)).map((m) => m.userId).sort()).toEqual(
      [who.good!.id, who.young!.id].sort(),
    );
  });

  test('the match job pushes new matches once and records the count for the host', async () => {
    const id = await openPlan([pizza, park], tomorrow(4));
    const job = await t.ctx.db
      .collection('jobs')
      .findOne({ type: 'match_notify', 'payload.planId': id });
    expect(job).toBeTruthy();
    const pushes = () =>
      t.ctx.db
        .collection('jobs')
        .find({
          type: 'push',
          'payload.msg.data.kind': 'plan_match',
          'payload.msg.data.planId': id,
        })
        .toArray();
    await matchNotify(t.ctx, { planId: id });
    await matchNotify(t.ctx, { planId: id });
    const sent = await pushes();
    expect(sent).toHaveLength(1);
    // Four hours later the "busy" student is free, so they match this one.
    expect((sent[0]!.payload.userIds as string[]).sort()).toEqual(
      [who.good!.id, who.young!.id, who.busy!.id].sort(),
    );
    expect((await call(host, 'GET', `/v1/plans/${id}`)).json().matchCount).toBe(3);
    expect((await call(who.good!, 'GET', `/v1/plans/${id}`)).json().matchCount).toBeNull();
  });

  test('open plans show on the map and in the request flow only for matches', async () => {
    const id = await openPlan([pizza], tomorrow(8));
    const social = async (u: Login) =>
      (await call(u, 'GET', '/v1/social'))
        .json()
        .openPlans.map((o: { plan: { id: string } }) => o.plan.id);
    expect(await social(who.good!)).toContain(id);
    expect(await social(who.othercampus!)).not.toContain(id);
    expect(await social(who.hatesfood!)).not.toContain(id);
    expect((await call(who.othercampus!, 'GET', `/v1/plans/${id}`)).statusCode).toBe(404);
    expect((await call(who.othercampus!, 'POST', `/v1/plans/${id}/request`)).statusCode).toBe(403);
    expect((await call(who.good!, 'POST', `/v1/plans/${id}/request`)).statusCode).toBe(200);
    // Still under open plans for the requester, now marked requested (not as a joinable friend plan).
    const after = (await call(who.good!, 'GET', '/v1/social')).json();
    expect(after.openPlans.find((o: { plan: { id: string } }) => o.plan.id === id)?.action).toBe(
      'requested',
    );
    expect(after.friendPlans.map((f: { plan: { id: string } }) => f.plan.id)).not.toContain(id);
  });

  test('21+ stops match only students who are 21+', async () => {
    const id = await openPlan([bar, pizza], tomorrow(12));
    const plan = (await plans(t.ctx.db).findOne({ _id: id }))!;
    const ids = (await findMatches(t.ctx, plan)).map((m) => m.userId);
    expect(ids).toContain(who.good!.id);
    expect(ids).not.toContain(who.young!.id);
  });
});

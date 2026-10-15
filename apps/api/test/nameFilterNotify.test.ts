import { haversineM, weekIndex } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { handlers } from '../src/jobs/handlers.ts';
import { Worker } from '../src/jobs/queue.ts';
import { FakeMessenger } from '../src/providers/messenger.ts';
import type { FakePush } from '../src/providers/push.ts';
import { createCheckin } from '../src/services/checkins.ts';
import { startGroupChat } from '../src/services/groupChat.ts';
import { nudgeFor } from '../src/services/nudges.ts';
import { pairKey } from '../src/services/social.ts';
import { getUser } from '../src/services/users.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

/**
 * Names saved before the name filter (or Apple's) may be bad, and they are printed in pushes and texts to other
 * people. Each case sets the stored name straight in the database, which skips the filter, as an old account would.
 */
let t: Awaited<ReturnType<typeof setupTestApp>>;
let fake: FakeMessenger;
let worker: Worker;
type Login = Awaited<ReturnType<typeof devLogin>>;
let placeIds: string[];

const HOST_DEVICE = 'a'.repeat(64);
const PAL_DEVICE = 'b'.repeat(64);

const setNames = (u: Login, fields: { name?: string; username?: string }) =>
  t.ctx.db.collection('users').updateOne({ _id: u.id } as never, { $set: fields });
const call = (who: Login, method: 'POST' | 'GET', url: string, payload?: object) =>
  t.app.inject({ method, url: `/v1${url}`, headers: who.headers, payload });
const befriend = (x: Login, y: Login, streak = 1, lastWeek = 0) =>
  t.ctx.db.collection('friendships').insertOne({
    _id: pairKey(x.id, y.id) as never,
    a: x.id < y.id ? x.id : y.id,
    b: x.id < y.id ? y.id : x.id,
    since: new Date(),
    hangouts: streak,
    streakWeeks: streak,
    lastHangoutWeek: lastWeek,
  });
const lastPushTitle = (device: string) =>
  (t.ctx.providers.push as FakePush).sent.filter((s) => s.tokens.includes(device)).at(-1)?.msg
    .title;

beforeAll(async () => {
  t = await setupTestApp({
    SPECTRUM_PROJECT_ID: 'p',
    SPECTRUM_PROJECT_SECRET: 's',
    PHOTON_AGENT_ADDRESS: '+15550001234',
  });
  fake = new FakeMessenger();
  t.ctx.providers.messenger = fake;
  t.ctx.providers.eta = {
    name: 'stub',
    eta: async (o, d) => ({
      minutes: Math.max(1, Math.round(haversineM(o, d) / 80)),
      source: 'google',
    }),
  };
  startGroupChat(t.ctx);
  worker = new Worker(t.ctx, handlers, { info: () => {}, error: (o) => console.error(o) });
  placeIds = (
    await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Hungarian Pastry Shop', category: 'food', at: ORIGIN }),
      placeDoc({ name: 'Riverside Park', category: 'nature', at: offset(ORIGIN, 600, -500) }),
      placeDoc({ name: 'Movement Harlem', category: 'sports', at: offset(ORIGIN, 2400, 900) }),
    ])
  ).map((p) => p._id);
});
afterAll(() => t.teardown());

describe('pushes', () => {
  let host: Login;
  let pal: Login;
  const startsIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const newPlan = async (days: number, name: string) =>
    (
      await call(host, 'POST', '/plans', {
        name,
        startAt: startsIn(days),
        stops: placeIds.slice(0, 2).map((placeId) => ({ placeId })),
      })
    ).json();

  beforeAll(async () => {
    host = await devLogin(t.app, 'pushhost');
    pal = await devLogin(t.app, 'pushpal');
    await befriend(host, pal);
    await call(host, 'POST', '/me/push-token', { token: HOST_DEVICE });
    await call(pal, 'POST', '/me/push-token', { token: PAL_DEVICE });
  });

  // The cases: a good name; a name that passes for staff (the @username is used); a bad name and a bad username.
  const cases = [
    [{ name: 'Maya Chen' }, 'Maya Chen'],
    [{ name: 'Hermi Support' }, '@pushhost'],
    [{ name: 'Fuck Face', username: 'fuck_1' }, 'A friend'],
  ] as const;

  test('"X invited you" uses a name that passes', async () => {
    for (const [i, [fields, shown]] of cases.entries()) {
      await setNames(host, { username: 'pushhost', ...fields });
      const p = await newPlan(i + 1, `Invite ${i}`);
      await call(host, 'POST', `/plans/${p.id}/save`, {
        name: `Invite ${i}`,
        visibility: 'invite',
        inviteeIds: [pal.id],
      });
      await worker.drain();
      expect(lastPushTitle(PAL_DEVICE), JSON.stringify(fields)).toBe(`${shown} invited you`);
    }
  });

  test('"X is in" uses a name that passes', async () => {
    await setNames(host, { name: 'Jack', username: 'pushhost' });
    const joiners: [{ name: string; username?: string }, string][] = [
      [{ name: 'Maya Chen' }, 'Maya Chen'],
      [{ name: 'Hermi Support' }, '@pushpal'],
      [{ name: 'Fuck Face', username: 'fuck_2' }, 'Someone'],
    ];
    for (const [i, [fields, shown]] of joiners.entries()) {
      await setNames(pal, { username: 'pushpal', ...fields });
      const p = await newPlan(i + 5, `Join ${i}`);
      await call(host, 'POST', `/plans/${p.id}/save`, {
        name: `Join ${i}`,
        visibility: 'invite',
        inviteeIds: [pal.id],
      });
      await call(pal, 'POST', `/plans/${p.id}/join`, {});
      await worker.drain();
      expect(lastPushTitle(HOST_DEVICE), JSON.stringify(fields)).toBe(`${shown} is in`);
    }
  });
});

describe('weekly streak nudge', () => {
  test('names the friend by first name when it passes, else @username, else "your friend"', async () => {
    const me = await devLogin(t.app, 'nudger');
    const friend = await devLogin(t.app, 'nudgee');
    await befriend(me, friend, 8, weekIndex(t.ctx.clock.now()) - 1);
    const title = async (fields: { name: string; username?: string }) => {
      await setNames(friend, { username: 'nudgee', ...fields });
      return (await nudgeFor(t.ctx, await getUser(t.ctx.db, me.id)))?.title;
    };
    expect(await title({ name: 'Maya Chen' })).toBe('Your 8-week streak with Maya ends Sunday');
    // "Hermi" alone would pass for the app, though "Hermi Patel" as a whole is a person
    expect(await title({ name: 'Hermi Patel' })).toBe(
      'Your 8-week streak with @nudgee ends Sunday',
    );
    expect(await title({ name: 'Fuck Face' })).toBe('Your 8-week streak with @nudgee ends Sunday');
    expect(await title({ name: 'Fuck Face', username: 'fuck_3' })).toBe(
      'Your 8-week streak with your friend ends Sunday',
    );
  });
});

describe('iMessage', () => {
  test('"Linked to" prefers @username when it passes, else the name, else "you"', async () => {
    const dm = (from: string, text: string) =>
      fake.receive({ spaceId: `dm:${from}`, group: false, text, senderId: from });
    const code = async (u: Login) => (await call(u, 'POST', '/me/imessage/link-code')).json().code;
    const [one, two, three] = [
      await devLogin(t.app, 'linkone'),
      await devLogin(t.app, 'linktwo'),
      await devLogin(t.app, 'linkthree'),
    ];
    await setNames(one, { name: 'Ava Stone' });
    await dm('+12125550101', `link ${await code(one)}`);
    expect(fake.sent.at(-1)?.text).toMatch(/^Linked to @linkone ✅/);
    await setNames(two, { name: 'Ava Stone', username: 'fuck_4' });
    await dm('+12125550102', `link ${await code(two)}`);
    expect(fake.sent.at(-1)?.text).toMatch(/^Linked to Ava Stone ✅/);
    await setNames(three, { name: 'Fuck Face', username: 'fuck_5' });
    await dm('+12125550103', `link ${await code(three)}`);
    expect(fake.sent.at(-1)?.text).toMatch(/^Linked to you ✅/);
  });

  test('the check-in line in a plan thread names the person with a name that passes', async () => {
    const host = await devLogin(t.app, 'threadhost');
    const plan = (
      await call(host, 'POST', '/plans', {
        name: 'Thread plan',
        stops: placeIds.map((placeId) => ({ placeId })),
      })
    ).json();
    await fake.receive({
      spaceId: 'grp-names',
      group: true,
      text: plan.textGroup.body,
      senderId: '+15551110000',
    });
    const s = (await call(host, 'POST', '/sessions', { planId: plan.id })).json();
    const checkIn = async (placeId: string, at: { lat: number; lng: number }) =>
      createCheckin(t.ctx, {
        userId: host.id,
        placeId,
        tier: 'tag',
        at,
        accuracy: 10,
        time: t.ctx.clock.now(),
        attested: true,
        sessionId: s.id,
      });
    const stops = [ORIGIN, offset(ORIGIN, 600, -500), offset(ORIGIN, 2400, 900)];
    const cases = [
      [{ name: 'Maya Chen', username: 'threadhost' }, 'Maya Chen'],
      [{ name: 'Admin' }, '@threadhost'],
      [{ name: 'Fuck Face', username: 'fuck_6' }, 'Someone'],
    ] as const;
    for (const [i, [fields, shown]] of cases.entries()) {
      await setNames(host, fields);
      await checkIn(placeIds[i]!, stops[i]!);
      expect(fake.sent.at(-1)?.text, JSON.stringify(fields)).toMatch(
        new RegExp(`^✅ ${shown} checked in at `),
      );
    }
  });

  test('"Invited ..." in the reply to a texted plan names the friend with a name that passes', async () => {
    const [ava, ben] = [await devLogin(t.app, 'textava'), await devLogin(t.app, 'textben')];
    await befriend(ava, ben);
    await t.app.inject({
      method: 'POST',
      url: '/v1/dev/imessage/link',
      payload: { username: 'textava', handle: '+12125550777' },
    });
    const ask = async () => {
      await fake.receive({
        spaceId: 'dm:+12125550777',
        group: false,
        text: 'tomorrow 5pm Riverside Park then Movement Harlem with textben',
        senderId: '+12125550777',
      });
      return fake.sent.at(-1)?.text ?? '';
    };
    await setNames(ben, { name: 'Ben Okafor' });
    expect(await ask()).toMatch(/Invited Ben Okafor: they'll see it in Hermi\./);
    await setNames(ben, { name: 'Official Hermi' });
    expect(await ask()).toMatch(/Invited @textben: they'll see it in Hermi\./);
  });
});

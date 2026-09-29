import { haversineM } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { nyLocal } from '../src/domain/weatherDay.ts';
import { FakeMessenger } from '../src/providers/messenger.ts';
import { startGroupChat } from '../src/services/groupChat.ts';
import { pairKey } from '../src/services/social.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

/** Texting Hermi a plan (DM or group chat) → your plan, spaced, with the right friends invited; "undo" reverts. */
let t: Awaited<ReturnType<typeof setupTestApp>>;
let fake: FakeMessenger;
type Login = Awaited<ReturnType<typeof devLogin>>;
let ava: Login;
let ben: Login;
const PHONE = { ava: '+12125550001', ben: '+12125550002', zed: '+12125550009' };
const id: Record<string, string> = {};

beforeAll(async () => {
  t = await setupTestApp({ SPECTRUM_PROJECT_ID: 'p', SPECTRUM_PROJECT_SECRET: 's' });
  fake = new FakeMessenger();
  t.ctx.providers.messenger = fake;
  t.ctx.providers.eta = {
    name: 'stub',
    eta: async (o, d, mode) => ({
      minutes: Math.max(
        1,
        Math.round(mode === 'transit' ? 8 + haversineM(o, d) / 400 : haversineM(o, d) / 80),
      ),
      source: 'google',
    }),
  };
  startGroupChat(t.ctx);
  for (const d of await insertPlaces(t.ctx.db, [
    placeDoc({
      name: 'Hungarian Pastry Shop',
      category: 'food',
      tags: ['bakery', 'coffee'],
      at: ORIGIN,
    }),
    placeDoc({
      name: 'Riverside Park',
      category: 'nature',
      tags: ['park'],
      at: offset(ORIGIN, 600, -500),
    }),
    placeDoc({
      name: 'Movement Harlem',
      category: 'sports',
      tags: ['climbing'],
      at: offset(ORIGIN, 2400, 900),
    }),
  ]))
    id[d.name] = d._id;
  ava = await devLogin(t.app, 'ava');
  ben = await devLogin(t.app, 'ben');
  const jenny = await devLogin(t.app, 'jenny');
  await devLogin(t.app, 'zed');
  for (const [u, name] of [
    [ava, 'Ava'],
    [ben, 'Ben'],
    [jenny, 'Jenny Park'],
  ] as const)
    await t.app.inject({ method: 'PATCH', url: '/v1/me', headers: u.headers, payload: { name } });
  for (const friend of [ben, jenny])
    await t.ctx.db.collection('friendships').insertOne({
      _id: pairKey(ava.id, friend.id) as never,
      a: ava.id < friend.id ? ava.id : friend.id,
      b: ava.id < friend.id ? friend.id : ava.id,
      since: new Date(),
      hangouts: 1,
      streakWeeks: 1,
      lastHangoutWeek: 0,
    });
  for (const [username, handle] of Object.entries(PHONE))
    await t.app.inject({
      method: 'POST',
      url: '/v1/dev/imessage/link',
      payload: { username, handle },
    });
});
afterAll(() => t.teardown());

const dm = (from: string, text: string) =>
  fake.receive({ spaceId: `dm:${from}`, group: false, text, senderId: from });
const lastTo = (spaceId: string) =>
  fake.sent.filter((s) => s.spaceId === spaceId).at(-1)?.text ?? '';
const myPlans = async (u: Login) =>
  (await t.app.inject({ method: 'GET', url: '/v1/plans?scope=all', headers: u.headers })).json()
    .items as {
    id: string;
    status: string;
    visibility: string;
    startAt: string;
    stops: {
      place: { name: string };
      arriveAt: string;
      departAt: string;
      legMin: number | null;
      legMode: string | null;
    }[];
    members: { userId: string; status: string }[];
    imessageThreadId?: string;
  }[];
const names = (p: { stops: { place: { name: string } }[] }) => p.stops.map((s) => s.place.name);

describe('texting Hermi a plan', () => {
  test('an unknown number is told how to link', async () => {
    await dm('+19175550100', 'Sat: Hungarian Pastry Shop');
    expect(lastTo('dm:+19175550100')).toMatch(/^I don't know this number yet/);
  });

  test('a DM plan replaces My Plan, at the time asked, spaced by travel; undo puts the old draft back', async () => {
    await t.app.inject({
      method: 'POST',
      url: '/v1/plans',
      headers: ava.headers,
      payload: { stops: [{ placeId: id['Movement Harlem'] }] },
    });
    await dm(PHONE.ava, 'tomorrow 2pm: Hungarian Pastry Shop, then Riverside Park');
    const reply = lastTo(`dm:${PHONE.ava}`);
    expect(reply).toMatch(/1\. Hungarian Pastry Shop · 2:00 PM/);
    expect(reply).toMatch(/↓ walk \d+ min\n2\. Riverside Park/);
    expect(reply).toMatch(/Reply "undo"/);

    const drafts = (await myPlans(ava)).filter((p) => p.status === 'draft');
    expect(drafts).toHaveLength(1);
    const plan = drafts[0]!;
    expect(names(plan)).toEqual(['Hungarian Pastry Shop', 'Riverside Park']);
    const start = nyLocal(new Date(plan.startAt));
    expect(start).toMatchObject({ hour: 14, minute: 0 });
    expect(start.date).toBe(nyLocal(new Date(t.ctx.clock.now().getTime() + 86_400_000)).date);
    const [a, b] = plan.stops;
    expect(Date.parse(b!.arriveAt) - Date.parse(a!.departAt)).toBe(b!.legMin! * 60_000);

    await dm(PHONE.ava, 'undo');
    expect(lastTo(`dm:${PHONE.ava}`)).toBe('Done: your plan is back to how it was.');
    expect(names((await myPlans(ava)).find((p) => p.status === 'draft')!)).toEqual([
      'Movement Harlem',
    ]);
    await dm(PHONE.ava, 'undo');
    expect(lastTo(`dm:${PHONE.ava}`)).toBe('Nothing to undo.');
  });

  test('named friends are invited (the plan is saved so they see it); others are listed', async () => {
    await dm(PHONE.ava, 'tomorrow 5pm Riverside Park then Movement Harlem with ben, Jenny and zed');
    const reply = lastTo(`dm:${PHONE.ava}`);
    expect(reply).toMatch(/Invited Ben, Jenny Park: they'll see it in Hermi\./);
    expect(reply).toMatch(/Not your Hermi friends yet: zed\./);
    const plan = (await myPlans(ava)).find(
      (p) => names(p).join() === 'Riverside Park,Movement Harlem',
    )!;
    expect(plan).toMatchObject({ status: 'planned', visibility: 'invite' });
    expect(plan.members.map((m) => m.status)).toEqual(['invited', 'invited']);
    // Ben sees the invitation.
    const social = (
      await t.app.inject({ method: 'GET', url: '/v1/social', headers: ben.headers })
    ).json();
    expect(
      social.friendPlans.map((p: { plan: { id: string }; action: string }) => [
        p.plan.id,
        p.action,
      ]),
    ).toContainEqual([plan.id, 'invited']);
  });

  test('a text with no plan in it gets the how-to', async () => {
    await dm(PHONE.ava, 'hey what can you do');
    expect(lastTo(`dm:${PHONE.ava}`)).toMatch(/^Text me a plan/);
  });
});

describe('in a group chat', () => {
  const g = 'group:weekend';
  const say = (from: string, text: string) =>
    fake.receive({ spaceId: g, group: true, text, senderId: from });

  test('Hermi stays quiet until named, then plans from the chat and invites the friends in it', async () => {
    fake.groups.set(g, [PHONE.ava, PHONE.ben, PHONE.zed]);
    const before = fake.sent.length;
    await say(PHONE.ben, 'we should do Hungarian Pastry Shop tomorrow at 11am');
    await say(PHONE.zed, 'then Riverside Park after?');
    expect(fake.sent.length).toBe(before);

    await say(PHONE.ava, 'hermi plan this');
    const reply = lastTo(g);
    expect(reply).toMatch(/1\. Hungarian Pastry Shop · 11:00 AM/);
    expect(reply).toMatch(/2\. Riverside Park/);
    expect(reply).toMatch(/Invited Ben/);
    const plan = (await myPlans(ava)).find(
      (p) => p.status === 'planned' && names(p)[0] === 'Hungarian Pastry Shop',
    )!;
    expect(plan.members).toEqual([expect.objectContaining({ userId: ben.id, status: 'invited' })]);
    // The group now follows the plan: "in" counts heads there.
    await say(PHONE.ben, "I'm in");
    expect(lastTo(g)).toMatch(/^1 in so far/);
  });

  test('a stranger in the group cannot plan for anyone', async () => {
    await say('+13475550123', 'hermi plan Riverside Park');
    expect(lastTo(g)).toMatch(/^I don't know this number yet/);
  });
});

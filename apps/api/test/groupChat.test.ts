import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { finalizeSession } from '../src/jobs/finalizeSession.ts';
import { FakeMessenger } from '../src/providers/messenger.ts';
import { createCheckin } from '../src/services/checkins.ts';
import { startGroupChat } from '../src/services/groupChat.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
let host: Awaited<ReturnType<typeof devLogin>>;
let fake: FakeMessenger;
let cafe: string;
let park: string;

beforeAll(async () => {
  t = await setupTestApp({
    SPECTRUM_PROJECT_ID: 'proj',
    SPECTRUM_PROJECT_SECRET: 'secret',
    PHOTON_AGENT_ADDRESS: '+15550001234',
  });
  fake = new FakeMessenger();
  t.ctx.providers.messenger = fake;
  startGroupChat(t.ctx);
  [cafe, park] = (
    await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Corner Cafe', category: 'food', at: ORIGIN }),
      placeDoc({ name: 'Green Park', category: 'nature', at: offset(ORIGIN, 400, 0) }),
    ])
  ).map((p) => p._id) as [string, string];
  host = await devLogin(t.app, 'grouphost');
  await t.app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: host.headers,
    payload: { name: 'Maya' },
  });
});
afterAll(() => t.teardown());

const lastSent = () => fake.sent.at(-1)?.text ?? '';
const newPlan = async (name: string) =>
  (
    await t.app.inject({
      method: 'POST',
      url: '/v1/plans',
      headers: host.headers,
      payload: { name, stops: [{ placeId: cafe }, { placeId: park }] },
    })
  ).json();

describe('plan group chat (Photon)', () => {
  test('Text the group → the link binds the thread → plan card, who is in, check-ins, recap', async () => {
    const plan = await newPlan('Coffee then the park');
    expect(plan.textGroup).toMatchObject({ recipients: ['+15550001234'], bound: false });
    expect(plan.textGroup.body).toContain(plan.shareUrl);

    await fake.receive({
      spaceId: 'grp1',
      group: true,
      text: plan.textGroup.body,
      senderId: '+15551110000',
    });
    expect(lastSent()).toMatch(/^📍 Coffee then the park/);
    expect(lastSent()).toContain('1. Corner Cafe');
    expect(lastSent()).toContain("Who's in?");
    const bound = (
      await t.app.inject({ method: 'GET', url: `/v1/plans/${plan.id}`, headers: host.headers })
    ).json();
    expect(bound.textGroup.bound).toBe(true);

    await fake.receive({ spaceId: 'grp1', group: true, text: "I'm in!", senderId: '+15551110001' });
    await fake.receive({ spaceId: 'grp1', group: true, text: 'in', senderId: '+15551110002' });
    await fake.receive({ spaceId: 'grp1', group: true, text: 'in', senderId: '+15551110002' });
    expect(lastSent()).toMatch(/^2 in so far/);

    const s = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: host.headers,
        payload: { planId: plan.id },
      })
    ).json();
    await createCheckin(t.ctx, {
      userId: host.id,
      placeId: cafe,
      tier: 'tag',
      at: ORIGIN,
      accuracy: 10,
      time: t.ctx.clock.now(),
      attested: true,
      sessionId: s.id,
    });
    expect(lastSent()).toBe('✅ Maya checked in at Corner Cafe (tag tap)');

    // The worker restarted and has not heard from the thread yet: the line waits, then goes out first.
    fake.forget('grp1');
    await createCheckin(t.ctx, {
      userId: host.id,
      placeId: park,
      tier: 'tag',
      at: offset(ORIGIN, 400, 0),
      accuracy: 10,
      time: t.ctx.clock.now(),
      attested: true,
      sessionId: s.id,
    });
    expect(lastSent()).not.toContain('Green Park');
    expect(await t.ctx.db.collection('photon_outbox').countDocuments({ spaceId: 'grp1' })).toBe(1);
    await fake.receive({
      spaceId: 'grp1',
      group: true,
      text: 'where are you all',
      senderId: '+15551110001',
    });
    expect(lastSent()).toBe('✅ Maya checked in at Green Park (tag tap)');
    expect(await t.ctx.db.collection('photon_outbox').countDocuments()).toBe(0);

    await t.app.inject({
      method: 'POST',
      url: `/v1/sessions/${s.id}/end`,
      headers: host.headers,
      payload: {},
    });
    await finalizeSession(t.ctx, { sessionId: s.id });
    expect(lastSent()).toMatch(
      /^🏁 Coffee then the park is done: 2 of 2 stops checked in\. Recap: .*\/p\//,
    );
  });

  test('a new plan link rebinds the thread; unknown links get a hint; strangers never see textGroup', async () => {
    const first = await newPlan('First');
    const second = await newPlan('Second');
    await fake.receive({
      spaceId: 'grp2',
      group: true,
      text: first.textGroup.body,
      senderId: null,
    });
    await fake.receive({
      spaceId: 'grp2',
      group: true,
      text: second.textGroup.body,
      senderId: null,
    });
    expect(lastSent()).toMatch(/^📍 Second/);
    const plans = t.ctx.db.collection('plans');
    expect((await plans.findOne({ _id: first.id }))?.imessageThreadId).toBeUndefined();
    expect((await plans.findOne({ _id: second.id }))?.imessageThreadId).toBe('grp2');

    await fake.receive({
      spaceId: 'grp3',
      group: true,
      text: 'https://x.tech/p/notARealToken1',
      senderId: null,
    });
    expect(lastSent()).toMatch(/couldn't find that plan/);

    // Anyone with the share link sees the plan, but only the host gets the Text the group payload.
    const other = await devLogin(t.app, 'someoneelse');
    const seen = await t.app.inject({
      method: 'GET',
      url: `/v1/plans/by-token/${second.shareUrl.split('/p/')[1]}`,
      headers: other.headers,
    });
    expect(seen.statusCode).toBe(200);
    expect(seen.json().textGroup).toBeNull();
  });
});

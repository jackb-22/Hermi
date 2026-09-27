import { afterAll, beforeAll, expect, test } from 'vitest';
import type { AppContext } from '../src/context.ts';
import { handlers } from '../src/jobs/handlers.ts';
import { Worker } from '../src/jobs/queue.ts';
import { FakeMessenger } from '../src/providers/messenger.ts';
import { createCheckin } from '../src/services/checkins.ts';
import { startGroupChat } from '../src/services/groupChat.ts';
import { insertPlaces, ORIGIN, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
afterAll(() => t.teardown());
beforeAll(async () => {
  t = await setupTestApp({
    SPECTRUM_PROJECT_ID: 'proj',
    SPECTRUM_PROJECT_SECRET: 'secret',
    PHOTON_AGENT_ADDRESS: '+15550001234',
  });
});

test('production topology: a check-in written by the API reaches the thread through the worker', async () => {
  // The API process has the messenger configured but never runs the stream; the worker does.
  const apiSide = new FakeMessenger();
  const workerSide = new FakeMessenger();
  t.ctx.providers.messenger = apiSide;
  const worker: AppContext = {
    ...t.ctx,
    providers: { ...t.ctx.providers, messenger: workerSide },
  };
  startGroupChat(worker);

  const [cafe] = await insertPlaces(t.ctx.db, [
    placeDoc({ name: 'Corner Cafe', category: 'food', at: ORIGIN }),
  ]);
  const host = await devLogin(t.app, 'splithost');
  const plan = (
    await t.app.inject({
      method: 'POST',
      url: '/v1/plans',
      headers: host.headers,
      payload: { name: 'Split', stops: [{ placeId: cafe!._id }] },
    })
  ).json();
  // The host texted the group: the worker bound the thread and can reach it.
  await workerSide.receive({
    spaceId: 'grp9',
    group: true,
    text: plan.textGroup.body,
    senderId: null,
  });
  expect(workerSide.sent.at(-1)?.text).toMatch(/^📍 Split/);
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
    placeId: cafe!._id,
    tier: 'tag',
    at: ORIGIN,
    accuracy: 10,
    time: t.ctx.clock.now(),
    attested: true,
    sessionId: s.session.id,
  });
  expect(apiSide.sent).toEqual([]);
  await new Worker(worker, handlers).drain();
  expect(workerSide.sent.at(-1)?.text).toBe('✅ splithost checked in at Corner Cafe (tag tap)');
  expect(await t.ctx.db.collection('photon_outbox').countDocuments()).toBe(0);
});

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type AppContext, Clock } from '../src/context.ts';
import { syncDevClock } from '../src/services/devClock.ts';
import { setupTestApp } from './helpers.ts';

describe('deployment with DEV_TOKEN', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  beforeAll(async () => {
    t = await setupTestApp({ NODE_ENV: 'production', DEV_ROUTES: '1', DEV_TOKEN: 'team-secret' });
  });
  afterAll(() => t.teardown());

  test('dev login, fake Apple tokens and the dev clock need the header', async () => {
    const login = { method: 'POST' as const, url: '/v1/auth/dev', payload: { username: 'maya' } };
    expect((await t.app.inject(login)).statusCode).toBe(403);
    expect(
      (await t.app.inject({ ...login, headers: { 'x-dev-token': 'wrong-secret' } })).statusCode,
    ).toBe(403);
    const ok = await t.app.inject({ ...login, headers: { 'x-dev-token': 'team-secret' } });
    expect(ok.statusCode).toBe(200);

    const apple = {
      method: 'POST' as const,
      url: '/v1/auth/apple',
      payload: { identityToken: 'fake:someone' },
    };
    expect((await t.app.inject(apple)).statusCode).toBe(403);
    expect(
      (await t.app.inject({ ...apple, headers: { 'x-dev-token': 'team-secret' } })).statusCode,
    ).toBe(200);

    const clock = { method: 'POST' as const, url: '/v1/dev/clock', payload: { advanceMs: 1000 } };
    expect((await t.app.inject(clock)).statusCode).toBe(403);
    expect(
      (await t.app.inject({ ...clock, headers: { 'x-dev-token': 'team-secret' } })).json().offsetMs,
    ).toBe(1000);
  });

  test('.edu code is only echoed to requests carrying the token', async () => {
    const token = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/auth/dev',
        headers: { 'x-dev-token': 'team-secret' },
        payload: { username: 'eduuser' },
      })
    ).json().token;
    const body = { email: 'x@columbia.edu', gradYear: 2028 };
    const plain = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/edu',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
    expect(plain.json().devCode).toBeUndefined();
    const dev = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/edu',
      headers: { authorization: `Bearer ${token}`, 'x-dev-token': 'team-secret' },
      payload: body,
    });
    expect(dev.json().devCode).toMatch(/^\d{6}$/);
  });
});

describe('production without DEV_TOKEN', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  beforeAll(async () => {
    t = await setupTestApp({ NODE_ENV: 'production', DEV_ROUTES: '1' });
  });
  afterAll(() => t.teardown());

  test('dev routes are refused outright', async () => {
    expect(
      (await t.app.inject({ method: 'POST', url: '/v1/auth/dev', payload: { username: 'maya' } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await t.app.inject({ method: 'POST', url: '/v1/dev/clock', payload: { reset: true } }))
        .statusCode,
    ).toBe(403);
  });
});

describe('dev clock across processes', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(() => t.teardown());

  test('the worker follows the clock the API shifted, so jobs see the same time', async () => {
    const worker: AppContext = { ...t.ctx, clock: new Clock() };
    await t.app.inject({ method: 'POST', url: '/v1/dev/clock', payload: { advanceMs: 7_200_000 } });
    expect(worker.clock.offsetMs).toBe(0);
    await syncDevClock(worker);
    expect(worker.clock.offsetMs).toBe(7_200_000);
    await t.app.inject({ method: 'POST', url: '/v1/dev/clock', payload: { reset: true } });
    await syncDevClock(worker);
    expect(worker.clock.offsetMs).toBe(0);
  });
});

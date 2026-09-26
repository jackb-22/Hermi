import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { campusFor } from '../src/routes/auth.ts';
import { studentStatus } from '../src/services/users.ts';
import { devLogin, setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.teardown());

describe('sign in', () => {
  test('apple (fake verifier) creates once, then signs in', async () => {
    const a = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: { identityToken: 'fake:apple-sub-1', name: 'Ada' },
    });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ isNew: true, user: { name: 'Ada', verified: false } });
    const b = await t.app.inject({
      method: 'POST',
      url: '/auth/apple',
      payload: { identityToken: 'fake:apple-sub-1' },
    });
    expect(b.json()).toMatchObject({ isNew: false, user: { id: a.json().user.id } });
  });

  test('bad apple token is 401 envelope', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: { identityToken: 'garbage-token' },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('UNAUTHORIZED');
  });

  test('schema violation is 400 envelope', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/dev',
      payload: { username: 'NO SPACES' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('BAD_REQUEST');
  });

  test('/me requires a token', async () => {
    const r = await t.app.inject('/v1/me');
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('UNAUTHORIZED');
  });
});

describe('me', () => {
  test('patch profile, username conflict is 409 USERNAME_TAKEN', async () => {
    const a = await devLogin(t.app, 'alice');
    await devLogin(t.app, 'bob');
    const ok = await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: a.headers,
      payload: { name: 'Alice A', ghostMode: true, junk: 1 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ name: 'Alice A', ghostMode: true, username: 'alice' });
    const dup = await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: a.headers,
      payload: { username: 'bob' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('USERNAME_TAKEN');
  });
});

describe('edu verification', () => {
  test('non-edu rejected', async () => {
    const u = await devLogin(t.app, 'carol');
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/edu',
      headers: u.headers,
      payload: { email: 'c@gmail.com', gradYear: 2028 },
    });
    expect(r.json().error.code).toBe('EDU_DOMAIN_NOT_ALLOWED');
  });

  test('wrong code, then right code verifies with campus and status', async () => {
    const u = await devLogin(t.app, 'dan');
    const start = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/edu',
      headers: u.headers,
      payload: { email: 'dan@columbia.edu', gradYear: 2028 },
    });
    expect(start.json()).toMatchObject({ sent: true, campus: 'Columbia' });
    const code: string = start.json().devCode;
    const wrong = code === '000000' ? '000001' : '000000';
    const bad = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/edu/verify',
      headers: u.headers,
      payload: { code: wrong },
    });
    expect(bad.json().error.code).toBe('EDU_CODE_INVALID');
    const good = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/edu/verify',
      headers: u.headers,
      payload: { code },
    });
    expect(good.json()).toMatchObject({
      verified: true,
      campus: 'Columbia',
      gradYear: 2028,
      studentStatus: 'current',
    });
  });

  test('attempts cap and expiry', async () => {
    const u = await devLogin(t.app, 'erin');
    const start = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/edu',
      headers: u.headers,
      payload: { email: 'e@barnard.edu', gradYear: 2027 },
    });
    const code: string = start.json().devCode;
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++)
      await t.app.inject({
        method: 'POST',
        url: '/v1/auth/edu/verify',
        headers: u.headers,
        payload: { code: wrong },
      });
    const locked = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/edu/verify',
      headers: u.headers,
      payload: { code },
    });
    expect(locked.json().error.code).toBe('EDU_CODE_EXPIRED');

    const again = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/edu',
      headers: u.headers,
      payload: { email: 'e@barnard.edu', gradYear: 2027 },
    });
    t.ctx.clock.offsetMs = 11 * 60_000;
    const late = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/edu/verify',
      headers: u.headers,
      payload: { code: again.json().devCode },
    });
    t.ctx.clock.offsetMs = 0;
    expect(late.json().error.code).toBe('EDU_CODE_EXPIRED');
  });

  test('campus naming and alumni flip', () => {
    expect(campusFor('x@cs.columbia.edu')).toBe('Columbia');
    expect(campusFor('x@mit.edu')).toBe('Mit');
    expect(campusFor('x@gmail.com')).toBeNull();
    const v = { verifiedAt: new Date(), gradYear: 2026 };
    expect(studentStatus(v, new Date('2026-05-20T12:00:00Z'))).toBe('current');
    expect(studentStatus(v, new Date('2026-06-02T12:00:00Z'))).toBe('alumni');
  });
});

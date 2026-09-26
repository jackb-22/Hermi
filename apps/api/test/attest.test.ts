import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { attestGuard } from '../src/plugins/attest.ts';
import { requireAuth } from '../src/plugins/auth.ts';
import type { AppAttestVerifier } from '../src/providers/appAttest.ts';
import { hit } from '../src/services/rateLimit.ts';
import { devLogin, setupTestApp } from './helpers.ts';

/** Stub verifier: assertion bytes "ok:<n>" are valid with signCount n, and must sign the exact body. */
const stub: AppAttestVerifier = {
  name: 'stub',
  attestation: ({ attestation }) => {
    if (attestation.toString() !== 'good-attestation') throw new Error('bad attestation');
    return { publicKey: 'PUB' };
  },
  assertion: ({ assertion, payload }) => {
    const [ok, n, body] = assertion.toString().split('|');
    if (ok !== 'ok' || body !== String(payload)) throw new Error('bad assertion');
    return { signCount: Number(n) };
  },
};

const echo = (app: FastifyInstance) =>
  app.post('/test/guarded', { preHandler: [requireAuth, attestGuard] }, async (req) => ({ attested: req.attested }));

const header = (keyId: string, assertion: string) => Buffer.from(JSON.stringify({ keyId, assertion: Buffer.from(assertion).toString('base64') })).toString('base64');

describe.each(['log', 'enforce'] as const)('ATTEST_MODE=%s', (mode) => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let u: Awaited<ReturnType<typeof devLogin>>;
  beforeAll(async () => {
    t = await setupTestApp({ ATTEST_MODE: mode }, echo);
    t.ctx.providers.appAttest = stub;
    u = await devLogin(t.app, 'attester');
    const ch = (await t.app.inject({ url: '/v1/attest/challenge', headers: u.headers })).json().challenge;
    const bad = await t.app.inject({ method: 'POST', url: '/v1/attest/register', headers: u.headers, payload: { keyId: 'key-1234', attestation: Buffer.from('nope').toString('base64'), challenge: ch } });
    expect(bad.statusCode).toBe(403);
    const ch2 = (await t.app.inject({ url: '/v1/attest/challenge', headers: u.headers })).json().challenge;
    const reg = await t.app.inject({ method: 'POST', url: '/v1/attest/register', headers: u.headers, payload: { keyId: 'key-1234', attestation: Buffer.from('good-attestation').toString('base64'), challenge: ch2 } });
    expect(reg.statusCode).toBe(200);
  });
  afterAll(() => t.teardown());

  const send = (h?: string) =>
    t.app.inject({ method: 'POST', url: '/test/guarded', headers: { ...u.headers, 'content-type': 'application/json', ...(h ? { 'x-app-attest': h } : {}) }, payload: '{"a":1}' });

  test('valid assertion over the exact body is attested; replay is not', async () => {
    const good = await send(header('key-1234', 'ok|1|{"a":1}'));
    expect(good.json()).toEqual({ attested: true });
    const replay = await send(header('key-1234', 'ok|1|{"a":1}'));
    if (mode === 'enforce') expect(replay.json().error.code).toBe('ATTEST_FAILED');
    else expect(replay.json()).toEqual({ attested: false });
  });

  test('missing header or tampered body', async () => {
    const none = await send();
    const tampered = await send(header('key-1234', 'ok|9|{"a":2}'));
    for (const r of [none, tampered]) {
      if (mode === 'enforce') expect(r.statusCode).toBe(403);
      else expect(r.json()).toEqual({ attested: false });
    }
  });
});

describe('rate limit', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(() => t.teardown());

  test('fixed window throws 429 past the limit and resets next window', async () => {
    const now = new Date('2026-09-26T20:00:05Z');
    for (let i = 0; i < 3; i++) await hit(t.ctx.db, 'k', 3, 60, now);
    await expect(hit(t.ctx.db, 'k', 3, 60, now)).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    await hit(t.ctx.db, 'k', 3, 60, new Date('2026-09-26T20:01:05Z'));
  });
});

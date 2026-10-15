import http2, { type Http2Session, type IncomingHttpHeaders } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { decodeProtectedHeader, exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { handlers } from '../src/jobs/handlers.ts';
import { Worker } from '../src/jobs/queue.ts';
import { type ApnsOptions, ApnsPush, createPush, FakePush } from '../src/providers/push.ts';
import { notify } from '../src/services/notify.ts';
import { devLogin, setupTestApp } from './helpers.ts';

const TEAM = 'TEAM123456';
const KEY_ID = 'KEY1234567';
const TOPIC = 'com.hermi.app';
/** A distinct, valid-looking APNs token per letter. */
const tok = (c: string) => c.repeat(64);
const MSG = {
  title: 'Maya invited you',
  body: 'Sat 2 PM',
  data: { kind: 'plan_invite', planId: 'p1' },
};

interface Seen {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
  /** Index of the connection it arrived on. */
  conn: number;
  token: string;
  jwt: string;
}
interface Reply {
  status?: number;
  reason?: string;
  delayMs?: number;
  /** Never answer (a connection that swallows requests). */
  hang?: boolean;
}

/** A local APNs: cleartext HTTP/2 that records requests and answers as scripted. */
class FakeApns {
  server = http2.createServer();
  seen: Seen[] = [];
  conns: Http2Session[] = [];
  reply: (r: Seen) => Reply = () => ({});
  inflight = 0;
  maxInflight = 0;
  url = '';

  async start() {
    this.server.on('session', (s) => this.conns.push(s));
    this.server.on('stream', (stream, headers) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        const path = String(headers[':path']);
        const seen: Seen = {
          method: String(headers[':method']),
          path,
          headers,
          body: JSON.parse(Buffer.concat(chunks).toString() || '{}'),
          conn: this.conns.indexOf(stream.session!),
          token: path.split('/').pop()!,
          jwt: String(headers.authorization).replace(/^bearer /, ''),
        };
        this.seen.push(seen);
        const r = this.reply(seen);
        if (r.hang) return;
        this.maxInflight = Math.max(this.maxInflight, ++this.inflight);
        setTimeout(() => {
          this.inflight--;
          if (stream.destroyed) return;
          const status = r.status ?? 200;
          stream.respond({ ':status': status, 'apns-id': 'test' });
          stream.end(status === 200 ? undefined : JSON.stringify({ reason: r.reason }));
        }, r.delayMs ?? 0);
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** Forget requests and connections between tests (the server stays up). */
  reset() {
    for (const s of this.conns) s.destroy();
    this.conns = [];
    this.seen = [];
    this.reply = () => ({});
    this.inflight = 0;
    this.maxInflight = 0;
  }

  async stop() {
    this.reset();
    await new Promise((resolve) => this.server.close(resolve));
  }
}

const fake = new FakeApns();
let publicKey: Awaited<ReturnType<typeof generateKeyPair>>['publicKey'];
let pem: string;
let nowMs = 0;
let made: ApnsPush[] = [];

/** Provider pointed at the local server, signing with the throwaway key (in the \n-escaped form env vars use). */
const apns = (o: Partial<ApnsOptions> = {}) => {
  const p = new ApnsPush({
    teamId: TEAM,
    keyId: KEY_ID,
    privateKey: pem.replace(/\n/g, '\\n'),
    bundleId: TOPIC,
    authority: fake.url,
    now: () => nowMs,
    ...o,
  });
  made.push(p);
  return p;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  publicKey = pair.publicKey;
  pem = await exportPKCS8(pair.privateKey);
  await fake.start();
});
afterAll(() => fake.stop());
beforeEach(() => {
  nowMs = Date.parse('2026-10-14T12:00:00Z');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  await Promise.all(made.map((p) => p.close()));
  made = [];
  fake.reset();
  vi.restoreAllMocks();
});

describe('the request', () => {
  test('is a POST to /3/device/<token> with the APNs headers and the aps payload', async () => {
    const r = await apns().send([tok('a')], MSG);
    expect(r).toEqual({ invalid: [] });
    expect(fake.seen).toHaveLength(1);
    const [req] = fake.seen;
    expect(req).toMatchObject({ method: 'POST', path: `/3/device/${tok('a')}` });
    expect(req!.headers).toMatchObject({
      'apns-topic': TOPIC,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    });
    expect(req!.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(req!.body).toEqual({
      kind: 'plan_invite',
      planId: 'p1',
      aps: { alert: { title: 'Maya invited you', body: 'Sat 2 PM' }, sound: 'default' },
    });
  });

  test('custom data cannot replace aps, and an oversized payload is refused before any request', async () => {
    const p = apns();
    await p.send([tok('a')], { ...MSG, data: { aps: 'x', kind: 'k' } });
    expect(fake.seen[0]!.body).toEqual({
      kind: 'k',
      aps: { alert: { title: MSG.title, body: MSG.body }, sound: 'default' },
    });
    await expect(p.send([tok('a')], { ...MSG, body: 'x'.repeat(5000) })).rejects.toThrow(
      /over the 4096 limit/,
    );
    expect(fake.seen).toHaveLength(1);
  });

  test('a repeated token gets one notification', async () => {
    await apns().send([tok('a'), tok('a'), tok('b')], MSG);
    expect(fake.seen.map((s) => s.token).sort()).toEqual([tok('a'), tok('b')]);
  });
});

describe('the provider token', () => {
  test('is ES256 with the key id, signed by our key, claiming only iss and iat', async () => {
    await apns().send([tok('a')], MSG);
    const jwt = fake.seen[0]!.jwt;
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: 'ES256', kid: KEY_ID });
    const { payload } = await jwtVerify(jwt, publicKey, { algorithms: ['ES256'] });
    expect(payload).toEqual({ iss: TEAM, iat: nowMs / 1000 });
  });

  test('is reused within the cache window and re-minted after it', async () => {
    const p = apns();
    await p.send([tok('a')], MSG);
    nowMs += 49 * 60_000;
    await p.send([tok('b')], MSG);
    expect(new Set(fake.seen.map((s) => s.jwt)).size).toBe(1);

    nowMs += 2 * 60_000; // 51 minutes after it was minted
    await p.send([tok('c')], MSG);
    const fresh = fake.seen[2]!.jwt;
    expect(fresh).not.toBe(fake.seen[0]!.jwt);
    const { payload } = await jwtVerify(fresh, publicKey);
    expect(payload.iat).toBe(nowMs / 1000);
  });

  test('one token serves a whole batch sent at once', async () => {
    await apns().send(['a', 'b', 'c', 'd', 'e'].map(tok), MSG);
    expect(new Set(fake.seen.map((s) => s.jwt)).size).toBe(1);
  });

  test('403 ExpiredProviderToken mints a new token and retries that request once', async () => {
    const p = apns();
    await p.send([tok('a')], MSG);
    const old = fake.seen[0]!.jwt;
    fake.reply = (r) =>
      r.jwt === old ? { status: 403, reason: 'ExpiredProviderToken' } : { status: 200 };
    nowMs += 1000; // so the new token has a later iat
    expect(await p.send([tok('b')], MSG)).toEqual({ invalid: [] });
    expect(fake.seen).toHaveLength(3);
    expect(fake.seen[2]!.jwt).not.toBe(old);
    expect((await jwtVerify(fake.seen[2]!.jwt, publicKey)).payload.iat).toBe(nowMs / 1000);
    // The new token is cached for the sends after it.
    await p.send([tok('c')], MSG);
    expect(fake.seen[3]!.jwt).toBe(fake.seen[2]!.jwt);
  });

  test('concurrent 403s share one new token; a second 403 is not retried again', async () => {
    const p = apns();
    fake.reply = () => ({ status: 403, reason: 'ExpiredProviderToken' });
    await expect(p.send(['a', 'b', 'c'].map(tok), MSG)).rejects.toThrow(
      /all 3 sends failed \(403 ExpiredProviderToken x3\)/,
    );
    // Each token: the first try and exactly one retry, the retries all on the same new token.
    expect(fake.seen).toHaveLength(6);
    expect(new Set(fake.seen.map((s) => s.jwt)).size).toBe(2);
  });
});

describe('which tokens are invalid', () => {
  test('410 Unregistered, 400 BadDeviceToken and DeviceTokenNotForTopic are reported', async () => {
    fake.reply = (r) =>
      ({
        [tok('a')]: { status: 410, reason: 'Unregistered' },
        [tok('b')]: { status: 400, reason: 'BadDeviceToken' },
        [tok('c')]: { status: 400, reason: 'DeviceTokenNotForTopic' },
      })[r.token] ?? {};
    const r = await apns().send(['a', 'b', 'c', 'd'].map(tok), MSG);
    expect(r.invalid.sort()).toEqual(['a', 'b', 'c'].map(tok));
  });

  test('non-hex tokens are invalid without a request, old Expo tokens included', async () => {
    const bad = ['ExponentPushToken[abc]', 'abc123', tok('a').slice(1), `${tok('a')}zz`, ''];
    expect(await apns().send(bad, MSG)).toEqual({ invalid: bad });
    expect(fake.seen).toHaveLength(0);
  });

  test('upper-case hex is a valid token', async () => {
    const t = 'AB'.repeat(32);
    expect(await apns().send([t], MSG)).toEqual({ invalid: [] });
    expect(fake.seen[0]!.token).toBe(t);
  });
});

describe('failures', () => {
  test('one bad token does not sink the batch; a partial failure is logged, not thrown', async () => {
    fake.reply = (r) =>
      ({
        [tok('b')]: { status: 410, reason: 'Unregistered' },
        [tok('c')]: { status: 503, reason: 'ServiceUnavailable' },
      })[r.token] ?? {};
    const r = await apns().send(['a', 'b', 'c', 'd', 'e'].map(tok), MSG);
    expect(r).toEqual({ invalid: [tok('b')] });
    expect(fake.seen).toHaveLength(5);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('1 of 5 sends failed: 503 ServiceUnavailable x1'),
    );
  });

  test('every send failing rejects, so the job queue retries (nothing was delivered)', async () => {
    fake.reply = () => ({ status: 500, reason: 'InternalServerError' });
    await expect(apns().send([tok('a'), tok('b')], MSG)).rejects.toThrow(
      /apns: all 2 sends failed \(500 InternalServerError x2\)/,
    );
  });

  test('a config error (403 InvalidProviderToken) is a total failure, not a pruned token', async () => {
    fake.reply = () => ({ status: 403, reason: 'InvalidProviderToken' });
    await expect(apns().send([tok('a')], MSG)).rejects.toThrow(/403 InvalidProviderToken/);
  });

  test('all tokens invalid is a normal result, not a failure', async () => {
    fake.reply = () => ({ status: 410, reason: 'Unregistered' });
    expect(await apns().send([tok('a'), tok('b')], MSG)).toEqual({ invalid: [tok('a'), tok('b')] });
  });

  test('a request with no answer times out; the others in the batch still go through', async () => {
    fake.reply = (r) => (r.token === tok('c') ? { hang: true } : {});
    const t0 = performance.now();
    const r = await apns({ timeoutMs: 200 }).send([tok('a'), tok('c')], MSG);
    expect(r).toEqual({ invalid: [] });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no response in 200 ms'));
  });

  test('when nothing answers it rejects, and the next send uses a new connection', async () => {
    const p = apns({ timeoutMs: 150 });
    fake.reply = () => ({ hang: true });
    await expect(p.send([tok('a')], MSG)).rejects.toThrow(/no response in 150 ms/);
    fake.reply = () => ({});
    expect(await p.send([tok('b')], MSG)).toEqual({ invalid: [] });
    expect(fake.seen.map((s) => s.conn)).toEqual([0, 1]);
  });
});

describe('the connection', () => {
  test('is shared by every request, and by later sends', async () => {
    const p = apns();
    await p.send(['a', 'b', 'c'].map(tok), MSG);
    await p.send([tok('d')], MSG);
    expect(fake.conns).toHaveLength(1);
  });

  test('is replaced after the server sends GOAWAY', async () => {
    const p = apns();
    await p.send([tok('a')], MSG);
    fake.conns[0]!.goaway();
    await sleep(50);
    expect(await p.send([tok('b')], MSG)).toEqual({ invalid: [] });
    expect(fake.seen.map((s) => s.conn)).toEqual([0, 1]);
  });

  test('is replaced after the server drops it', async () => {
    const p = apns();
    await p.send([tok('a')], MSG);
    fake.conns[0]!.destroy();
    await sleep(50);
    expect(await p.send([tok('b')], MSG)).toEqual({ invalid: [] });
    expect(fake.seen.map((s) => s.conn)).toEqual([0, 1]);
  });

  test('is closed when idle, and the next send reconnects', async () => {
    const p = apns({ idleMs: 80 });
    await p.send([tok('a')], MSG);
    await sleep(300);
    expect(fake.conns[0]!.closed || fake.conns[0]!.destroyed).toBe(true);
    await p.send([tok('b')], MSG);
    expect(fake.seen.map((s) => s.conn)).toEqual([0, 1]);
  });

  test('is closed by close(), which is safe to call again', async () => {
    const p = apns();
    await p.send([tok('a')], MSG);
    await p.close();
    await p.close();
    await sleep(20);
    expect(fake.conns[0]!.closed || fake.conns[0]!.destroyed).toBe(true);
  });

  test('requests in flight are capped by the concurrency option', async () => {
    fake.reply = () => ({ delayMs: 40 });
    const tokens = Array.from({ length: 12 }, (_, i) => i.toString(16).padStart(64, '0'));
    expect(await apns({ concurrency: 3 }).send(tokens, MSG)).toEqual({ invalid: [] });
    expect(fake.seen).toHaveLength(12);
    expect(fake.maxInflight).toBeGreaterThan(1);
    expect(fake.maxInflight).toBeLessThanOrEqual(3);
  });
});

describe('createPush', () => {
  const real = {
    NODE_ENV: 'production',
    FAKE_PROVIDERS: '0',
    APPLE_TEAM_ID: TEAM,
    APPLE_BUNDLE_ID: TOPIC,
    APPLE_AUTH_KEY_ID: KEY_ID,
    APPLE_AUTH_PRIVATE_KEY: 'pem',
  };
  const pick = (env: Record<string, string>) => createPush(loadConfig(env));

  test('tests and FAKE_PROVIDERS get the fake, even with every key set', () => {
    expect(pick({ ...real, NODE_ENV: 'test' })).toBeInstanceOf(FakePush);
    expect(pick({ ...real, FAKE_PROVIDERS: '1' })).toBeInstanceOf(FakePush);
  });

  test('the auth key, team id and bundle id together switch APNs on', () => {
    const p = pick(real) as ApnsPush;
    expect(p).toBeInstanceOf(ApnsPush);
    expect(p.name).toBe('apns');
    expect(p.authority).toBe('https://api.push.apple.com');
  });

  test('APNS_SANDBOX points at the sandbox', () => {
    const p = pick({ ...real, APNS_SANDBOX: '1' }) as ApnsPush;
    expect(p.name).toBe('apns-sandbox');
    expect(p.authority).toBe('https://api.sandbox.push.apple.com');
  });

  test('a missing piece falls back to the fake, warning once per process', async () => {
    vi.resetModules();
    const fresh = await import('../src/providers/push.ts');
    for (const k of [
      'APPLE_TEAM_ID',
      'APPLE_BUNDLE_ID',
      'APPLE_AUTH_KEY_ID',
      'APPLE_AUTH_PRIVATE_KEY',
    ]) {
      const env = Object.fromEntries(Object.entries(real).filter(([key]) => key !== k));
      expect(fresh.createPush(loadConfig(env)).name).toBe('fake');
    }
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('APPLE_AUTH_PRIVATE_KEY'));
  });
});

describe('through the push job', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  const quiet = { info: () => {}, error: () => {} };
  beforeAll(async () => {
    t = await setupTestApp();
  });
  // Closing the context also closes the provider's session.
  afterAll(() => t.teardown());

  const userWith = async (name: string, pushTokens: string[]) => {
    const u = await devLogin(t.app, name);
    await t.ctx.db.collection('users').updateOne({ _id: u.id } as never, { $set: { pushTokens } });
    return u;
  };
  const tokensOf = async (id: string) =>
    (
      (await t.ctx.db.collection('users').findOne({ _id: id } as never)) as unknown as {
        pushTokens: string[];
      }
    ).pushTokens;

  test('registering takes an APNs hex token (kept once, in lowercase) and refuses anything else', async () => {
    const u = await devLogin(t.app, 'register');
    const register = async (token: string) =>
      (
        await t.app.inject({
          method: 'POST',
          url: '/v1/me/push-token',
          headers: u.headers,
          payload: { token },
        })
      ).statusCode;
    expect(await register('AB'.repeat(32))).toBe(200);
    expect(await register('ab'.repeat(32))).toBe(200);
    expect(await register('ef'.repeat(100))).toBe(200);
    expect(await tokensOf(u.id)).toEqual(['ab'.repeat(32), 'ef'.repeat(100)]);
    for (const bad of [
      'ExponentPushToken[abcdefghijkl]',
      'ab'.repeat(31), // too short
      'ab'.repeat(101), // too long
      `${'ab'.repeat(32)}a`, // odd number of digits
      `${'ab'.repeat(31)}zz`,
    ])
      expect(await register(bad), bad).toBe(400);
  });

  test('a device belongs to whoever registered it last (sign out, someone else signs in)', async () => {
    const push = new FakePush();
    t.ctx.providers.push = push;
    const a = await devLogin(t.app, 'handoffa');
    const b = await devLogin(t.app, 'handoffb');
    const register = (u: typeof a, token: string) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/me/push-token',
        headers: u.headers,
        payload: { token },
      });
    const other = tok('9');
    await register(a, other); // A's second device is not affected
    await register(a, tok('d'));
    await register(b, tok('d').toUpperCase());
    expect(await tokensOf(a.id)).toEqual([other]);
    expect(await tokensOf(b.id)).toEqual([tok('d')]);

    await notify(t.ctx, [a.id], MSG);
    await notify(t.ctx, [b.id], MSG);
    await new Worker(t.ctx, handlers, quiet).drain();
    expect(push.sent.map((s) => s.tokens)).toEqual([[other], [tok('d')]]);

    expect((await t.ctx.db.collection('users').indexes()).some((i) => i.key.pushTokens === 1)).toBe(
      true,
    );

    // Signing A back in on that phone takes it back.
    await register(a, tok('d'));
    expect(await tokensOf(a.id)).toEqual([other, tok('d')]);
    expect(await tokensOf(b.id)).toEqual([]);
  });

  test('tokens APNs or the format check reject are pruned; the live one stays', async () => {
    t.ctx.providers.push = apns();
    fake.reply = (r) => (r.token === tok('b') ? { status: 410, reason: 'Unregistered' } : {});
    const legacy = 'ExponentPushToken[old-install]';
    const u = await userWith('prune', [legacy, tok('a'), tok('b')]);
    await notify(t.ctx, [u.id], MSG);
    await new Worker(t.ctx, handlers, quiet).drain();
    expect(await tokensOf(u.id)).toEqual([tok('a')]);
    expect(fake.seen.map((s) => s.token).sort()).toEqual([tok('a'), tok('b')]);
  });

  test('when nothing is delivered the job fails and is queued to retry', async () => {
    t.ctx.providers.push = apns();
    fake.reply = () => ({ status: 503, reason: 'ServiceUnavailable' });
    const u = await userWith('outage', [tok('c')]);
    await notify(t.ctx, [u.id], MSG);
    await new Worker(t.ctx, handlers, quiet).drain();
    const job = await t.ctx.db
      .collection('jobs')
      .findOne({ type: 'push', 'payload.userIds': u.id });
    expect(job).toMatchObject({ status: 'pending', attempts: 1 });
    expect(job!.lastError).toMatch(/all 1 sends failed \(503 ServiceUnavailable x1\)/);
    expect(await tokensOf(u.id)).toEqual([tok('c')]);
  });
});

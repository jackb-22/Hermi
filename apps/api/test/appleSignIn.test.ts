import { createHash, randomBytes } from 'node:crypto';
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from 'jose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  type MockInstance,
  test,
  vi,
} from 'vitest';
import { loadConfig } from '../src/config.ts';
import { handlers } from '../src/jobs/handlers.ts';
import { type JobDoc, Worker } from '../src/jobs/queue.ts';
import { FakeAppleIdentity, RealAppleIdentity } from '../src/providers/appleIdentity.ts';
import { createProviders } from '../src/providers/index.ts';
import { queueAppleRevoke } from '../src/services/appleRevoke.ts';
import { toUserCard } from '../src/services/social.ts';
import { toMe, users } from '../src/services/users.ts';
import { devLogin, setupTestApp } from './helpers.ts';

/**
 * The real provider against throwaway keys: one pair plays Apple's identity-token signer (and its JWKS),
 * another plays our .p8. Apple's token endpoints are a stubbed fetch, so nothing leaves the machine.
 */
const TEAM = 'TEAM123456';
const BUNDLE = 'world.hermi.app';
const AUTH_KEY_ID = 'AUTHKEY123';
const APPLE_KID = 'apple-signing-key';
const ISSUER = 'https://appleid.apple.com';

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

let t: Awaited<ReturnType<typeof setupTestApp>>;
let appleKey: CryptoKey;
let p8Public: CryptoKey;
let p8Pem: string;
let provider: RealAppleIdentity;

interface Call {
  url: string;
  form: URLSearchParams;
  init: RequestInit;
}
let calls: Call[];
/** Which Apple user each authorization code was issued to, so the token endpoint can answer for it. */
const codes = new Map<string, string>();
let respond: (call: Call) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function appleSigned(
  claims: Record<string, unknown>,
  o: { sub: string; aud?: string; iss?: string; key?: CryptoKey },
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: APPLE_KID })
    .setIssuer(o.iss ?? ISSUER)
    .setAudience(o.aud ?? BUNDLE)
    .setSubject(o.sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(o.key ?? appleKey);
}

const defaultRespond = async ({ url, form }: Call) => {
  if (url.endsWith('/auth/revoke')) return new Response('', { status: 200 });
  const code = form.get('code')!;
  return json({
    access_token: 'access-token',
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: `refresh-${code}`,
    id_token: await appleSigned({}, { sub: codes.get(code)! }),
  });
};

/** What the iOS app would send after the Apple sheet: claim is what Apple put in the token's nonce. */
async function credential(
  sub: string,
  o: { claim?: string | null; aud?: string; iss?: string; key?: CryptoKey } = {},
) {
  const nonce = randomBytes(16).toString('hex');
  const authorizationCode = `code-${randomBytes(6).toString('hex')}`;
  codes.set(authorizationCode, sub);
  const claim = o.claim === undefined ? sha256hex(nonce) : o.claim;
  const identityToken = await appleSigned(claim === null ? {} : { nonce: claim }, { sub, ...o });
  return { identityToken, nonce, authorizationCode };
}

const signIn = (payload: object) =>
  t.app.inject({ method: 'POST', url: '/v1/auth/apple', payload });
const jobsOf = () => t.ctx.db.collection<JobDoc>('jobs');
const revokeJobs = (userId: string) =>
  jobsOf()
    .find({ type: 'revoke_apple_token', 'payload.userId': userId } as never)
    .toArray();
const userBySub = (sub: string) => users(t.ctx.db).findOne({ appleSub: sub });
const appleUsers = (sub: string) => users(t.ctx.db).countDocuments({ appleSub: sub });

/** The client_secret Apple would receive must be a short ES256 JWT from our key for this team and app. */
async function expectClientSecret(call: Call) {
  const secret = call.form.get('client_secret')!;
  const header = decodeProtectedHeader(secret);
  expect(header).toMatchObject({ alg: 'ES256', kid: AUTH_KEY_ID });
  const { payload } = await jwtVerify(secret, p8Public, {
    issuer: TEAM,
    audience: ISSUER,
    subject: BUNDLE,
  });
  expect(call.form.get('client_id')).toBe(BUNDLE);
  expect(payload.exp! - payload.iat!).toBeGreaterThan(0);
  expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(300);
  expect(Math.abs(payload.iat! - Date.now() / 1000)).toBeLessThan(30);
}

let warn: ReturnType<typeof vi.spyOn>;
/** Nothing a user could abuse may reach the logs: codes, client secrets, refresh tokens. */
const logged = () => JSON.stringify(warn.mock.calls);

beforeAll(async () => {
  const apple = await generateKeyPair('ES256');
  appleKey = apple.privateKey;
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(apple.publicKey)), kid: APPLE_KID, alg: 'ES256', use: 'sig' }],
  });
  const p8 = await generateKeyPair('ES256', { extractable: true });
  p8Public = p8.publicKey;
  // As pasted into an env file: PEM with literal \n.
  p8Pem = (await exportPKCS8(p8.privateKey)).replace(/\n/g, '\\n');

  t = await setupTestApp();
  provider = new RealAppleIdentity({
    clientId: BUNDLE,
    teamId: TEAM,
    keyId: AUTH_KEY_ID,
    privateKey: p8Pem,
    jwks,
    fetch: (async (url, init) => {
      const call = { url: String(url), form: new URLSearchParams(String(init?.body)), init: init! };
      calls.push(call);
      return respond(call);
    }) as typeof fetch,
  });
  warn = vi.spyOn(t.app.log, 'warn');
});
afterAll(() => t.teardown());

describe('real provider', () => {
  beforeAll(() => {
    t.ctx.providers.appleIdentity = provider;
  });
  beforeEach(() => {
    calls = [];
    respond = defaultRespond;
    warn.mockClear();
  });

  test('a valid token with the matching nonce signs in and the refresh token is stored', async () => {
    const cred = await credential('sub-new');
    const res = await signIn({ ...cred, name: 'Ada' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isNew: true, user: { name: 'Ada' } });

    const doc = await userBySub('sub-new');
    expect(doc?.appleRefreshToken).toBe(`refresh-${cred.authorizationCode}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://appleid.apple.com/auth/token');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(Object.fromEntries(calls[0]!.form)).toMatchObject({
      client_id: BUNDLE,
      code: cred.authorizationCode,
      grant_type: 'authorization_code',
    });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(warn).not.toHaveBeenCalled();
  });

  test('the client secret is an ES256 JWT from our .p8 for this team, key and app', async () => {
    await signIn(await credential('sub-secret'));
    await expectClientSecret(calls[0]!);
  });

  test('the refresh token is in no API response', async () => {
    const cred = await credential('sub-hidden');
    const res = await signIn(cred);
    const secret = `refresh-${cred.authorizationCode}`;
    expect((await userBySub('sub-hidden'))?.appleRefreshToken).toBe(secret);
    expect(res.body).not.toContain(secret);
    expect(res.body).not.toContain('refresh');
    const me = await t.app.inject({
      url: '/v1/me',
      headers: { authorization: `Bearer ${res.json().token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.body).not.toContain(secret);
    expect(me.body).not.toContain('refresh');
  });

  test('every sign-in exchanges its own code and keeps the latest token', async () => {
    const first = await signIn(await credential('sub-again'));
    const second = await credential('sub-again');
    const res = await signIn(second);
    expect(res.json()).toMatchObject({ isNew: false, user: { id: first.json().user.id } });
    expect(calls).toHaveLength(2);
    expect(await appleUsers('sub-again')).toBe(1);
    expect((await userBySub('sub-again'))?.appleRefreshToken).toBe(
      `refresh-${second.authorizationCode}`,
    );
  });

  describe('the nonce', () => {
    test('a different raw nonce is a 401, creates nobody and never reaches Apple', async () => {
      const cred = await credential('sub-nonce-1');
      const res = await signIn({ ...cred, nonce: randomBytes(16).toString('hex') });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
      expect(await appleUsers('sub-nonce-1')).toBe(0);
      expect(calls).toHaveLength(0);
    });

    test('a token without a nonce claim is a 401', async () => {
      const res = await signIn(await credential('sub-nonce-2', { claim: null }));
      expect(res.statusCode).toBe(401);
      expect(await appleUsers('sub-nonce-2')).toBe(0);
      expect(calls).toHaveLength(0);
    });

    test('the raw nonce sent as the claim (not hashed) is a 401', async () => {
      const nonce = randomBytes(16).toString('hex');
      const res = await signIn({ ...(await credential('sub-nonce-3', { claim: nonce })), nonce });
      expect(res.statusCode).toBe(401);
    });

    test('a nonce missing from the request is a 400 before any check', async () => {
      const { nonce: _nonce, ...rest } = await credential('sub-nonce-4');
      const res = await signIn(rest);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('the identity token', () => {
    test('wrong audience, wrong issuer, or a key that is not Apple’s is a 401', async () => {
      const stranger = await generateKeyPair('ES256');
      const bad = [
        { aud: 'com.someone.else' },
        { iss: 'https://evil.example.com' },
        { key: stranger.privateKey },
      ];
      for (const [i, o] of bad.entries()) {
        const res = await signIn(await credential(`sub-bad-${i}`, o));
        expect(res.statusCode).toBe(401);
        expect(res.json().error.code).toBe('UNAUTHORIZED');
        expect(await appleUsers(`sub-bad-${i}`)).toBe(0);
      }
      expect(calls).toHaveLength(0);
    });
  });

  describe('when the code exchange fails, sign-in still works and the next sign-in retries', () => {
    const failures: Record<string, () => Response | Promise<Response>> = {
      'an expired or used code': () => json({ error: 'invalid_grant' }, 400),
      'Apple being down': () => new Response('<html>Bad gateway</html>', { status: 502 }),
      'the network failing': () => {
        throw new TypeError('fetch failed');
      },
      'no refresh_token in the reply': () => json({ access_token: 'a', token_type: 'Bearer' }),
    };
    for (const [why, fail] of Object.entries(failures)) {
      test(why, async () => {
        const sub = `sub-fail-${why.replace(/\W+/g, '-')}`;
        const cred = await credential(sub);
        respond = fail;
        const res = await signIn(cred);
        expect(res.statusCode).toBe(200);
        expect(res.json().isNew).toBe(true);
        expect(await userBySub(sub)).toMatchObject({ appleSub: sub });
        expect((await userBySub(sub))?.appleRefreshToken).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(logged()).toContain('Apple code exchange failed');
        expect(logged()).not.toContain(cred.authorizationCode);
        expect(logged()).not.toContain(calls[0]!.form.get('client_secret')!);

        // Next sign-in: Apple is back, so the missing token is filled in.
        respond = defaultRespond;
        const retry = await credential(sub);
        const again = await signIn(retry);
        expect(again.json().isNew).toBe(false);
        expect((await userBySub(sub))?.appleRefreshToken).toBe(
          `refresh-${retry.authorizationCode}`,
        );
      });
    }

    test('a failed exchange keeps the token the user already had', async () => {
      await signIn(await credential('sub-keep'));
      const before = (await userBySub('sub-keep'))?.appleRefreshToken;
      expect(before).toBeTruthy();
      respond = () => json({ error: 'invalid_grant' }, 400);
      expect((await signIn(await credential('sub-keep'))).statusCode).toBe(200);
      expect((await userBySub('sub-keep'))?.appleRefreshToken).toBe(before);
    });

    test('a code issued to a different Apple user is not stored', async () => {
      const cred = await credential('sub-mine');
      codes.set(cred.authorizationCode, 'sub-someone-else');
      expect((await signIn(cred)).statusCode).toBe(200);
      expect((await userBySub('sub-mine'))?.appleRefreshToken).toBeUndefined();
      expect(logged()).toContain('different user');
    });
  });

  test('errors from Apple carry its error code, not what we sent', async () => {
    respond = () => json({ error: 'invalid_client', error_description: 'secret leaked here' }, 400);
    const err = await provider.exchangeCode('the-code', 's').catch((e: Error) => e);
    expect((err as Error).message).toBe('apple token 400 invalid_client');
    respond = () => json({ error: 'x'.repeat(500) }, 400);
    const long = await provider.revoke('the-token').catch((e: Error) => e);
    expect((long as Error).message).toBe('apple revoke 400');
  });

  describe('deleting the account', () => {
    test('revokes the stored refresh token with Apple, then unsets it', async () => {
      const signedIn = await signIn(await credential('sub-delete'));
      const stored = (await userBySub('sub-delete'))?.appleRefreshToken;
      expect(stored).toBeTruthy();
      calls = [];

      const res = await t.app.inject({
        method: 'DELETE',
        url: '/v1/me',
        headers: { authorization: `Bearer ${signedIn.json().token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe('https://appleid.apple.com/auth/revoke');
      expect(calls[0]!.init.headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
      expect(Object.fromEntries(calls[0]!.form)).toMatchObject({
        client_id: BUNDLE,
        token: stored,
        token_type_hint: 'refresh_token',
      });
      await expectClientSecret(calls[0]!);

      const doc = await users(t.ctx.db).findOne({ _id: signedIn.json().user.id });
      expect(doc?.deletedAt).toBeInstanceOf(Date);
      expect(doc).not.toHaveProperty('appleRefreshToken');
      expect(doc).not.toHaveProperty('appleSub');
      expect(warn).not.toHaveBeenCalled();
      expect(await revokeJobs(signedIn.json().user.id)).toHaveLength(0);
    });

    describe('when Apple refuses to revoke, a job keeps trying', () => {
      let worker: Worker;
      let errorLog: MockInstance;
      beforeAll(() => {
        worker = new Worker(t.ctx, handlers, { info: () => {}, error: () => {} });
      });
      beforeEach(async () => {
        await jobsOf().deleteMany({ type: 'revoke_apple_token' });
        errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      });
      afterEach(() => {
        errorLog.mockRestore();
        t.ctx.clock.offsetMs = 0;
      });

      const refuse = () => json({ error: 'server_error' }, 503);
      const unreachable = () => {
        throw new TypeError('fetch failed');
      };

      /** A signed-in Apple user deletes the account while Apple's revoke endpoint fails. */
      async function deleteWhileAppleFails(sub: string, fail = refuse) {
        const signedIn = await signIn(await credential(sub));
        const id = signedIn.json().user.id as string;
        const token = (await userBySub(sub))?.appleRefreshToken ?? '';
        expect(token).toBeTruthy();
        respond = fail;
        const res = await t.app.inject({
          method: 'DELETE',
          url: '/v1/me',
          headers: { authorization: `Bearer ${signedIn.json().token}` },
        });
        return { id, token, res };
      }
      const userDoc = (id: string) => users(t.ctx.db).findOne({ _id: id });

      test.each([
        ['Apple refusing', refuse],
        ['Apple being unreachable', unreachable],
      ])(
        '%s: deletion goes through, the token is kept and a retry is queued',
        async (_why, fail) => {
          const { id, token, res } = await deleteWhileAppleFails(
            `sub-keep-${randomBytes(3).toString('hex')}`,
            fail,
          );
          expect(res.statusCode).toBe(200);
          const doc = await userDoc(id);
          expect(doc?.deletedAt).toBeInstanceOf(Date);
          expect(doc).not.toHaveProperty('appleSub');
          expect(doc?.appleRefreshToken).toBe(token);

          const [job, ...rest] = await revokeJobs(id);
          expect(rest).toHaveLength(0);
          expect(job).toMatchObject({
            status: 'pending',
            payload: { userId: id },
            dedupeKey: `revoke-apple:${id}`,
            maxAttempts: 8,
          });
          // The jobs collection is never pruned, so nothing secret may go in it.
          expect(JSON.stringify(job)).not.toContain(token);
          expect(await queueAppleRevoke(t.ctx, id)).toBe(job!._id);
          expect(await revokeJobs(id)).toHaveLength(1);

          expect(warn).toHaveBeenCalledTimes(1);
          expect(logged()).toContain('retrying from the queue');
          expect(logged()).not.toContain(token);
          expect(logged()).not.toContain(calls.at(-1)!.form.get('client_secret')!);
        },
      );

      test('the worker revokes with the stored token once Apple answers, then unsets it', async () => {
        const { id, token } = await deleteWhileAppleFails('sub-retry-ok');
        respond = defaultRespond;
        calls = [];
        await worker.drain();

        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe('https://appleid.apple.com/auth/revoke');
        expect(Object.fromEntries(calls[0]!.form)).toMatchObject({
          token,
          token_type_hint: 'refresh_token',
        });
        await expectClientSecret(calls[0]!);
        const doc = await userDoc(id);
        expect(doc?.deletedAt).toBeInstanceOf(Date);
        expect(doc).not.toHaveProperty('appleRefreshToken');
        expect((await revokeJobs(id))[0]?.status).toBe('done');
        expect(errorLog).not.toHaveBeenCalled();
      });

      test('retries back off, and if Apple never answers the job dies with the token kept and an error logged', async () => {
        const { id, token } = await deleteWhileAppleFails('sub-retry-dead');
        calls = [];
        for (let i = 0; i < 8; i++) {
          await worker.drain();
          t.ctx.clock.offsetMs += 6 * 60_000; // past the longest backoff
        }
        const [job] = await revokeJobs(id);
        expect(job).toMatchObject({ status: 'dead', attempts: 8 });
        expect(calls).toHaveLength(8);
        expect((await userDoc(id))?.appleRefreshToken).toBe(token);
        expect(job?.lastError).not.toContain(token);

        expect(errorLog).toHaveBeenCalledTimes(1);
        const message = String(errorLog.mock.calls[0]![0]);
        expect(message).toContain(id);
        expect(message).not.toContain(token);
        expect(message).not.toContain(calls[0]!.form.get('client_secret')!);

        // A dead job stays dead, and a person can queue it again once Apple is back.
        await worker.drain();
        expect(calls).toHaveLength(8);
        respond = defaultRespond;
        await queueAppleRevoke(t.ctx, id);
        await worker.drain();
        expect(calls).toHaveLength(9);
        expect(calls[8]!.form.get('token')).toBe(token);
        expect(await userDoc(id)).not.toHaveProperty('appleRefreshToken');
      });

      test('the job leaves alone accounts that are not deleted or hold no token', async () => {
        const live = await signIn(await credential('sub-live'));
        const liveId = live.json().user.id as string;
        const noToken = await devLogin(t.app, 'no_token_user');
        await t.app.inject({ method: 'DELETE', url: '/v1/me', headers: noToken.headers });
        calls = [];
        for (const userId of [liveId, noToken.id, 'no-such-user'])
          await queueAppleRevoke(t.ctx, userId);
        await worker.drain();

        expect(calls).toHaveLength(0);
        expect((await userBySub('sub-live'))?.appleRefreshToken).toBeTruthy();
        expect((await revokeJobs(liveId))[0]?.status).toBe('done');
        expect(errorLog).not.toHaveBeenCalled();
      });

      test('the kept token is in no response about the deleted user', async () => {
        const { id, token } = await deleteWhileAppleFails('sub-not-leaked');
        const doc = (await userDoc(id))!;
        expect(doc.appleRefreshToken).toBe(token);
        expect(JSON.stringify(toMe(doc, t.ctx.config, new Date()))).not.toContain(token);
        expect(JSON.stringify(toUserCard(doc, t.ctx.config))).not.toContain(token);

        const watcher = await devLogin(t.app, 'watcher');
        for (const url of [
          `/v1/score?userId=${id}`,
          `/v1/profile/${id}`,
          '/v1/friends',
          '/v1/me',
        ]) {
          const r = await t.app.inject({ url, headers: watcher.headers });
          expect(r.body).not.toContain(token);
        }
      });
    });

    test('an account with no Apple token is deleted without calling Apple', async () => {
      const u = await devLogin(t.app, 'devuser');
      const res = await t.app.inject({ method: 'DELETE', url: '/v1/me', headers: u.headers });
      expect(res.statusCode).toBe(200);
      expect(calls).toHaveLength(0);
    });
  });
});

describe('real provider without the .p8 configured', () => {
  const bare = (fetchCalls: string[]) =>
    new RealAppleIdentity({
      clientId: BUNDLE,
      fetch: (async (url) => {
        fetchCalls.push(String(url));
        return json({});
      }) as typeof fetch,
    });

  test('exchange and revoke say what is missing and never reach Apple', async () => {
    const reached: string[] = [];
    const apple = bare(reached);
    await expect(apple.exchangeCode('c', 's')).rejects.toThrow(/APPLE_AUTH_KEY_ID/);
    await expect(apple.revoke('r')).rejects.toThrow(/APPLE_AUTH_PRIVATE_KEY/);
    expect(reached).toEqual([]);
  });
});

describe('fake provider (dev and tests)', () => {
  let fake: FakeAppleIdentity;
  beforeAll(() => {
    fake = new FakeAppleIdentity();
    t.ctx.providers.appleIdentity = fake;
  });

  test('signs in without a real nonce and stores a deterministic fake token', async () => {
    const res = await signIn({
      identityToken: 'fake:fake-sub',
      nonce: 'any-nonce-of-16-chars',
      authorizationCode: 'any-code',
    });
    expect(res.statusCode).toBe(200);
    expect((await userBySub('fake-sub'))?.appleRefreshToken).toBe('fake-refresh:fake-sub');
    expect(res.body).not.toContain('fake-refresh');
  });

  test('deleting the account revokes the fake token', async () => {
    const res = await signIn({
      identityToken: 'fake:fake-sub-2',
      nonce: 'any-nonce-of-16-chars',
      authorizationCode: 'any-code',
    });
    const del = await t.app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: `Bearer ${res.json().token}` },
    });
    expect(del.statusCode).toBe(200);
    expect(fake.revoked).toEqual(['fake-refresh:fake-sub-2']);
  });
});

describe('provider selection', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('no APPLE_BUNDLE_ID is the fake; with it, the config reaches the real provider', async () => {
    expect(createProviders(loadConfig({})).appleIdentity.name).toBe('fake');
    const real = createProviders(
      loadConfig({
        APPLE_BUNDLE_ID: BUNDLE,
        APPLE_TEAM_ID: TEAM,
        APPLE_AUTH_KEY_ID: AUTH_KEY_ID,
        APPLE_AUTH_PRIVATE_KEY: p8Pem,
      }),
    ).appleIdentity;
    expect(real.name).toBe('apple');

    calls = [];
    const fetched = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, form: new URLSearchParams(String(init.body)), init });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetched);
    await real.revoke('refresh-token');
    expect(fetched).toHaveBeenCalledTimes(1);
    await expectClientSecret(calls[0]!);
  });
});

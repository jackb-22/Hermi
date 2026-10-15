import { createHmac, hkdfSync } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { banUser, unbanUser } from '../src/services/admin.ts';
import { studentStatus, users } from '../src/services/users.ts';
import { devLogin, setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.teardown());

/** The fake verifier ignores both, but the schema still requires them. */
const proof = { nonce: 'any-nonce-of-16-chars', authorizationCode: 'any-code' };

describe('sign in', () => {
  test('apple (fake verifier) creates once, then signs in', async () => {
    const a = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: { identityToken: 'fake:apple-sub-1', name: 'Ada', ...proof },
    });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ isNew: true, user: { name: 'Ada', verified: false } });
    const b = await t.app.inject({
      method: 'POST',
      url: '/auth/apple',
      payload: { identityToken: 'fake:apple-sub-1', ...proof },
    });
    expect(b.json()).toMatchObject({ isNew: false, user: { id: a.json().user.id } });
  });

  test('bad apple token is 401 envelope', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: { identityToken: 'garbage-token', ...proof },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('UNAUTHORIZED');
  });

  test('apple with a guessable nonce is a 400', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: { identityToken: 'fake:apple-sub-1', nonce: 'short', authorizationCode: 'c' },
    });
    expect(r.statusCode).toBe(400);
  });

  test('apple without the nonce or authorization code is a 400', async () => {
    for (const missing of ['nonce', 'authorizationCode']) {
      const { [missing]: _omitted, ...rest } = proof as Record<string, string>;
      const r = await t.app.inject({
        method: 'POST',
        url: '/v1/auth/apple',
        payload: { identityToken: 'fake:apple-sub-1', ...rest },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('BAD_REQUEST');
    }
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

describe('banned accounts cannot sign in', () => {
  const apple = (sub: string) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: { identityToken: `fake:${sub}`, ...proof },
    });
  const dev = (username: string) =>
    t.app.inject({ method: 'POST', url: '/v1/auth/dev', payload: { username } });

  test('apple: 403 BANNED and no token; Apple is not asked for a refresh token; unbanning restores it', async () => {
    const created = await apple('banned-apple-1');
    expect(created.statusCode).toBe(200);
    const id: string = created.json().user.id;
    const stored = (await users(t.ctx.db).findOne({ _id: id }))!.appleRefreshToken;
    expect(stored).toBe('fake-refresh:banned-apple-1');
    await banUser(t.ctx, id, 'spam');

    const exchange = vi.spyOn(t.ctx.providers.appleIdentity, 'exchangeCode');
    try {
      const r = await apple('banned-apple-1');
      expect(r.statusCode).toBe(403);
      expect(r.json().error.code).toBe('BANNED');
      expect(r.json()).not.toHaveProperty('token');
      expect(exchange).not.toHaveBeenCalled();
      // No second account was made for the same Apple user, and the stored token is untouched.
      expect(await users(t.ctx.db).countDocuments({ appleSub: 'banned-apple-1' })).toBe(1);
      expect((await users(t.ctx.db).findOne({ _id: id }))!.appleRefreshToken).toBe(stored);

      await unbanUser(t.ctx, id);
      const back = await apple('banned-apple-1');
      expect(back.statusCode).toBe(200);
      expect(back.json()).toMatchObject({ isNew: false, user: { id } });
      expect(exchange).toHaveBeenCalledTimes(1);
    } finally {
      exchange.mockRestore();
    }
  });

  test('apple: an identity token that does not verify is still a 401, so a ban cannot be probed', async () => {
    const created = await apple('banned-apple-2');
    await banUser(t.ctx, created.json().user.id, 'spam');
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: { identityToken: 'not-a-token', ...proof },
    });
    expect(r.statusCode).toBe(401);
  });

  test('dev: 403 BANNED and no token; unbanning restores it', async () => {
    const created = await dev('banned_dev_1');
    expect(created.statusCode).toBe(200);
    const id: string = created.json().user.id;
    await banUser(t.ctx, id, 'harassment');
    const r = await dev('banned_dev_1');
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('BANNED');
    expect(r.json()).not.toHaveProperty('token');
    expect(await users(t.ctx.db).countDocuments({ username: 'banned_dev_1' })).toBe(1);

    await unbanUser(t.ctx, id);
    const back = await dev('banned_dev_1');
    expect(back.statusCode).toBe(200);
    expect(back.json()).toMatchObject({ isNew: false, user: { id } });
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

  test('alumni flip', () => {
    const v = { verifiedAt: new Date(), gradYear: 2026 };
    expect(studentStatus(v, new Date('2026-05-20T12:00:00Z'))).toBe('current');
    expect(studentStatus(v, new Date('2026-06-02T12:00:00Z'))).toBe('alumni');
  });
});

describe('school email rules', () => {
  type Dev = Awaited<ReturnType<typeof devLogin>>;
  const mail = () => t.ctx.providers.email as unknown as { sent: { to: string }[] };
  /** What the server stores for an address, rebuilt from its documented parts: HMAC under an HKDF key. */
  const schoolHash = (address: string) =>
    createHmac(
      'sha256',
      Buffer.from(hkdfSync('sha256', t.ctx.config.JWT_SECRET, '', 'hermi school email v1', 32)),
    )
      .update(address)
      .digest('hex');
  let nextIp = 1;
  /** Each caller gets its own IP unless it passes one: the per-IP cap is shared by the whole file. */
  const start = (u: Dev, email: string, ip = `198.51.100.${nextIp++}`) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/auth/edu',
      headers: { ...u.headers, 'x-forwarded-for': ip },
      payload: { email, gradYear: 2028 },
    });
  const verify = (u: Dev, code: string) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/auth/edu/verify',
      headers: u.headers,
      payload: { code },
    });
  /** Start and finish verification; returns the verify response. */
  async function verified(u: Dev, email: string) {
    const s = await start(u, email);
    expect(s.statusCode, s.body).toBe(200);
    return verify(u, s.json().devCode);
  }

  // Sends are counted per hour; sit in the middle of one so a test cannot straddle a window edge.
  beforeEach(() => {
    const now = Date.now();
    t.ctx.clock.offsetMs = now - (now % 3_600_000) + 1_800_000 - now;
  });
  afterEach(() => {
    t.ctx.clock.offsetMs = 0;
  });

  describe('allowlist', () => {
    test.each([
      ['a1@columbia.edu', 'Columbia'],
      ['a2@barnard.edu', 'Barnard'],
      ['a3@cumc.columbia.edu', 'Columbia'],
      ['a4@tc.columbia.edu', 'Columbia'],
      ['a5@gsb.columbia.edu', 'Columbia'],
      ['a6@alumni.barnard.edu', 'Barnard'],
      ['A7@Columbia.EDU', 'Columbia'],
    ])('%s is sent a code and named %s', async (email, campus) => {
      const u = await devLogin(t.app, `allow_${email.split('@')[0]!.toLowerCase()}`);
      const before = mail().sent.length;
      const r = await start(u, email);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ sent: true, campus });
      expect(mail().sent.length).toBe(before + 1);
      expect(mail().sent.at(-1)?.to).toBe(email.toLowerCase());
    });

    test('refused domains say who is welcome and send nothing', async () => {
      const u = await devLogin(t.app, 'refused_domains');
      const before = mail().sent.length;
      for (const email of [
        'uni@columbia.edu.evil.com',
        'uni@notcolumbia.edu',
        'uni@evil-columbia.edu',
        'columbia.edu@evil.com',
        'uni@barnard.edu.evil.com',
        'uni@columbia.edu.com',
        'uni@nyu.edu',
        'uni@mit.edu',
        'uni@gmail.com',
      ]) {
        const r = await start(u, email);
        expect(r.statusCode, email).toBe(400);
        expect(r.json().error.code, email).toBe('EDU_DOMAIN_NOT_ALLOWED');
        expect(r.json().error.message).toBe('Use your Columbia or Barnard email');
      }
      // The schema already refuses these, whatever the allowlist says.
      for (const email of [
        'uni@columbia.edu.',
        'uni@columbia.edu ',
        ' uni@columbia.edu',
        'uni@columbia.edu@evil.com',
        'uni@columbia.edu\n',
      ]) {
        const r = await start(u, email);
        expect(r.statusCode, email).toBe(400);
      }
      expect(mail().sent.length).toBe(before);
    });

    test('with no REVIEW_EMAIL set, a would-be review address is refused like any other', async () => {
      const u = await devLogin(t.app, 'no_review_path');
      const before = mail().sent.length;
      for (const email of ['review@hermi.world', 'appreview@example.com']) {
        const r = await start(u, email);
        expect(r.statusCode, email).toBe(400);
        expect(r.json().error.code, email).toBe('EDU_DOMAIN_NOT_ALLOWED');
      }
      expect(mail().sent.length).toBe(before);
    });
  });

  describe('rate limits', () => {
    test('one account gets 5 codes an hour, then 429, and the 6th sends nothing', async () => {
      const u = await devLogin(t.app, 'limit_user');
      const before = mail().sent.length;
      for (let i = 0; i < 5; i++)
        expect((await start(u, 'limit@columbia.edu')).statusCode).toBe(200);
      const r = await start(u, 'limit@columbia.edu');
      expect(r.statusCode).toBe(429);
      expect(r.json().error).toMatchObject({ code: 'RATE_LIMITED', details: { limit: 5 } });
      expect(mail().sent.length).toBe(before + 5);

      // Another account is not held back by it, and an hour later this one is free again.
      expect(
        (await start(await devLogin(t.app, 'limit_other'), 'limit2@columbia.edu')).statusCode,
      ).toBe(200);
      t.ctx.clock.offsetMs += 3_600_000;
      expect((await start(u, 'limit@columbia.edu')).statusCode).toBe(200);
    });

    /** 12 accounts send 5 codes each, the most the per-user cap allows: 60 sends from one IP. */
    async function fillIp(tag: string, header: () => string) {
      for (let n = 0; n < 12; n++) {
        const u = await devLogin(t.app, `${tag}_${n}`);
        for (let i = 0; i < 5; i++)
          expect((await start(u, `${tag}${n}@columbia.edu`, header())).statusCode).toBe(200);
      }
    }

    test('one IP gets 60 codes an hour across accounts, then 429', async () => {
      const before = mail().sent.length;
      await fillIp('limit_ip', () => '203.0.113.50');
      const late = await devLogin(t.app, 'limit_ip_late');
      const r = await start(late, 'ip9@columbia.edu', '203.0.113.50');
      expect(r.statusCode).toBe(429);
      expect(r.json().error).toMatchObject({ code: 'RATE_LIMITED', details: { limit: 60 } });
      expect(mail().sent.length).toBe(before + 60);
      // The same account from another IP is fine: this cap belongs to the IP.
      expect((await start(late, 'ip9@columbia.edu', '203.0.113.51')).statusCode).toBe(200);
    }, 60_000);

    test('the IP is the entry the proxy appended: a client cannot dodge the cap by faking X-Forwarded-For', async () => {
      // Caddy appends the real client (10.0.0.9 here) after whatever the client sent.
      let n = 0;
      const spoofed = () => `${100 + (n >> 8)}.${n++ & 255}.7.7, 10.0.0.9`;
      await fillIp('spoof', spoofed);
      const late = await devLogin(t.app, 'spoof_late');
      const r = await start(late, 'spoof9@columbia.edu', spoofed());
      expect(r.statusCode).toBe(429);
      expect(r.json().error.code).toBe('RATE_LIMITED');
      // A different client behind the proxy has its own bucket, whatever it claims.
      expect((await start(late, 'spoof9@columbia.edu', '10.0.0.9, 10.0.0.10')).statusCode).toBe(
        200,
      );
    }, 60_000);

    test('a refused domain is not counted', async () => {
      const u = await devLogin(t.app, 'limit_typos');
      for (let i = 0; i < 12; i++)
        expect((await start(u, 'me@gmail.com', '203.0.113.60')).statusCode).toBe(400);
      for (let i = 0; i < 5; i++)
        expect((await start(u, 'me@columbia.edu', '203.0.113.60')).statusCode).toBe(200);
      expect((await start(u, 'me@columbia.edu', '203.0.113.60')).statusCode).toBe(429);
    });

    test('a taken address is counted, so it cannot be probed in bulk', async () => {
      const owner = await devLogin(t.app, 'probe_owner');
      expect((await verified(owner, 'probed@columbia.edu')).statusCode).toBe(200);
      const prober = await devLogin(t.app, 'probe_user');
      for (let i = 0; i < 5; i++)
        expect((await start(prober, 'probed@columbia.edu')).json().error.code).toBe(
          'EDU_EMAIL_TAKEN',
        );
      expect((await start(prober, 'probed@columbia.edu')).statusCode).toBe(429);
    });
  });

  describe('one school email per account', () => {
    test('a verified address is refused for another account at send time, whatever its spelling', async () => {
      const a = await devLogin(t.app, 'owner_a');
      const b = await devLogin(t.app, 'owner_b');
      expect((await verified(a, 'owned@columbia.edu')).statusCode).toBe(200);
      const before = mail().sent.length;
      for (const email of [
        'owned@columbia.edu',
        'OWNED@Columbia.edu',
        'owned+lions@columbia.edu',
      ]) {
        const r = await start(b, email);
        expect(r.statusCode, email).toBe(409);
        expect(r.json().error.code).toBe('EDU_EMAIL_TAKEN');
      }
      expect(mail().sent.length).toBe(before);
      // A different mailbox, and the same name on a subdomain, are different addresses.
      expect((await start(b, 'owned2@columbia.edu')).statusCode).toBe(200);
      expect((await start(b, 'owned@cumc.columbia.edu')).statusCode).toBe(200);
      // Only the allowed sends stored a code: the last one is for the subdomain address.
      const pending = t.ctx.db.collection<{ _id: string; emailHash: string }>('edu_codes');
      expect(await pending.findOne({ _id: b.id })).toMatchObject({
        emailHash: schoolHash('owned@cumc.columbia.edu'),
      });
    });

    test('a refused send does not replace the pending code', async () => {
      const a = await devLogin(t.app, 'keep_a');
      const b = await devLogin(t.app, 'keep_b');
      expect((await verified(a, 'keep@columbia.edu')).statusCode).toBe(200);
      const first = await start(b, 'keepb@columbia.edu');
      expect((await start(b, 'keep@columbia.edu')).statusCode).toBe(409);
      expect((await verify(b, first.json().devCode)).statusCode).toBe(200);
    });

    test('the +tag is ignored: the stored hash is of the bare address, the mail goes where it was typed', async () => {
      const a = await devLogin(t.app, 'tag_a');
      const before = mail().sent.length;
      const r = await verified(a, 'Tagged+housing@Columbia.edu');
      expect(r.statusCode, r.body).toBe(200);
      expect(mail().sent[before]?.to).toBe('tagged+housing@columbia.edu');
      expect((await users(t.ctx.db).findOne({ _id: a.id }))?.eduEmailHash).toBe(
        schoolHash('tagged@columbia.edu'),
      );
      const b = await devLogin(t.app, 'tag_b');
      expect((await start(b, 'tagged@columbia.edu')).json().error.code).toBe('EDU_EMAIL_TAKEN');
      expect((await start(b, 'tagged+other@columbia.edu')).json().error.code).toBe(
        'EDU_EMAIL_TAKEN',
      );
    });

    test('verifying again with your own address works, and so does switching to another', async () => {
      const a = await devLogin(t.app, 'again_a');
      expect((await verified(a, 'again@columbia.edu')).statusCode).toBe(200);
      const same = await verified(a, 'again+2@columbia.edu');
      expect(same.statusCode, same.body).toBe(200);
      expect(same.json()).toMatchObject({ verified: true, campus: 'Columbia' });
      const other = await verified(a, 'again@barnard.edu');
      expect(other.json()).toMatchObject({ verified: true, campus: 'Barnard' });
      // The first address is free again.
      const b = await devLogin(t.app, 'again_b');
      expect((await verified(b, 'again@columbia.edu')).statusCode).toBe(200);
    });

    test('two accounts with a code for one address: the second to verify gets 409', async () => {
      const a = await devLogin(t.app, 'race_a');
      const b = await devLogin(t.app, 'race_b');
      const ca = (await start(a, 'race@columbia.edu')).json().devCode;
      const cb = (await start(b, 'race@columbia.edu')).json().devCode;
      expect((await verify(a, ca)).statusCode).toBe(200);
      const lost = await verify(b, cb);
      expect(lost.statusCode).toBe(409);
      expect(lost.json().error.code).toBe('EDU_EMAIL_TAKEN');
      // b stays unverified and its code is spent.
      const me = await t.app.inject({ url: '/v1/me', headers: b.headers });
      expect(me.json()).toMatchObject({ verified: false, campus: null });
      expect((await verify(b, cb)).json().error.code).toBe('EDU_CODE_EXPIRED');
    });

    test('verifying at the same moment gives exactly one winner', async () => {
      const a = await devLogin(t.app, 'tie_a');
      const b = await devLogin(t.app, 'tie_b');
      const ca = (await start(a, 'tie@columbia.edu')).json().devCode;
      const cb = (await start(b, 'tie+b@columbia.edu')).json().devCode;
      const res = await Promise.all([verify(a, ca), verify(b, cb)]);
      expect(res.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(
        await users(t.ctx.db).countDocuments({ eduEmailHash: schoolHash('tie@columbia.edu') }),
      ).toBe(1);
    });

    test('deleting the account frees the address for a new one', async () => {
      const a = await devLogin(t.app, 'gone_a');
      expect((await verified(a, 'gone@columbia.edu')).statusCode).toBe(200);
      const pending = (await start(a, 'gone@columbia.edu')).json().devCode;
      const del = await t.app.inject({ method: 'DELETE', url: '/v1/me', headers: a.headers });
      expect(del.statusCode).toBe(200);
      const doc = await users(t.ctx.db).findOne({ _id: a.id });
      expect(doc?.deletedAt).toBeDefined();
      expect(doc).not.toHaveProperty('eduEmailHash');

      const b = await devLogin(t.app, 'gone_b');
      const r = await verified(b, 'gone@columbia.edu');
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().verified).toBe(true);

      // The deleted account's token still decodes; it must not take the address back.
      expect((await start(a, 'gone@columbia.edu')).statusCode).toBe(401);
      expect((await verify(a, pending)).statusCode).toBe(401);
      expect(await users(t.ctx.db).findOne({ _id: a.id })).not.toHaveProperty('eduEmailHash');
      expect((await users(t.ctx.db).findOne({ _id: b.id }))?.eduEmailHash).toBe(
        schoolHash('gone@columbia.edu'),
      );
    });
  });
});

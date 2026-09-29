import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { FakeMessenger } from '../src/providers/messenger.ts';
import { startGroupChat } from '../src/services/groupChat.ts';
import { LINK_TTL_MS, maskHandle, normalizeHandle } from '../src/services/imessage.ts';
import { devLogin, setupTestApp } from './helpers.ts';

describe('handles', () => {
  test('phones become E.164 (US numbers may omit +1); emails lowercase', () => {
    expect(normalizeHandle('(212) 555-0142')).toBe('+12125550142');
    expect(normalizeHandle('+1 212 555 0142')).toBe('+12125550142');
    expect(normalizeHandle('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizeHandle('Maya@Columbia.EDU')).toBe('maya@columbia.edu');
    expect(normalizeHandle('12')).toBeNull();
    expect(normalizeHandle('not an email@')).toBeNull();
  });
  test('masked for display', () => {
    expect(maskHandle('+12125550142')).toBe('+1••••••0142');
    expect(maskHandle('maya@columbia.edu')).toBe('m•••@columbia.edu');
  });
});

describe('linking a phone by texting a code', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let fake: FakeMessenger;
  let ava: Awaited<ReturnType<typeof devLogin>>;
  const dm = (from: string, text: string, messageId?: string) =>
    fake.receive({ spaceId: `dm:${from}`, group: false, text, senderId: from, messageId });
  const status = async (u = ava) =>
    (await t.app.inject({ method: 'GET', url: '/v1/me/imessage', headers: u.headers })).json();
  const code = async (u = ava) =>
    (
      await t.app.inject({ method: 'POST', url: '/v1/me/imessage/link-code', headers: u.headers })
    ).json();

  beforeAll(async () => {
    t = await setupTestApp({ SPECTRUM_PROJECT_ID: 'p', SPECTRUM_PROJECT_SECRET: 's' });
    fake = new FakeMessenger();
    t.ctx.providers.messenger = fake;
    startGroupChat(t.ctx);
    ava = await devLogin(t.app, 'ava');
  });
  afterAll(() => t.teardown());

  test('get a code, text it from the phone, and the phone is linked', async () => {
    expect(await status()).toEqual({ linked: false, handles: [], agentAddress: '+15550001234' });
    const c = await code();
    expect(c.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(c.smsUrl).toBe(`sms:+15550001234&body=link%20${c.code}`);
    await dm('+12125550142', `link ${c.code.toLowerCase()}`);
    expect(fake.sent.at(-1)?.text).toMatch(/^Linked to @ava ✅/);
    expect(await status()).toMatchObject({ linked: true, handles: ['+1••••••0142'] });
    // Single use.
    await dm('+12125550143', `link ${c.code}`);
    expect(fake.sent.at(-1)?.text).toMatch(/expired or was already used/);
  });

  test('an expired code does not link', async () => {
    const c = await code();
    t.ctx.clock.offsetMs += LINK_TTL_MS + 1000;
    try {
      await dm('+12125550199', `link ${c.code}`);
      expect(fake.sent.at(-1)?.text).toMatch(/expired/);
    } finally {
      t.ctx.clock.offsetMs = 0;
    }
  });

  test('a phone moves to whoever proves it last; unlinking drops it', async () => {
    const ben = await devLogin(t.app, 'ben');
    const c = await code(ben);
    await dm('+12125550142', `link ${c.code}`); // ava's phone
    expect((await status(ben)).linked).toBe(true);
    expect((await status()).linked).toBe(false);
    await t.app.inject({ method: 'DELETE', url: '/v1/me/imessage', headers: ben.headers });
    expect((await status(ben)).linked).toBe(false);
  });

  test('the same delivery twice is handled once', async () => {
    const c = await code();
    const before = fake.sent.length;
    await dm('+12125550150', `link ${c.code}`, 'msg-1');
    await dm('+12125550150', `link ${c.code}`, 'msg-1');
    expect(fake.sent.length).toBe(before + 1);
  });

  test('dev route links demo accounts directly', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/dev/imessage/link',
      payload: { username: 'ava', handle: '646-555-0101' },
    });
    expect(r.json().linked).toBe(true);
    expect(r.json().handles).toContain('+1••••••0101');
  });
});

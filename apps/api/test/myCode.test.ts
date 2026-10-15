import { parseTagUrl } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { codeSecret, hashSecret, personalCode, type TagDoc, tags } from '../src/services/tags.ts';
import { ORIGIN, offset } from './fixtures/places.ts';
import { personalTag } from './fixtures/tags.ts';
import { devLogin, setupTestApp } from './helpers.ts';

/** T7: POST /me/code mints a personal QR code whose secret is HMAC-derived, so only its hash is stored. */
let t: Awaited<ReturnType<typeof setupTestApp>>;
type User = Awaited<ReturnType<typeof devLogin>>;
const here = { ...ORIGIN, accuracy: 10 };

const code = (who: User) =>
  t.app.inject({ method: 'POST', url: '/v1/me/code', headers: who.headers });
const tap = (who: User, url: string, extra: object = {}) =>
  t.app.inject({
    method: 'POST',
    url: '/v1/taps',
    headers: who.headers,
    payload: { url, ...here, ...extra },
  });
const tagDoc = (id: string) => tags(t.ctx.db).findOne({ _id: id });
const myTags = (who: User) => tags(t.ctx.db).find({ ownerId: who.id }).toArray();
const tagIdOf = async (who: User) =>
  (await t.app.inject({ url: '/v1/me', headers: who.headers })).json().tagId;

beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.teardown());

describe('POST /me/code', () => {
  test('needs a signed-in user; takes no body, with or without a JSON content type', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/v1/me/code' })).statusCode).toBe(401);
    const zoe = await devLogin(t.app, 'codezoe');
    const typed = await t.app.inject({
      method: 'POST',
      url: '/v1/me/code',
      headers: { ...zoe.headers, 'content-type': 'application/json' },
    });
    expect(typed.statusCode, typed.body).toBe(200);
  });

  test('mints a personal tag once; every call after returns the same URL', async () => {
    const maya = await devLogin(t.app, 'codemaya');
    expect(await tagIdOf(maya)).toBeNull();
    const first = await code(maya);
    expect(first.statusCode, first.body).toBe(200);
    const { kind, tagId, url } = first.json();
    expect(kind).toBe('code');
    expect(parseTagUrl(url)).toMatchObject({ kind: 'personal', id: tagId });
    expect(url.startsWith(`${t.ctx.config.PUBLIC_BASE_URL}/t/${tagId}?k=`)).toBe(true);
    expect(await tagDoc(tagId)).toMatchObject({ kind: 'personal', ownerId: maya.id });
    expect(await tagIdOf(maya)).toBe(tagId);

    expect((await code(maya)).json()).toEqual(first.json());
    // Calls racing on a first mint end with one tag, one URL.
    const sam = await devLogin(t.app, 'codesam');
    const raced = await Promise.all([1, 2, 3, 4].map(() => code(sam)));
    expect(raced.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    expect(new Set(raced.map((r) => r.json().url)).size).toBe(1);
    expect(await myTags(sam)).toHaveLength(1);
    expect(await tagIdOf(sam)).toBe(raced[0]!.json().tagId);
  });

  test('the URL’s secret is HMAC(key, tagId); only its hash is stored, and it verifies at POST /taps', async () => {
    const lee = await devLogin(t.app, 'codelee');
    const reader = await devLogin(t.app, 'codereader');
    const { tagId, url } = (await code(lee)).json();
    const k = parseTagUrl(url)!.k;
    expect(k).toBe(codeSecret(t.ctx.config.JWT_SECRET, tagId));
    expect(k).toMatch(/^[A-Za-z0-9_-]{16}$/); // same shape as a sticker's secret
    const doc = (await tagDoc(tagId))!;
    expect(doc.secretHash).toBe(hashSecret(k));
    expect(JSON.stringify(doc)).not.toContain(k);
    // The same tag under another server key has another secret.
    expect(codeSecret('a-different-jwt-secret-32-characters!', tagId)).not.toBe(k);

    // verifyTag accepts it (whether scanned as a URL or as id + secret) and refuses a wrong one.
    expect((await tap(reader, url)).json()).toMatchObject({
      kind: 'personal',
      status: 'waiting',
      friend: { id: lee.id },
    });
    const byParts = await tap(reader, '', { url: undefined, tagId, k });
    expect(byParts.statusCode, byParts.body).toBe(200);
    const wrong = await tap(reader, url.replace(/k=.*$/, 'k=wrong-secret'));
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('TAG_INVALID');
  });

  test('two phones pair by scanning each other’s code, within 2 minutes and 50 m', async () => {
    const ann = await devLogin(t.app, 'codeann');
    const ben = await devLogin(t.app, 'codeben');
    const annCode = (await code(ann)).json().url;
    const benCode = (await code(ben)).json().url;
    const first = await tap(ann, benCode);
    expect(first.json()).toMatchObject({ status: 'waiting', friend: { id: ben.id } });
    const second = await tap(ben, annCode, offset(ORIGIN, 20, 0));
    expect(second.json()).toMatchObject({
      status: 'friends',
      friend: { id: ann.id },
      streak: { weeks: 1, hangouts: 1 },
    });
    const friends = (await t.app.inject({ url: '/v1/friends', headers: ann.headers })).json();
    expect(friends.items.map((i: { user: { id: string } }) => i.user.id)).toEqual([ben.id]);

    // Too far apart: the second scan only waits.
    const cat = await devLogin(t.app, 'codecat');
    const dan = await devLogin(t.app, 'codedan');
    const catCode = (await code(cat)).json().url;
    const danCode = (await code(dan)).json().url;
    await tap(cat, danCode);
    expect((await tap(dan, catCode, offset(ORIGIN, 200, 0))).json().status).toBe('waiting');
  });

  test('binding a sticker replaces the code: kind sticker, no URL, the old QR is dead', async () => {
    const eve = await devLogin(t.app, 'codeeve');
    const stranger = await devLogin(t.app, 'codestranger');
    const { tagId: codeId, url: codeUrl } = (await code(eve)).json();

    const sticker = await personalTag(t.ctx.db);
    const bound = await t.app.inject({
      method: 'POST',
      url: '/v1/me/tag',
      headers: eve.headers,
      payload: { url: sticker.url },
    });
    expect(bound.json()).toMatchObject({ tagId: sticker.id });

    const after = await code(eve);
    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual({ kind: 'sticker', tagId: sticker.id, url: null });
    expect((await code(eve)).json()).toEqual(after.json()); // still idempotent
    // Nothing new was minted, and the old code no longer belongs to anyone.
    expect((await myTags(eve)).map((x) => x._id)).toEqual([sticker.id]);
    expect(await tagDoc(codeId)).not.toHaveProperty('ownerId');
    const dead = await tap(stranger, codeUrl);
    expect(dead.statusCode).toBe(400);
    expect(dead.json().error.code).toBe('TAG_INVALID');
  });

  test('a code is not a sticker: it cannot be bound with POST /me/tag, not even after a sticker unbound it', async () => {
    const jay = await devLogin(t.app, 'codejay');
    const kim = await devLogin(t.app, 'codekim');
    const bind = (who: User, url: string) =>
      t.app.inject({ method: 'POST', url: '/v1/me/tag', headers: who.headers, payload: { url } });
    const { url } = (await code(jay)).json();
    expect((await bind(jay, url)).statusCode).toBe(400);
    expect((await bind(kim, url)).statusCode).toBe(400);
    await bind(jay, (await personalTag(t.ctx.db)).url);
    const stolen = await bind(kim, url);
    expect(stolen.statusCode).toBe(400);
    expect(stolen.json().error.code).toBe('TAG_INVALID');
    expect(await tagIdOf(kim)).toBeNull();
  });

  test('a code and a sticker pair with each other', async () => {
    const fay = await devLogin(t.app, 'codefay'); // code
    const gus = await devLogin(t.app, 'codegus'); // sticker
    const fayCode = (await code(fay)).json().url;
    const sticker = await personalTag(t.ctx.db);
    await t.app.inject({
      method: 'POST',
      url: '/v1/me/tag',
      headers: gus.headers,
      payload: { url: sticker.url },
    });
    expect((await tap(gus, fayCode)).json().status).toBe('waiting');
    expect((await tap(fay, sticker.url)).json()).toMatchObject({
      status: 'friends',
      friend: { id: gus.id },
    });
  });

  test('a rotated JWT_SECRET keeps the tag and re-hashes it to the new key’s secret', async () => {
    const hal = await devLogin(t.app, 'codehal');
    const reader = await devLogin(t.app, 'codereader2');
    const before = (await code(hal)).json();
    const rotated = {
      ...t.ctx,
      config: { ...t.ctx.config, JWT_SECRET: 'rotated-jwt-secret-of-32-characters!!' },
    };
    const after = await personalCode(rotated, hal.id);
    expect(after).toMatchObject({ kind: 'code', tagId: before.tagId });
    expect(after.url).not.toBe(before.url);
    expect((await tagDoc(before.tagId))!.secretHash).toBe(hashSecret(parseTagUrl(after.url!)!.k));
    // The printed old code is dead; the rebuilt one works.
    expect((await tap(reader, before.url)).statusCode).toBe(400);
    expect((await tap(reader, after.url!)).statusCode).toBe(200);
    expect(await myTags(hal)).toHaveLength(1);
  });

  test('a user whose tagId points at a missing tag gets a fresh code', async () => {
    const ivy = await devLogin(t.app, 'codeivy');
    await t.ctx.db
      .collection('users')
      .updateOne({ _id: ivy.id } as never, { $set: { tagId: 'GONE' } });
    const r = (await code(ivy)).json();
    expect(r.kind).toBe('code');
    expect(r.tagId).not.toBe('GONE');
    expect(await tagIdOf(ivy)).toBe(r.tagId);
    const doc = (await tagDoc(r.tagId)) as TagDoc;
    expect(doc.ownerId).toBe(ivy.id);
  });
});

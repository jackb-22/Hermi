import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { venueTag } from './fixtures/tags.ts';
import { devLogin, setupTestApp } from './helpers.ts';

/** T15: a block ends the friendship, and nothing lets the pair back together while it stands. */
let t: Awaited<ReturnType<typeof setupTestApp>>;
type User = Awaited<ReturnType<typeof devLogin>>;
const here = { ...ORIGIN, accuracy: 10 };
const unknownUser = () => ({ error: { code: 'NOT_FOUND', message: 'No such user' } });

const call = (
  who: User,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) => t.app.inject({ method, url, headers: who.headers, payload });
const block = (who: User, other: User) => call(who, 'POST', '/v1/blocks', { userId: other.id });
const unblock = (who: User, other: User) => call(who, 'DELETE', `/v1/blocks/${other.id}`);
const codeOf = async (who: User) => (await call(who, 'POST', '/v1/me/code')).json().url as string;
const tap = (who: User, url: string, extra: object = {}) =>
  call(who, 'POST', '/v1/taps', { url, ...here, ...extra });
/** Two people tap each other's codes: the real way to become friends. */
async function pair(x: User, y: User) {
  await tap(x, await codeOf(y));
  return tap(y, await codeOf(x), offset(ORIGIN, 10, 0));
}
const friendIdsOf = async (who: User) =>
  (await call(who, 'GET', '/v1/friends'))
    .json()
    .items.map((i: { user: { id: string } }) => i.user.id);
const friendship = (x: User, y: User) =>
  t.ctx.db.collection('friendships').findOne({ _id: [x.id, y.id].sort().join(':') } as never);
const hangoutRows = async (x: User, y: User) =>
  (
    await t.ctx.tiger.query('select 1 from hangouts where pair_key = $1', [
      [x.id, y.id].sort().join(':'),
    ])
  ).rowCount;
const readRows = async (...who: User[]) =>
  (
    await t.ctx.tiger.query('select 1 from tag_reads where user_id = any($1)', [
      who.map((u) => u.id),
    ])
  ).rowCount;
/** A friendship as it was written before blocks ended them. */
const legacyFriends = (x: User, y: User) => {
  const [a, b] = [x.id, y.id].sort();
  return t.ctx.db.collection('friendships').insertOne({
    _id: `${a}:${b}`,
    a,
    b,
    since: new Date(),
    hangouts: 1,
    streakWeeks: 1,
    lastHangoutWeek: 0,
  } as never);
};

beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.teardown());

describe('POST /blocks', () => {
  test('ends the friendship whichever of the two blocks; the hangout log stays; unblocking does not restore it', async () => {
    for (const [name, blockerFirst] of [
      ['a', true],
      ['b', false],
    ] as const) {
      const x = await devLogin(t.app, `blkx${name}`);
      const y = await devLogin(t.app, `blky${name}`);
      expect((await pair(x, y)).json().status).toBe('friends');
      expect(await friendIdsOf(x)).toEqual([y.id]);
      expect(await hangoutRows(x, y)).toBe(1);

      const [blocker, blocked] = blockerFirst ? [x, y] : [y, x];
      expect((await block(blocker, blocked)).statusCode).toBe(200);
      expect(await friendship(x, y)).toBeNull();
      expect(await friendIdsOf(x)).toEqual([]);
      expect(await friendIdsOf(y)).toEqual([]);
      // The log is history, only read next to a friendship; blocking twice is harmless.
      expect(await hangoutRows(x, y)).toBe(1);
      expect((await block(blocker, blocked)).statusCode).toBe(200);

      expect((await unblock(blocker, blocked)).statusCode).toBe(200);
      expect(await friendship(x, y)).toBeNull();
      expect(await friendIdsOf(blocker)).toEqual([]);
      expect((await call(blocker, 'GET', `/v1/profile/${blocked.id}`)).json()).toMatchObject({
        isFriend: false,
        streak: null,
      });

      // Friends again only by tapping again, and the streak starts over. The earlier taps are still inside
      // their 2 minutes, so the first new tap completes it.
      expect((await pair(x, y)).json()).toMatchObject({ streak: { weeks: 1, hangouts: 1 } });
      expect(await friendship(x, y)).toMatchObject({ hangouts: 1, streakWeeks: 1 });
      expect(await friendIdsOf(x)).toEqual([y.id]);
    }
  });

  test('withdraws the invites and join requests waiting between the two, and only those', async () => {
    const [ann, ben, cy] = await Promise.all(
      ['inva', 'invb', 'invc'].map((n) => devLogin(t.app, n)),
    );
    for (const [x, y] of [
      [ann!, ben!],
      [ann!, cy!],
      [ben!, cy!],
    ] as const)
      await legacyFriends(x, y);
    const place = (
      await insertPlaces(t.ctx.db, [placeDoc({ name: 'Cafe', category: 'food', at: ORIGIN })])
    )[0]!;
    const plan = async (host: User, invitees: User[]) => {
      const p = (
        await call(host, 'POST', '/v1/plans', {
          name: `${host.id} plan`,
          startAt: new Date(Date.now() + 86_400_000).toISOString(),
          stops: [{ placeId: place._id }],
        })
      ).json();
      const saved = await call(host, 'POST', `/v1/plans/${p.id}/save`, {
        visibility: 'invite',
        inviteeIds: invitees.map((u) => u.id),
      });
      expect(saved.statusCode, saved.body).toBe(200);
      return p.id as string;
    };
    const members = async (id: string) =>
      (
        (await t.ctx.db.collection('plans').findOne({ _id: id } as never)) as unknown as {
          members: { userId: string; status: string }[];
        }
      ).members.map(
        (m) => `${m.userId === ann!.id ? 'ann' : m.userId === ben!.id ? 'ben' : 'cy'}:${m.status}`,
      );

    const annPlan = await plan(ann!, [cy!]);
    const annInvite = await plan(ann!, [ben!, cy!]);
    const benPlan = await plan(ben!, [ann!, cy!]);
    const cyPlan = await plan(cy!, [ann!, ben!]);
    // A join request from ben on ann's plan, as Find someone would leave it.
    await t.ctx.db.collection('plans').updateOne(
      { _id: annPlan } as never,
      {
        $push: { members: { userId: ben!.id, status: 'requested', at: new Date() } },
      } as never,
    );
    expect(await members(annPlan)).toEqual(['cy:invited', 'ben:requested']);

    await block(ann!, ben!);
    expect(await members(annPlan)).toEqual(['cy:invited']);
    expect(await members(annInvite)).toEqual(['cy:invited']);
    expect(await members(benPlan)).toEqual(['cy:invited']);
    // A plan hosted by someone else keeps its invites to both of them.
    expect(await members(cyPlan)).toEqual(['ann:invited', 'ben:invited']);
  });
});

describe('POST /taps between a blocked pair', () => {
  test('is refused as an unknown user in both directions: no card, no read, no friendship', async () => {
    const eve = await devLogin(t.app, 'tapeve');
    const fox = await devLogin(t.app, 'tapfox');
    const zed = await devLogin(t.app, 'tapzed');
    const eveCode = await codeOf(eve);
    const foxCode = await codeOf(fox);
    await block(eve, fox);

    const unknown = (await call(eve, 'GET', '/v1/taps/pending?friendId=no-such-user')).json();
    expect(unknown).toMatchObject(unknownUser());
    for (const [who, url] of [
      [fox, eveCode],
      [eve, foxCode],
    ] as const) {
      const r = await tap(who, url);
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual(unknown);
    }
    expect(await readRows(eve, fox)).toBe(0);
    expect(await friendship(eve, fox)).toBeNull();
    expect(await hangoutRows(eve, fox)).toBe(0);

    // Someone else tapping the same code is unaffected.
    expect((await tap(zed, eveCode)).json()).toMatchObject({
      status: 'waiting',
      friend: { id: eve.id },
    });
    // So is checking in at a venue tag: a block only stops the pairing.
    const [bar] = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Bar', category: 'drinks', at: ORIGIN }),
    ]);
    const vt = await venueTag(t.ctx.db, bar!._id);
    for (const who of [eve, fox])
      expect((await tap(who, vt.url)).json()).toMatchObject({
        kind: 'venue',
        status: 'checked_in',
      });
    expect(await friendship(eve, fox)).toBeNull();

    // Unblocked, the same two can pair.
    await unblock(eve, fox);
    expect((await tap(fox, eveCode)).json().status).toBe('waiting');
    expect((await tap(eve, foxCode)).json()).toMatchObject({
      status: 'friends',
      friend: { id: fox.id },
    });
  });

  test('a block between the two taps stops the second from completing the pairing', async () => {
    const gus = await devLogin(t.app, 'tapgus');
    const hal = await devLogin(t.app, 'taphal');
    const gusCode = await codeOf(gus);
    expect((await tap(gus, await codeOf(hal))).json().status).toBe('waiting');
    await block(hal, gus);
    const r = await tap(hal, gusCode);
    expect(r.statusCode).toBe(404);
    expect(await friendship(gus, hal)).toBeNull();
    expect(await hangoutRows(gus, hal)).toBe(0);
    // The one that was refused wrote no read either: only gus's earlier tap is on record.
    expect(await readRows(hal)).toBe(0);
  });
});

describe('GET /friends', () => {
  test('hides a friendship left over from before blocks ended them, both ways, and keeps the rest', async () => {
    const ivy = await devLogin(t.app, 'frivy');
    const jon = await devLogin(t.app, 'frjon');
    const kit = await devLogin(t.app, 'frkit');
    await legacyFriends(ivy, jon);
    await legacyFriends(ivy, kit);
    expect((await friendIdsOf(ivy)).sort()).toEqual([jon.id, kit.id].sort());
    // Written straight to the collection, as the old POST /blocks left it.
    await t.ctx.db
      .collection('blocks')
      .insertOne({ blocker: jon.id, blocked: ivy.id, createdAt: new Date() });
    expect(await friendIdsOf(ivy)).toEqual([kit.id]);
    expect(await friendIdsOf(jon)).toEqual([]);
    expect(await friendIdsOf(kit)).toEqual([ivy.id]);
  });
});

describe('shared plan links', () => {
  let host: User;
  let viewer: User;
  let token: string;
  let planId: string;
  const byToken = (who: User, tk = token) => call(who, 'GET', `/v1/plans/by-token/${tk}`);

  beforeAll(async () => {
    host = await devLogin(t.app, 'lnkhost');
    viewer = await devLogin(t.app, 'lnkviewer');
    const place = (
      await insertPlaces(t.ctx.db, [placeDoc({ name: 'Park', category: 'nature', at: ORIGIN })])
    )[0]!;
    const p = (
      await call(host, 'POST', '/v1/plans', {
        name: 'Picnic',
        startAt: new Date(Date.now() + 86_400_000).toISOString(),
        stops: [{ placeId: place._id }],
      })
    ).json();
    planId = p.id;
    token = p.shareUrl.split('/p/')[1];
  });

  test('a stranger, and the host, can open the link', async () => {
    expect((await byToken(viewer)).json()).toMatchObject({ id: planId, name: 'Picnic' });
    expect((await byToken(host)).statusCode).toBe(200);
    const web = await t.app.inject({ url: `/p/${token}` });
    expect(web.statusCode).toBe(200);
    expect(web.body).toContain('Picnic');
  });

  test('a host blocked either way with the viewer reads as an expired link', async () => {
    const expired = await byToken(viewer, 'no-such-token');
    expect(expired.statusCode).toBe(404);
    for (const [blocker, blocked] of [
      [viewer, host],
      [host, viewer],
    ] as const) {
      await block(blocker, blocked);
      const r = await byToken(viewer);
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual(expired.json());
      expect((await byToken(host)).statusCode).toBe(200); // the host's own link still opens
      // The web page has no signed-in viewer, so a block cannot apply to it.
      expect((await t.app.inject({ url: `/p/${token}` })).statusCode).toBe(200);
      await unblock(blocker, blocked);
      expect((await byToken(viewer)).statusCode).toBe(200);
    }
  });

  test('a deleted host kills the link, in the app and on the web', async () => {
    await t.ctx.db
      .collection('users')
      .updateOne({ _id: host.id } as never, { $set: { deletedAt: new Date() } });
    expect((await byToken(viewer)).statusCode).toBe(404);
    const web = await t.app.inject({ url: `/p/${token}` });
    expect(web.statusCode).toBe(404);
    expect(web.body).toContain('Link expired');
    expect(web.body).not.toContain('Picnic');
  });
});

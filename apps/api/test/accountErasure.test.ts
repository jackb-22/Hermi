import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { handlers } from '../src/jobs/handlers.ts';
import { Worker } from '../src/jobs/queue.ts';
import { MemoryStorage } from '../src/providers/storage.ts';
import { eraseAccount, queueMissingErasures } from '../src/services/accountErasure.ts';
import type { MediaDoc } from '../src/services/media.ts';
import { remember } from '../src/services/memory.ts';
import { logHangout } from '../src/services/social.ts';
import { checkinWithMedia } from './fixtures/media.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { personalTag } from './fixtures/tags.ts';
import { walk } from './fixtures/trace.ts';
import { devLogin, setupTestApp } from './helpers.ts';

// RustFS, as in media.test.ts: the bytes are really stored, so "gone" means gone from the bucket.
const S3 = {
  S3_ENDPOINT: 'http://localhost:9000',
  S3_KEY: 's3dev',
  S3_SECRET: 's3dev12345',
  S3_FORCE_PATH_STYLE: '1',
  S3_BUCKET: 'itp-test',
};

type User = Awaited<ReturnType<typeof devLogin>>;
type App = Awaited<ReturnType<typeof setupTestApp>>;

const HANDLE = '+15551230001';
const STRANGER_HANDLE = '+15559990000';
const DEVICE = 'c'.repeat(64);
const EDU_HASH = 'edu-hash-of-maya';
const DAY = 86_400_000;

let t: App;
let worker: Worker;
let maya: User;
let sam: User;
let ben: User;
let cleo: User;
let cafe: string;
let park: string;
let samPostId: string;
let mayaPostIds: string[];
let planA: string; // maya hosts, upcoming, sam joined
let planB: string; // maya hosts, completed, sam joined
let planC: string; // cleo hosts, maya and sam joined
let planD: string; // maya's private draft
let planBToken: string;
/** Every storage key that belongs to maya, and the ones that belong to sam. */
const mayaKeys: string[] = [];
const samKeys: string[] = [];

const db = () => t.ctx.db;
const col = (name: string) => db().collection(name);
const tiger = () => t.ctx.tiger;
const storage = () => t.ctx.providers.storage;
const call = (
  who: User,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) => t.app.inject({ method, url, headers: who.headers, payload });
const quiet = { info: () => {}, error: () => {} };
const doc = <T = Record<string, unknown>>(coll: string, id: string) =>
  col(coll).findOne({ _id: id as never }) as Promise<T | null>;

const befriend = async (x: string, y: string) => {
  const [a, b] = [x, y].sort();
  await col('friendships').insertOne({
    _id: `${a}:${b}`,
    a,
    b,
    since: new Date(),
    hangouts: 1,
    streakWeeks: 1,
    lastHangoutWeek: 0,
  } as never);
};

/** A captured photo/clip as the worker would leave it: original, rendition, poster and signed copy all in storage. */
async function renderedMedia(
  owner: User,
  placeId: string,
  at: { lat: number; lng: number },
  kinds: ('photo' | 'video')[],
  keys: string[],
) {
  const { checkin, media } = await checkinWithMedia(t.ctx, owner.id, placeId, at, kinds);
  for (const m of media) {
    const hex = () => randomBytes(8).toString('hex');
    const rendition: NonNullable<MediaDoc['rendition']> =
      m.kind === 'video'
        ? { key: `r/${hex()}.mp4`, posterKey: `r/${hex()}.jpg`, contentType: 'video/mp4' }
        : { key: `r/${hex()}.jpg`, contentType: 'image/jpeg' };
    const c2pa = { manifestKey: `c2pa/${hex()}.jpg`, signedAt: new Date(), signer: null };
    for (const k of [rendition.key, rendition.posterKey, c2pa.manifestKey])
      if (k) await storage().put(k, Buffer.from('rendered'), 'image/jpeg', { public: true });
    await col('media').updateOne({ _id: m._id as never }, { $set: { rendition, c2pa } });
    keys.push(
      m.key,
      rendition.key,
      ...(rendition.posterKey ? [rendition.posterKey] : []),
      c2pa.manifestKey,
    );
  }
  return { checkin, media };
}

const post = async (who: User, payload: object) => {
  const r = await call(who, 'POST', '/v1/posts', payload);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
};

const bind = async (who: User) => {
  const tag = await personalTag(db());
  const r = await call(who, 'POST', '/v1/me/tag', { url: tag.url });
  expect(r.statusCode, r.body).toBe(200);
  return tag;
};

beforeAll(async () => {
  t = await setupTestApp({ ...S3 });
  worker = new Worker(t.ctx, handlers, quiet);
  const [c, p] = await insertPlaces(db(), [
    placeDoc({ name: 'Corner Cafe', category: 'food', at: ORIGIN }),
    placeDoc({ name: 'Green Park', category: 'nature', at: offset(ORIGIN, 400, 0) }),
  ]);
  [cafe, park] = [c!._id, p!._id];
  [maya, sam, ben, cleo] = [
    await devLogin(t.app, 'maya'),
    await devLogin(t.app, 'sam'),
    await devLogin(t.app, 'ben'),
    await devLogin(t.app, 'cleo'),
  ] as [User, User, User, User];
  for (const [who, name] of [
    [maya, 'Maya Chen'],
    [sam, 'Sam Rivera'],
    [ben, 'Ben Okafor'],
    [cleo, 'Cleo Park'],
  ] as const)
    await call(who, 'PATCH', '/v1/me', { name });

  // --- maya: profile, school email, phone, device, taste, memories ---
  await col('users').updateOne(
    { _id: maya.id as never },
    {
      $set: {
        verifiedAt: new Date(),
        campus: 'Columbia',
        gradYear: 2028,
        eduEmailHash: EDU_HASH,
        imessageHandles: [HANDLE],
        prefVector: [0.5, 0.5],
      },
    },
  );
  await call(maya, 'POST', '/v1/me/push-token', { token: DEVICE });
  const dir = mkdtempSync(join(tmpdir(), 'itp-erase-'));
  execFileSync('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=96x96'],
    ...['-frames:v', '1', join(dir, 'me.jpg')],
  ]);
  const photo = await t.app.inject({
    method: 'POST',
    url: '/v1/me/photo',
    headers: { ...maya.headers, 'content-type': 'image/jpeg' },
    payload: readFileSync(join(dir, 'me.jpg')),
  });
  expect(photo.statusCode, photo.body).toBe(200);
  const mayaDoc = (await doc<{ photoKey: string }>('users', maya.id))!;
  mayaKeys.push(mayaDoc.photoKey);
  // An upload under review, an earlier profile original and a presigned upload that landed without its doc.
  const review = {
    key: `p/${randomBytes(8).toString('hex')}.jpg`,
    origKey: `orig/profile/${maya.id}/${newId()}.jpg`,
    contentType: 'image/jpeg',
    status: 'scanning',
    at: new Date(),
  };
  const oldOriginal = `orig/profile/${maya.id}/${newId()}.jpg`;
  const lateUpload = `orig/${maya.id}/${newId()}.jpg`;
  for (const k of [review.key, review.origKey, oldOriginal, lateUpload])
    await storage().put(k, Buffer.from('photo-bytes'), 'image/jpeg');
  mayaKeys.push(review.key, review.origKey, oldOriginal, lateUpload);
  await col('users').updateOne({ _id: maya.id as never }, { $set: { photoReview: review } });

  await remember(t.ctx, maya.id, 'Likes quiet cafes', 'ask');
  await remember(t.ctx, sam.id, 'Hates queues', 'ask');
  for (const id of [maya.id, sam.id]) {
    await col('behavior_events').insertOne({
      _id: newId() as never,
      userId: id,
      kind: 'ghost_skipped',
      placeId: park,
      at: new Date(),
    });
    await col('user_tiles').insertOne({ userId: id, x: 1, y: 2, firstAt: new Date() } as never);
    await col('attest_keys').insertOne({
      _id: newId() as never,
      userId: id,
      publicKey: 'pk',
      signCount: 0,
      createdAt: new Date(),
    });
    await col('attest_challenges').insertOne({
      _id: newId() as never,
      userId: id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await col('edu_codes').insertOne({
      _id: id as never,
      codeHash: 'h',
      emailHash: 'e',
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await col('imessage_links').insertOne({
      _id: `L${id.slice(-5)}` as never,
      userId: id,
      expiresAt: new Date(Date.now() + 60_000),
    });
  }
  await col('photon_lines').insertMany([
    { _id: newId(), spaceId: 'grp', sender: HANDLE, text: 'see you there', at: new Date() },
    { _id: newId(), spaceId: 'grp', sender: STRANGER_HANDLE, text: 'ok', at: new Date() },
  ] as never[]);

  // --- check-ins, captures, posts, reviews ---
  const mayaCafe = await renderedMedia(maya, cafe, ORIGIN, ['photo', 'photo', 'video'], mayaKeys);
  const mayaPark = await renderedMedia(maya, park, offset(ORIGIN, 400, 0), ['photo'], mayaKeys);
  const samCafe = await renderedMedia(sam, cafe, ORIGIN, ['photo'], samKeys);
  await storage().put(`orig/profile/${sam.id}/keep.jpg`, Buffer.from('sam'), 'image/jpeg');
  samKeys.push(`orig/profile/${sam.id}/keep.jpg`);
  await befriend(sam.id, ben.id);
  await befriend(maya.id, cleo.id);
  mayaPostIds = [
    await post(maya, {
      mediaIds: [mayaCafe.media[0]!._id, mayaCafe.media[1]!._id],
      caption: 'secret pierogi',
    }),
    await post(maya, { mediaIds: [mayaCafe.media[2]!._id] }),
  ];
  samPostId = await post(sam, { mediaIds: [samCafe.media[0]!._id], caption: 'sam at the cafe' });
  const rev = await call(maya, 'POST', '/v1/reviews', {
    checkinId: mayaPark.checkin.id,
    again: false,
    text: 'too windy for me',
  });
  expect(rev.statusCode, rev.body).toBe(200);
  mayaPostIds.push(rev.json().post.id);
  await worker.drain(); // moderation: everything goes live

  // --- friends by tapping tags: a friendship, hangouts and tag reads on both sides ---
  const mayaTag = await bind(maya);
  const samTag = await bind(sam);
  const here = { ...ORIGIN, accuracy: 10 };
  await call(maya, 'POST', '/v1/taps', { url: samTag.url, ...here });
  const tapped = await call(sam, 'POST', '/v1/taps', { url: mayaTag.url, ...here });
  expect(tapped.json().status).toBe('friends');
  await logHangout(t.ctx, sam.id, ben.id, new Date(), 'tap');

  // --- location, movement and XP, including days old enough to sit in the rollups ---
  for (const who of [maya, sam]) {
    const s = await call(who, 'POST', '/v1/sessions', {});
    expect(s.statusCode, s.body).toBe(200);
    const pts = walk([ORIGIN, offset(ORIGIN, 300, 0)], new Date(Date.now() - 10 * 60_000));
    await call(who, 'POST', `/v1/sessions/${s.json().session.id}/points`, { points: pts });
    const old = new Date(Date.now() - 10 * DAY);
    await tiger().query(
      `insert into xp_events (time, user_id, campus, kind, xp, ref_id) values ($1, $2, 'Columbia', 'checkin_gps', 10, 'old')`,
      [old, who.id],
    );
    await tiger().query(
      `insert into movement_segments (time, end_time, user_id, session_id, mode, meters, steps) values ($1, $2, $3, 'old-sess', 'walk', 500, 600)`,
      [old, new Date(old.getTime() + 600_000), who.id],
    );
  }
  for (const view of ['xp_daily', 'movement_daily'])
    await tiger().query(
      `call refresh_continuous_aggregate('${view}', now() - interval '30 days', now() - interval '5 days')`,
    );

  // --- plans ---
  const stops = [{ placeId: cafe }, { placeId: park }];
  const startAt = new Date(Date.now() + DAY).toISOString();
  const mk = async (who: User, name: string) =>
    (await call(who, 'POST', '/v1/plans', { name, startAt, stops })).json().id as string;
  planA = await mk(maya, 'Brunch with Maya Chen');
  planB = await mk(maya, 'Maya Chen birthday crawl');
  planD = await mk(maya, 'Maya private draft');
  planC = await mk(cleo, 'Cleo picnic');
  for (const [host, plan, who] of [
    [maya, planA, sam],
    [maya, planB, sam],
    [cleo, planC, maya],
    [cleo, planC, sam],
  ] as const) {
    if (host === cleo && who === sam) await befriend(cleo.id, sam.id);
    const saved = await call(host, 'POST', `/v1/plans/${plan}/save`, {
      visibility: 'invite',
      inviteeIds: [who.id],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const joined = await call(who, 'POST', `/v1/plans/${plan}/join`, {});
    expect(joined.statusCode, joined.body).toBe(200);
  }
  planBToken = (await doc<{ shareToken: string }>('plans', planB))!.shareToken;
  await col('plans').updateOne(
    { _id: planB as never },
    {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        imessageThreadId: 'thread-1',
        imessageRsvps: [HANDLE],
        textUndo: { at: new Date(), name: 'Maya Chen draft', members: [], stops: [] },
      },
    },
  );
  await col('plans').updateOne(
    { _id: planC as never },
    { $set: { imessageRsvps: [HANDLE, STRANGER_HANDLE], notifiedMatchIds: [maya.id, ben.id] } },
  );
  await col('sessions').insertOne({
    _id: 'sam-recap-session',
    userId: sam.id,
    planId: planB,
    kind: 'plan',
    status: 'ended',
    startedAt: new Date(),
    pointsAccepted: 0,
    pointsRejected: 0,
    recap: { planName: 'Maya Chen birthday crawl', stops: [] },
  } as never);

  // --- saves, folders, blocks, reports, queued pushes ---
  const folder = (await call(maya, 'POST', '/v1/folders', { name: 'Date ideas' })).json();
  await call(maya, 'POST', '/v1/saves', { type: 'place', refId: cafe, folderId: folder.id });
  await call(maya, 'POST', '/v1/saves', { type: 'post', refId: samPostId });
  await call(sam, 'POST', '/v1/saves', { type: 'place', refId: cafe });
  await call(sam, 'POST', '/v1/saves', { type: 'post', refId: mayaPostIds[0] });
  await col('blocks').insertMany([
    { blocker: maya.id, blocked: cleo.id, createdAt: new Date() },
    { blocker: cleo.id, blocked: maya.id, createdAt: new Date() },
  ] as never[]);
  expect(
    (await call(maya, 'POST', '/v1/reports', { postId: samPostId, reason: 'filed' })).statusCode,
  ).toBe(200);
  expect(
    (await call(sam, 'POST', '/v1/reports', { userId: maya.id, reason: 'received' })).statusCode,
  ).toBe(200);
  expect(
    (await call(cleo, 'POST', '/v1/reports', { postId: mayaPostIds[0], reason: 'received' }))
      .statusCode,
  ).toBe(200);
  await col('jobs').insertMany([
    push([maya.id]),
    push([maya.id, sam.id]),
    push([sam.id]),
    push([cleo.id], { kind: 'plan_request', userId: maya.id }),
  ] as never[]);
  await worker.drain(); // report emails and reviews
  // A report on her post that the automatic check has not settled.
  await col('reports').insertOne({
    _id: 'open-on-her-post',
    reporterId: cleo.id,
    postId: mayaPostIds[1],
    reason: 'open',
    status: 'open',
    createdAt: new Date(),
  } as never);
}, 120_000);

const push = (userIds: string[], data: Record<string, string> = { kind: 'plan_join' }) => ({
  _id: newId(),
  type: 'push',
  payload: { userIds, msg: { title: 'hello', body: 'x', data } },
  status: 'done',
  runAt: new Date(),
  attempts: 1,
  maxAttempts: 5,
  createdAt: new Date(),
});

afterAll(async () => {
  await t.teardown();
});

/** Everything the database holds that names `needles`, as { collection: how many documents }. */
async function traces(needles: string[], skip: string[] = []) {
  const out: Record<string, number> = {};
  for (const { name } of await db().listCollections({}, { nameOnly: true }).toArray()) {
    if (skip.includes(name)) continue;
    const hits = (await col(name).find().toArray()).filter((d) =>
      needles.some((n) => JSON.stringify(d).includes(n)),
    );
    if (hits.length) out[name] = hits.length;
  }
  return out;
}

const tigerRows = async (id: string) => {
  const n = async (sql: string) =>
    (await tiger().query<{ n: number }>(`select count(*)::int as n ${sql}`, [id])).rows[0]!.n;
  return {
    location_points: await n('from location_points where user_id = $1'),
    movement_segments: await n('from movement_segments where user_id = $1'),
    checkins: await n('from checkins where user_id = $1'),
    tag_reads: await n('from tag_reads where user_id = $1'),
    xp_events: await n('from xp_events where user_id = $1'),
    hangouts: await n(
      `from hangouts where split_part(pair_key, ':', 1) = $1 or split_part(pair_key, ':', 2) = $1`,
    ),
    xp_daily: await n('from xp_daily where user_id = $1'),
    movement_daily: await n('from movement_daily where user_id = $1'),
  };
};

const exists = async (key: string) => (await storage().get(key)) !== null;

/** What sam owns, to prove deletion touched nothing of his. */
async function samSnapshot() {
  const own = async (c: string, f: string) =>
    (await col(c)
      .find({ [f]: sam.id })
      .sort({ _id: 1 })
      .toArray()) as unknown[];
  return {
    user: await doc('users', sam.id),
    posts: await own('posts', 'authorId'),
    media: await own('media', 'userId'),
    saves: await own('saves', 'userId'),
    memories: await own('ai_memories', 'userId'),
    tiles: await own('user_tiles', 'userId'),
    behavior: await own('behavior_events', 'userId'),
    edu: await doc('edu_codes', sam.id),
    tiger: await tigerRows(sam.id),
    benFriendship: await doc('friendships', [sam.id, ben.id].sort().join(':')),
    objects: await Promise.all(samKeys.map(exists)),
  };
}

const placeholder = (id: string) => doc<Record<string, unknown>>('users', id);

describe('deleting an account leaves only the placeholder', () => {
  let before: Awaited<ReturnType<typeof samSnapshot>>;

  test('the footprint is really there before the delete', async () => {
    expect(Object.keys(await traces([maya.id])).sort()).toEqual(
      expect.arrayContaining([
        'users',
        'posts',
        'media',
        'plans',
        'friendships',
        'saves',
        'sessions',
      ]),
    );
    expect(await tigerRows(maya.id)).toMatchObject({
      location_points: expect.any(Number),
      checkins: 2,
      tag_reads: 1,
      hangouts: 1,
      xp_daily: expect.any(Number),
      movement_daily: expect.any(Number),
    });
    const rows = await tigerRows(maya.id);
    for (const n of [
      rows.location_points,
      rows.xp_events,
      rows.movement_segments,
      rows.xp_daily,
      rows.movement_daily,
    ])
      expect(n).toBeGreaterThan(0);
    for (const k of mayaKeys) expect(await exists(k), k).toBe(true);
    before = await samSnapshot();
  });

  test('an erase for a live account, or for nobody, changes nothing', async () => {
    const counts = async () =>
      Object.fromEntries(
        await Promise.all(
          (await db().listCollections({}, { nameOnly: true }).toArray()).map(
            async (c) => [c.name, await col(c.name).countDocuments()] as const,
          ),
        ),
      );
    const was = await counts();
    await eraseAccount(t.ctx, { userId: sam.id });
    await eraseAccount(t.ctx, { userId: 'no-such-user' });
    expect(await counts()).toEqual(was);
    expect(await samSnapshot()).toEqual(before);
    expect((await doc<{ name: string }>('users', sam.id))?.name).toBe('Sam Rivera');
  });

  test('DELETE /me hides the account at once and queues the erase; nothing is erased yet', async () => {
    const res = await call(maya, 'DELETE', '/v1/me');
    expect(res.statusCode).toBe(200);
    expect((await call(maya, 'GET', '/v1/me')).statusCode).toBe(401);
    expect((await call(ben, 'GET', `/v1/profile/${maya.id}`)).statusCode).toBe(404);
    const u = await doc<{ deletedAt: Date; name: string }>('users', maya.id);
    expect(u?.deletedAt).toBeInstanceOf(Date);
    expect(u?.name).toBe('Maya Chen'); // the job has not run

    const jobs = await col('jobs').find({ type: 'erase_account' }).toArray();
    expect(jobs).toHaveLength(2);
    const [now, sweep] = [
      jobs.find((j) => !j.runAt || j.dedupeKey.endsWith(maya.id))!,
      jobs.find((j) => j.dedupeKey.endsWith(':sweep'))!,
    ];
    expect(now).toMatchObject({
      status: 'pending',
      payload: { userId: maya.id },
      dedupeKey: `erase-account:${maya.id}`,
      maxAttempts: 8,
    });
    // Only the id: a dead job is never pruned.
    expect(JSON.stringify(jobs)).not.toContain('Maya');
    expect(sweep).toMatchObject({ payload: { userId: maya.id }, maxAttempts: 8 });
    expect(sweep.runAt.getTime()).toBeGreaterThan(Date.now() + 20 * 60_000);
  });

  test('after the job: the user document is {_id, deletedAt} and nothing else', async () => {
    await worker.drain();
    expect(await placeholder(maya.id)).toEqual({ _id: maya.id, deletedAt: expect.any(Date) });
  });

  test('no Mongo document names her any more, except what moderation and others’ choices keep', async () => {
    expect(await traces([maya.id], ['jobs'])).toEqual({
      users: 1, // the placeholder
      reports: 2, // the one she filed, and the one a student filed about her
      blocks: 1, // cleo's block of her
      plans: 1, // the outing others took part in, host reduced to the id
    });
    // Her own jobs hold only the id; no push is left addressed to her.
    const jobs = await col('jobs')
      .find({ type: { $ne: 'push' } })
      .toArray();
    expect(JSON.stringify(jobs).includes('Maya')).toBe(false);
    const pushes = (await col('jobs').find({ type: 'push' }).toArray()).map(
      (j) => (j.payload as { userIds: string[] }).userIds,
    );
    expect(pushes).toEqual(expect.arrayContaining([[sam.id]]));
    expect(pushes.flat()).not.toContain(maya.id);
    expect(pushes).toContainEqual([sam.id]); // the shared one lost only her
    expect(
      await col('jobs').countDocuments({ type: 'push', 'payload.msg.data.userId': maya.id }),
    ).toBe(0);

    // None of what she typed or owned is anywhere (jobs aside: see the report on pushes quoting names).
    expect(
      await traces(
        [
          'Maya Chen',
          HANDLE,
          DEVICE,
          EDU_HASH,
          'secret pierogi',
          'too windy',
          'Likes quiet cafes',
          ...mayaKeys,
        ],
        ['jobs'],
      ),
    ).toEqual({});
  });

  test('reports stay on file; the ones with nothing left to act on close', async () => {
    const status = async (id: string) => (await doc<{ status: string }>('reports', id))?.status;
    const all = await col('reports').find().toArray();
    expect(all).toHaveLength(4);
    const byReporter = (id: string) => all.filter((r) => r.reporterId === id);
    // Filed by her: untouched, reporterId and reason intact, for the team to finish.
    expect(byReporter(maya.id)).toEqual([
      expect.objectContaining({ postId: samPostId, reason: 'filed', status: 'reviewed' }),
    ]);
    // About her, or about a post of hers that was still open: nothing left to act on.
    expect(await status('open-on-her-post')).toBe('actioned');
    expect(byReporter(sam.id)[0]).toMatchObject({
      userId: maya.id,
      status: 'actioned',
      reviewedAt: expect.any(Date),
    });
    // One the automatic check had already looked at is left as it was.
    expect(byReporter(cleo.id).find((r) => r.reason === 'received')?.status).toBe('reviewed');
    // cleo's block of her stays; the one maya placed is gone.
    expect(await col('blocks').find().toArray()).toEqual([
      expect.objectContaining({ blocker: cleo.id, blocked: maya.id }),
    ]);
    // Reporting hid sam's post from her; that mark was hers.
    expect((await doc<{ hiddenFrom: string[] }>('posts', samPostId))?.hiddenFrom).toEqual([]);
    // Her personal sticker is released, not destroyed.
    expect(await col('tags').findOne({ ownerId: maya.id })).toBeNull();
    expect(await col('tags').countDocuments({ kind: 'personal' })).toBe(2);
  });

  test('every Tiger table and both rollups hold nothing of hers', async () => {
    expect(await tigerRows(maya.id)).toEqual({
      location_points: 0,
      movement_segments: 0,
      checkins: 0,
      tag_reads: 0,
      xp_events: 0,
      hangouts: 0,
      xp_daily: 0,
      movement_daily: 0,
    });
  });

  test('every object of hers is gone from storage, including strays no document named', async () => {
    expect(mayaKeys.length).toBeGreaterThanOrEqual(15);
    for (const k of mayaKeys) expect(await exists(k), k).toBe(false);
  });

  test('sam’s own data, objects and rollup rows are untouched', async () => {
    const after = await samSnapshot();
    // Only what was about her changed: the hangout row of the two of them, and her mark on his post.
    expect(after).toEqual({
      ...before,
      posts: (before.posts as { hiddenFrom: string[] }[]).map((p) => ({ ...p, hiddenFrom: [] })),
      tiger: { ...before.tiger, hangouts: 1 },
    });
    expect(after.tiger).toMatchObject({ checkins: 1, xp_daily: 2, movement_daily: 1, hangouts: 1 });
    expect(after.objects.every(Boolean)).toBe(true);
    expect(await col('friendships').countDocuments({ $or: [{ a: maya.id }, { b: maya.id }] })).toBe(
      0,
    );
    const { rows } = await tiger().query(`select 1 from hangouts where pair_key = $1`, [
      [sam.id, ben.id].sort().join(':'),
    ]);
    expect(rows).toHaveLength(1);
  });

  test('other people’s plans: her seat is gone, and the outing others joined lost the host’s words', async () => {
    const c = (await call(cleo, 'GET', `/v1/plans/${planC}`)).json();
    expect(c.members.map((m: { userId: string }) => m.userId)).toEqual([sam.id]);
    const planCDoc = await doc<{ imessageRsvps: string[]; notifiedMatchIds: string[] }>(
      'plans',
      planC,
    );
    expect(planCDoc?.imessageRsvps).toEqual([STRANGER_HANDLE]);
    expect(planCDoc?.notifiedMatchIds).toEqual([ben.id]);

    // Upcoming plan with a joiner, and her private draft: gone. Completed outing with a joiner: kept for sam.
    for (const gone of [planA, planD]) expect(await doc('plans', gone)).toBeNull();
    expect((await call(sam, 'GET', `/v1/plans/${planA}`)).statusCode).toBe(404);
    const b = (await call(sam, 'GET', `/v1/plans/${planB}`)).json();
    expect(b).toMatchObject({
      hostId: maya.id,
      isHost: false,
      status: 'completed',
      name: 'Corner Cafe + 1 more',
    });
    expect(b.members.map((m: { userId: string }) => m.userId)).toEqual([sam.id]);
    expect(await doc('plans', planB)).toMatchObject({
      nameIsDefault: true,
      ghostChanges: [],
      shareToken: expect.not.stringMatching(planBToken),
    });
    const kept = (await doc<Record<string, unknown>>('plans', planB))!;
    for (const f of ['textUndo', 'imessageThreadId', 'imessageRsvps'])
      expect(kept).not.toHaveProperty(f);
    const mine = await call(sam, 'GET', `/v1/plans?userId=${sam.id}&scope=completed`);
    expect(mine.json().items.map((p: { id: string }) => p.id)).toEqual([planB]);
    // Sam's recap quoted the old name.
    expect(
      (await doc<{ recap: { planName: string } }>('sessions', 'sam-recap-session'))?.recap.planName,
    ).toBe('Corner Cafe + 1 more');
    // The old share link is dead and the new page names nobody.
    expect((await t.app.inject({ url: `/p/${planBToken}` })).statusCode).toBe(404);
    const page = await t.app.inject({ url: `/p/${kept.shareToken}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Hosted by someone');
    expect(page.body).not.toContain('Maya');
  });

  test('the Feed, place pages and friend lists still render everyone else’s data', async () => {
    const feed = await t.app.inject({
      url: '/v1/feed',
      query: { lat: String(ORIGIN.lat), lng: String(ORIGIN.lng) },
      headers: ben.headers,
    });
    expect(feed.statusCode, feed.body).toBe(200);
    type Card = { kind: string; post?: { id: string; author: object; media: { url: string }[] } };
    const cards: Card[] = feed.json().cards;
    const ids = cards.flatMap((c) => (c.post ? [c.post.id] : []));
    expect(ids).toContain(samPostId);
    for (const gone of mayaPostIds) expect(ids).not.toContain(gone);
    const sams = cards.find((c) => c.post?.id === samPostId)!.post!;
    expect(sams.author).toMatchObject({ id: sam.id, name: 'Sam Rivera' });
    expect(sams.media[0]!.url).toEqual(expect.any(String));

    const placePosts = await call(ben, 'GET', `/v1/posts?placeId=${cafe}`);
    expect(placePosts.json().items.map((p: { id: string }) => p.id)).toEqual([samPostId]);
    for (const url of [`/v1/places/${cafe}`, `/v1/places/${park}`]) {
      const r = await call(ben, 'GET', url);
      expect(r.statusCode, r.body).toBe(200);
    }
    // Friend lists: the people who are left, and not her.
    const friendsOf = async (who: User) =>
      (await call(who, 'GET', '/v1/friends'))
        .json()
        .items.map((f: { user: { id: string } }) => f.user.id)
        .sort();
    expect(await friendsOf(sam)).toEqual([ben.id, cleo.id].sort());
    expect(await friendsOf(cleo)).toEqual([sam.id]);
    expect(
      (await call(sam, 'GET', '/v1/saves')).json().items.map((i: { type: string }) => i.type),
    ).toEqual(['place']); // her post is gone from his saved list, his place stays
    expect((await call(sam, 'GET', '/v1/me')).statusCode).toBe(200);
    expect((await call(sam, 'GET', `/v1/score?userId=${sam.id}`)).statusCode).toBe(200);
  });

  test('running the job again, and the sweep half an hour later, change nothing', async () => {
    const dump = async () => {
      const out: Record<string, string> = {};
      for (const { name } of await db().listCollections({}, { nameOnly: true }).toArray()) {
        if (name === 'jobs') continue;
        out[name] = JSON.stringify(await col(name).find().sort({ _id: 1 }).toArray());
      }
      return out;
    };
    const was = await dump();
    const tigerWas = await tigerRows(maya.id);
    await eraseAccount(t.ctx, { userId: maya.id });
    expect(await dump()).toEqual(was);

    t.ctx.clock.offsetMs = 31 * 60_000;
    await worker.drain();
    t.ctx.clock.offsetMs = 0;
    const jobs = await col('jobs').find({ type: 'erase_account' }).toArray();
    expect(jobs.map((j) => j.status)).toEqual(['done', 'done']);
    expect(await dump()).toEqual(was);
    expect(await tigerRows(maya.id)).toEqual(tigerWas);
  });

  test('the sweep removes what a request in flight wrote after the first run', async () => {
    // A write that passed requireAuth just before the delete lands afterwards.
    await call(sam, 'GET', '/v1/me');
    await storage().put(`orig/${maya.id}/straggler.jpg`, Buffer.from('late'), 'image/jpeg');
    await col('users').updateOne(
      { _id: maya.id as never },
      { $set: { name: 'Maya Chen', pushTokens: [DEVICE] } },
    );
    await tiger().query(
      `insert into location_points (time, user_id, session_id, lat, lng) values (now(), $1, 's', 1, 1)`,
      [maya.id],
    );
    await eraseAccount(t.ctx, { userId: maya.id });
    expect(await exists(`orig/${maya.id}/straggler.jpg`)).toBe(false);
    expect(await placeholder(maya.id)).toEqual({ _id: maya.id, deletedAt: expect.any(Date) });
    expect((await tigerRows(maya.id)).location_points).toBe(0);
  });
});

describe('Apple revocation still pending', () => {
  test('the placeholder keeps the token until the revoke job succeeds, then is bare', async () => {
    const apple = {
      name: 'test',
      revoked: [] as string[],
      failing: true,
      verify: async () => ({ sub: 's' }),
      exchangeCode: async () => 'x',
      revoke: async function (this: { revoked: string[]; failing: boolean }, token: string) {
        if (this.failing) throw new Error('apple 503');
        this.revoked.push(token);
      },
    };
    t.ctx.providers.appleIdentity = apple as never;
    const u = await devLogin(t.app, 'kept_token');
    await col('users').updateOne(
      { _id: u.id as never },
      { $set: { appleRefreshToken: 'refresh-123', appleSub: 'sub-keep' } },
    );
    const res = await call(u, 'DELETE', '/v1/me');
    expect(res.statusCode).toBe(200);

    await worker.drain();
    expect(await placeholder(u.id)).toEqual({
      _id: u.id,
      deletedAt: expect.any(Date),
      appleRefreshToken: 'refresh-123',
    });
    expect(
      JSON.stringify(await col('jobs').find({ 'payload.userId': u.id }).toArray()),
    ).not.toContain('refresh-123');

    apple.failing = false;
    t.ctx.clock.offsetMs = 31 * 60_000;
    await worker.drain();
    t.ctx.clock.offsetMs = 0;
    expect(apple.revoked).toEqual(['refresh-123']);
    expect(await placeholder(u.id)).toEqual({ _id: u.id, deletedAt: expect.any(Date) });
  });
});

describe('storage trouble', () => {
  test('a failed storage delete retries; the profile is cut down only at the end', async () => {
    const u = await devLogin(t.app, 'flaky');
    const { media } = await checkinWithMedia(t.ctx, u.id, cafe, ORIGIN, ['photo']);
    const key = media[0]!.key;
    await col('users').updateOne(
      { _id: u.id as never },
      { $set: { name: 'Flaky Person', imessageHandles: ['+15550007777'] } },
    );
    const failing = vi
      .spyOn(storage(), 'delete')
      .mockRejectedValueOnce(new Error('bucket unavailable'));
    expect((await call(u, 'DELETE', '/v1/me')).statusCode).toBe(200);
    await worker.drain();
    failing.mockRestore();

    const job = await col('jobs').findOne({ dedupeKey: `erase-account:${u.id}` });
    expect(job).toMatchObject({ status: 'pending', attempts: 1 });
    expect(job?.lastError).toContain('bucket unavailable');
    // Still whole, so the retry can find the media and the handles.
    expect(await doc('users', u.id)).toMatchObject({
      name: 'Flaky Person',
      imessageHandles: ['+15550007777'],
    });
    expect(await exists(key)).toBe(true);

    t.ctx.clock.offsetMs = 60_000;
    await worker.drain();
    t.ctx.clock.offsetMs = 0;
    expect((await col('jobs').findOne({ dedupeKey: `erase-account:${u.id}` }))?.status).toBe(
      'done',
    );
    expect(await exists(key)).toBe(false);
    expect(await col('media').countDocuments({ userId: u.id })).toBe(0);
    expect(await placeholder(u.id)).toEqual({ _id: u.id, deletedAt: expect.any(Date) });
  });
});

describe('jobs that name her', () => {
  const aJob = (
    type: string,
    payload: object,
    status: 'done' | 'dead' | 'pending',
    extra: Record<string, unknown> = {},
  ) => ({
    _id: newId(),
    type,
    payload,
    status,
    runAt: new Date(),
    attempts: status === 'pending' ? 0 : 5,
    maxAttempts: 5,
    createdAt: new Date(),
    ...(status === 'dead' ? { lastError: 'Error: boom' } : {}),
    ...extra,
  });
  const aPush = (
    userIds: string[],
    status: 'done' | 'dead' | 'pending',
    data: Record<string, string> = { kind: 'plan_join' },
    extra: Record<string, unknown> = {},
  ) => aJob('push', { userIds, msg: { title: 'hi', body: 'x', data } }, status, extra);
  const tomorrow = { runAt: new Date(Date.now() + DAY) };

  test('dead jobs for her are gone, dead jobs for others untouched, her shared pushes only lose her', async () => {
    const leaver = await devLogin(t.app, 'job_leaver');
    const scanKey = `p/${randomBytes(8).toString('hex')}.jpg`;
    const seeded = {
      // Only about her: gone.
      deadScan: aJob('scan_photo', { userId: leaver.id, key: scanKey }, 'dead'),
      deadErase: aJob('erase_account', { userId: leaver.id }, 'dead'),
      deadPush: aPush([leaver.id], 'dead'),
      deadStreakNudge: aPush([cleo.id], 'dead', { kind: 'streak_nudge', friendId: leaver.id }),
      queuedPush: aPush([leaver.id], 'pending', undefined, tomorrow),
      // Not only about her: the others keep it.
      deadShared: aPush([leaver.id, sam.id], 'dead'),
      queuedShared: aPush([sam.id, leaver.id], 'pending', undefined, tomorrow),
      // The follow-up signal for a token the placeholder still holds, and a finished job (the TTL expires those).
      deadRevoke: aJob('revoke_apple_token', { userId: leaver.id }, 'dead'),
      doneScan: aJob('scan_photo', { userId: leaver.id, key: scanKey }, 'done', {
        doneAt: new Date(),
      }),
      // Someone else's.
      samScan: aJob('scan_photo', { userId: sam.id, key: 'p/sams.jpg' }, 'dead'),
      samErase: aJob('erase_account', { userId: sam.id }, 'dead'),
      samPush: aPush([sam.id], 'dead'),
      samNudge: aPush([sam.id], 'dead', { kind: 'streak_nudge', friendId: cleo.id }),
    };
    await col('jobs').insertMany(Object.values(seeded) as never[]);

    expect((await call(leaver, 'DELETE', '/v1/me')).statusCode).toBe(200);
    await worker.drain();
    expect(await placeholder(leaver.id)).toEqual({ _id: leaver.id, deletedAt: expect.any(Date) });

    const gone = [
      seeded.deadScan,
      seeded.deadErase,
      seeded.deadPush,
      seeded.deadStreakNudge,
      seeded.queuedPush,
    ];
    const found = (j: { _id: string }) => col('jobs').findOne({ _id: j._id as never });
    for (const j of Object.values(seeded))
      if (gone.includes(j)) expect(await found(j), `${j.type} ${j.status}`).toBeNull();
      else expect(await found(j), `${j.type} ${j.status}`).not.toBeNull();
    // Her id comes off a push others still get, and a queued one stays queued.
    expect(await found(seeded.deadShared)).toMatchObject({ payload: { userIds: [sam.id] } });
    expect(await found(seeded.queuedShared)).toMatchObject({
      status: 'pending',
      payload: { userIds: [sam.id] },
    });
    // Nothing of hers is left in a payload except the id the placeholder keeps, in the jobs that must stay.
    const named = await col('jobs').find({ 'payload.userId': leaver.id }).toArray();
    expect(named.map((j) => `${j.type}:${j.status}`).sort()).toEqual([
      'erase_account:done',
      'erase_account:pending',
      'revoke_apple_token:dead',
      'scan_photo:done',
    ]);
    expect(JSON.stringify(await col('jobs').find({ type: 'push' }).toArray())).not.toContain(
      leaver.id,
    );
  });
});

describe('queueMissingErasures', () => {
  test('queues accounts deleted before the erase existed and skips live ones and finished placeholders', async () => {
    const old = await devLogin(t.app, 'deleted_long_ago');
    const live = await devLogin(t.app, 'still_here');
    await col('users').updateOne(
      { _id: old.id as never },
      { $set: { deletedAt: new Date(Date.now() - 40 * DAY), name: 'Old Timer' } },
    );
    const queued = await queueMissingErasures(t.ctx);
    expect(queued).toBe(1);
    expect(await queueMissingErasures(t.ctx)).toBe(1); // the pending job is reused, not doubled
    expect(
      await col('jobs').countDocuments({ 'payload.userId': old.id, type: 'erase_account' }),
    ).toBe(1);
    await worker.drain();
    expect(await placeholder(old.id)).toEqual({ _id: old.id, deletedAt: expect.any(Date) });
    expect((await doc<{ name?: string }>('users', live.id))?.name).toBe('still_here');
    expect(await queueMissingErasures(t.ctx)).toBe(0);
  });
});

describe('why the job refreshes the rollups', () => {
  test('deleting raw rows alone leaves already-materialized days behind', async () => {
    const ghost = newId();
    const old = new Date(Date.now() - 12 * DAY);
    await tiger().query(
      `insert into xp_events (time, user_id, campus, kind, xp, ref_id) values ($1, $2, 'Columbia', 'checkin_gps', 10, 'x')`,
      [old, ghost],
    );
    await tiger().query(
      `call refresh_continuous_aggregate('xp_daily', now() - interval '30 days', now() - interval '5 days')`,
    );
    await tiger().query('delete from xp_events where user_id = $1', [ghost]);
    const left = await tiger().query('select 1 from xp_daily where user_id = $1', [ghost]);
    expect(left.rowCount).toBe(1);
  });
});

describe('Storage.delete and Storage.deletePrefix', () => {
  const memory = new MemoryStorage('http://x', 'secret');
  const cases: [string, () => import('../src/providers/storage.ts').Storage][] = [
    ['memory', () => memory],
    ['S3 (RustFS)', () => storage()],
  ];
  test.each(cases)(
    '%s: deletes one object, a missing one is fine, a folder goes in full',
    async (_n, get) => {
      const s = get();
      const folder = `orig/test-${newId()}/`;
      const other = `orig/test-${newId()}/keep.jpg`;
      await s.put(`${folder}a.jpg`, Buffer.from('a'), 'image/jpeg');
      await s.put(`${folder}deep/b.jpg`, Buffer.from('b'), 'image/jpeg');
      await s.put(other, Buffer.from('o'), 'image/jpeg');
      await s.delete(`${folder}a.jpg`);
      await s.delete(`${folder}a.jpg`); // already gone
      expect(await s.get(`${folder}a.jpg`)).toBeNull();
      expect(await s.deletePrefix(folder)).toBe(1);
      expect(await s.get(`${folder}deep/b.jpg`)).toBeNull();
      expect(await s.deletePrefix(folder)).toBe(0);
      expect(await s.get(other)).not.toBeNull(); // a sibling folder is not touched
      await s.delete(other);
    },
  );

  test.each(cases)('%s: refuses a prefix that is not a folder', async (_n, get) => {
    for (const bad of ['', 'o', 'orig', 'orig/abc', '/'])
      await expect(get().deletePrefix(bad), bad).rejects.toThrow(/not a folder/);
  });

  test('a user id that is a prefix of another does not delete the other’s objects', async () => {
    const s = storage();
    const a = `u${newId()}`;
    await s.put(`orig/${a}/x.jpg`, Buffer.from('1'), 'image/jpeg');
    await s.put(`orig/${a}0/x.jpg`, Buffer.from('2'), 'image/jpeg'); // "a0" starts with "a" but is not "a/"
    await s.deletePrefix(`orig/${a}/`);
    expect(await s.get(`orig/${a}/x.jpg`)).toBeNull();
    expect(await s.get(`orig/${a}0/x.jpg`)).not.toBeNull();
    await s.delete(`orig/${a}0/x.jpg`);
  });
});

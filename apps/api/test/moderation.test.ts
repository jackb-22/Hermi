import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '@itp/shared';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { handlers } from '../src/jobs/handlers.ts';
import { type JobDoc, Worker } from '../src/jobs/queue.ts';
import type { ConsoleEmail } from '../src/providers/email.ts';
import { GeminiLlm } from '../src/providers/llm.ts';
import {
  approvePost,
  banUser,
  dismissReports,
  listPending,
  listReports,
  previewBan,
  removePost,
  retryModeration,
  showPost,
  unbanUser,
} from '../src/services/admin.ts';
import { userByHandle } from '../src/services/imessage.ts';
import { type PostDoc, posts } from '../src/services/posts.ts';
import { type ReportDoc, reports } from '../src/services/reports.ts';
import { newUser, users } from '../src/services/users.ts';
import { checkinWithMedia } from './fixtures/media.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp, testEnv } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
let worker: Worker;
let cafe: string;
let spots: string[];
let ana: Awaited<ReturnType<typeof devLogin>>;
let ben: Awaited<ReturnType<typeof devLogin>>;

beforeAll(async () => {
  t = await setupTestApp();
  worker = new Worker(t.ctx, handlers, { info: () => {}, error: () => {} });
  [cafe] = (
    await insertPlaces(t.ctx.db, [placeDoc({ name: 'Cafe Mogador', category: 'food', at: ORIGIN })])
  ).map((p) => p._id) as [string];
  spots = (
    await insertPlaces(
      t.ctx.db,
      Array.from({ length: 4 }, (_, i) =>
        placeDoc({ name: `Spot ${i}`, category: 'food', at: offset(ORIGIN, 300 * (i + 1), 0) }),
      ),
    )
  ).map((p) => p._id);
  ana = await devLogin(t.app, 'ana');
  ben = await devLogin(t.app, 'ben');
});
afterAll(() => t.teardown());
afterEach(() => {
  t.ctx.clock.offsetMs = 0;
  vi.restoreAllMocks();
});

const emails = () => (t.ctx.providers.email as ConsoleEmail).sent;
const jobs = () => t.ctx.db.collection<JobDoc<{ postId?: string; reportId?: string }>>('jobs');
const get = (who: { headers: object }, url: string) =>
  t.app.inject({ url: `/v1${url}`, headers: who.headers as Record<string, string> });
const post = (who: { headers: object }, url: string, payload: object) =>
  t.app.inject({
    method: 'POST',
    url: `/v1${url}`,
    headers: who.headers as Record<string, string>,
    payload,
  });

/** A post straight into the database (the routes that create them are covered in posts.test.ts). */
async function makePost(over: Partial<PostDoc> = {}): Promise<PostDoc> {
  const p: PostDoc = {
    _id: newId(),
    authorId: ana.id,
    type: 'photos',
    status: 'pending',
    placeId: cafe,
    mediaIds: [],
    text: 'pierogi heaven',
    stamp: { placeName: 'Cafe Mogador', time: new Date(), tier: 'tag' },
    hiddenFrom: [],
    createdAt: t.ctx.clock.now(),
    ...over,
  };
  await posts(t.ctx.db).insertOne(p);
  return p;
}
const statusOf = async (id: string) => (await posts(t.ctx.db).findOne({ _id: id }))!.status;
const reportOf = (postId: string, reporterId: string, status: ReportDoc['status'] = 'open') =>
  reports(t.ctx.db).insertOne({
    _id: newId(),
    reporterId,
    postId,
    reason: 'rude',
    status,
    createdAt: t.ctx.clock.now(),
  });

describe('moderation fails closed', () => {
  test('GeminiLlm.moderate throws on an outage or an answer with no verdict, never "allowed"', async () => {
    const llm = new GeminiLlm('k', 'main-model');
    vi.spyOn(llm, 'json').mockRejectedValueOnce(new Error('503 overloaded'));
    await expect(llm.moderate({ text: 'hi' })).rejects.toThrow(/503/);
    vi.spyOn(llm, 'json').mockResolvedValueOnce(null as never);
    await expect(llm.moderate({ text: 'hi' })).rejects.toThrow(/no verdict/);
    vi.spyOn(llm, 'json').mockResolvedValueOnce({ reason: 'x' } as never);
    await expect(llm.moderate({ text: 'hi' })).rejects.toThrow(/no verdict/);
    vi.spyOn(llm, 'json').mockResolvedValueOnce({ allowed: false, reason: 'nope' });
    expect(await llm.moderate({ text: 'hi' })).toEqual({ allowed: false, reason: 'nope' });
  });

  test('a throwing check retries, then the dead job leaves the post pending for a person', async () => {
    const { media } = await checkinWithMedia(t.ctx, ana.id, cafe, ORIGIN, ['photo']);
    const moderate = vi
      .spyOn(t.ctx.providers.llm, 'moderate')
      .mockRejectedValue(new Error('gemini 503'));
    const made = await post(ana, '/posts', { mediaIds: [media[0]!._id], caption: 'stuck' });
    expect(made.statusCode).toBe(200);
    const id = made.json().id as string;

    for (let attempt = 1; attempt <= 8; attempt++) {
      await worker.drain();
      expect(await statusOf(id)).toBe('pending');
      expect(await jobs().findOne({ 'payload.postId': id })).toMatchObject({
        attempts: attempt,
        status: attempt < 8 ? 'pending' : 'dead',
      });
      t.ctx.clock.offsetMs += 10 * 60_000; // past the backoff
    }
    expect(moderate).toHaveBeenCalledTimes(8);
    const stuck = (await posts(t.ctx.db).findOne({ _id: id }))!;
    expect(stuck.moderationReason).toBeUndefined();
    expect((await get(ben, `/posts/${id}`)).statusCode).toBe(404); // still invisible to others

    // The admin queue shows why it is stuck, and approving it publishes it.
    const row = (await listPending(t.ctx)).find((r) => r.id === id)!;
    expect(row).toMatchObject({
      author: { username: 'ana' },
      place: 'Cafe Mogador',
      caption: 'stuck',
      moderation: {
        state: 'dead',
        attempts: 8,
        maxAttempts: 8,
        lastError: expect.stringMatching(/503/),
      },
    });
    await approvePost(t.ctx, id);
    expect((await get(ben, `/posts/${id}`)).json().status).toBe('live');
  });

  test('a check that recovers on a retry publishes the post as before', async () => {
    const { media } = await checkinWithMedia(t.ctx, ana.id, spots[0]!, offset(ORIGIN, 300, 0), [
      'photo',
    ]);
    vi.spyOn(t.ctx.providers.llm, 'moderate')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ allowed: true, reason: 'ok' });
    const id = (await post(ana, '/posts', { mediaIds: [media[0]!._id] })).json().id as string;
    await worker.drain();
    expect(await statusOf(id)).toBe('pending');
    t.ctx.clock.offsetMs += 10 * 60_000;
    await worker.drain();
    expect(await statusOf(id)).toBe('live');
  });

  test('retry-moderation re-runs dead checks once Gemini is back, and leaves live checks alone', async () => {
    const mkPost = async (spot: number) => {
      const at = offset(ORIGIN, 300 * (spot + 1), 0);
      const { media } = await checkinWithMedia(t.ctx, ana.id, spots[spot]!, at, ['photo']);
      return (await post(ana, '/posts', { mediaIds: [media[0]!._id] })).json().id as string;
    };
    const moderate = vi
      .spyOn(t.ctx.providers.llm, 'moderate')
      .mockRejectedValue(new Error('gemini 503'));
    const died = await mkPost(2);
    for (let attempt = 1; attempt <= 8; attempt++) {
      await worker.drain();
      t.ctx.clock.offsetMs += 10 * 60_000;
    }
    expect(await jobs().findOne({ 'payload.postId': died })).toMatchObject({ status: 'dead' });
    const retrying = await mkPost(3);
    await worker.drain(); // one failed attempt: its job is pending and will run again
    const orphan = await makePost(); // pending with no job at all (e.g. purged)
    expect((await listPending(t.ctx)).find((r) => r.id === retrying)!.moderation.state).toBe(
      'retrying',
    );

    moderate.mockResolvedValue({ allowed: true, reason: 'ok' }); // Gemini is back
    expect(await retryModeration(t.ctx)).toEqual({ requeued: 2, alreadyRunning: 1 });
    // The dead job stays as history next to the fresh one; the retrying post got no second job.
    expect(await jobs().countDocuments({ type: 'moderate_post', 'payload.postId': died })).toBe(2);
    expect(
      await jobs().countDocuments({ type: 'moderate_post', 'payload.postId': orphan._id }),
    ).toBe(1);
    expect(await jobs().countDocuments({ type: 'moderate_post', 'payload.postId': retrying })).toBe(
      1,
    );
    expect((await listPending(t.ctx)).find((r) => r.id === died)!.moderation).toMatchObject({
      state: 'queued',
      attempts: 0,
    });
    // Running it again before the worker has run changes nothing.
    expect(await retryModeration(t.ctx)).toEqual({ requeued: 0, alreadyRunning: 3 });

    t.ctx.clock.offsetMs += 10 * 60_000; // let the retrying post's backoff pass too
    await worker.drain();
    for (const id of [died, retrying, orphan._id]) expect(await statusOf(id)).toBe('live');
    expect(await retryModeration(t.ctx)).toEqual({ requeued: 0, alreadyRunning: 0 });
  });
});

describe('report alerts', () => {
  test('a report on a post emails the team once, with the details and the CLI command', async () => {
    const p = await makePost({ status: 'live', text: 'check\nthis   out' });
    const before = emails().length;
    expect((await post(ben, '/reports', { postId: p._id, reason: 'spam' })).statusCode).toBe(200);
    expect(emails()).toHaveLength(before); // sent by the worker, not the request
    await worker.drain();
    expect(emails()).toHaveLength(before + 1);
    const mail = emails().at(-1)!;
    expect(mail.to).toBe('support@hermi.world');
    expect(mail.subject).toBe(`Hermi report: post ${p._id}`);
    for (const part of [
      p._id,
      '(photos, live)',
      'Cafe Mogador',
      '"check this out"',
      '@ana',
      '"spam"',
      `@ben (${ben.id})`,
      `pnpm --filter @itp/api admin show-post ${p._id}`,
      `admin remove-post ${p._id} --reason "<why>" --yes`,
      `admin ban ${ana.id} --reason "<why>" --yes`,
    ])
      expect(mail.text).toContain(part);
    expect(mail.text).not.toMatch(/https?:\/\//); // no media links

    // The same reporter reporting again changes nothing and emails nobody.
    expect((await post(ben, '/reports', { postId: p._id, reason: 'spam' })).statusCode).toBe(200);
    await worker.drain();
    expect(emails()).toHaveLength(before + 1);
    expect(await reports(t.ctx.db).countDocuments({ postId: p._id, reporterId: ben.id })).toBe(1);
    // ...but a second person is a second email.
    await post(await devLogin(t.app, 'cyrus'), '/reports', { postId: p._id, reason: '' });
    await worker.drain();
    expect(emails()).toHaveLength(before + 2);
    expect(emails().at(-1)!.text).toContain('(none given)');
  });

  test('a report on a user emails with the ban command', async () => {
    const before = emails().length;
    expect(
      (await post(ben, '/reports', { userId: ana.id, reason: 'harassing me' })).statusCode,
    ).toBe(200);
    await worker.drain();
    expect(emails()).toHaveLength(before + 1);
    expect(emails().at(-1)!.text).toContain(`Reported: user @ana (${ana.id})`);
    expect(emails().at(-1)!.text).toContain(`admin ban ${ana.id} --reason "<why>" --yes`);
  });

  test('a target that does not exist is a 404, and nothing is stored or sent', async () => {
    const before = { mail: emails().length, reports: await reports(t.ctx.db).countDocuments() };
    for (const body of [{ postId: newId() }, { userId: newId() }]) {
      const r = await post(ben, '/reports', body);
      expect(r.statusCode).toBe(404);
      expect(r.json().error.code).toBe('NOT_FOUND');
    }
    const gone = await devLogin(t.app, 'gone');
    await t.app.inject({ method: 'DELETE', url: '/v1/me', headers: gone.headers });
    expect((await post(ben, '/reports', { userId: gone.id })).statusCode).toBe(404);
    expect((await post(ben, '/reports', {})).statusCode).toBe(400);
    await worker.drain();
    expect(emails()).toHaveLength(before.mail);
    expect(await reports(t.ctx.db).countDocuments()).toBe(before.reports);
  });

  test('a mail outage retries the alert without losing or doubling it', async () => {
    const p = await makePost({ status: 'live' });
    const send = vi
      .spyOn(t.ctx.providers.email, 'send')
      .mockRejectedValueOnce(new Error('resend 500'));
    const before = emails().length;
    await post(ben, '/reports', { postId: p._id, reason: 'x' });
    await worker.drain();
    expect(send).toHaveBeenCalledTimes(1);
    const report = (await reports(t.ctx.db).findOne({ postId: p._id }))!;
    expect(report.alertedAt).toBeUndefined();
    expect(
      await jobs().findOne({ type: 'report_alert', 'payload.reportId': report._id }),
    ).toMatchObject({
      status: 'pending',
      attempts: 1,
    });
    t.ctx.clock.offsetMs += 10 * 60_000;
    await worker.drain();
    expect(send).toHaveBeenCalledTimes(2);
    expect(emails()).toHaveLength(before + 1);
    expect((await reports(t.ctx.db).findOne({ _id: report._id }))!.alertedAt).toBeInstanceOf(Date);
  });

  test('a person can file only so many reports an hour, so the inbox cannot be flooded', async () => {
    const spammer = await devLogin(t.app, 'spammer');
    const targets = Array.from({ length: 21 }, (_, i) =>
      newUser(new Date(), { username: `victim${i}` }),
    );
    await users(t.ctx.db).insertMany(targets);
    const codes: number[] = [];
    for (const u of targets)
      codes.push((await post(spammer, '/reports', { userId: u._id })).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  test('REPORTS_EMAIL_TO defaults to support@hermi.world, and empty means the default', () => {
    expect(loadConfig(testEnv()).REPORTS_EMAIL_TO).toBe('support@hermi.world');
    expect(loadConfig({ ...testEnv(), REPORTS_EMAIL_TO: '' }).REPORTS_EMAIL_TO).toBe(
      'support@hermi.world',
    );
    expect(
      loadConfig({ ...testEnv(), REPORTS_EMAIL_TO: 'team@example.com' }).REPORTS_EMAIL_TO,
    ).toBe('team@example.com');
  });
});

describe('bans and deleted accounts stop at the door', () => {
  test('banned: 403 BANNED on authed and optional-auth routes; unban restores; sign-in still works', async () => {
    const dan = await devLogin(t.app, 'dan');
    expect((await get(dan, '/posts')).statusCode).toBe(200);
    await banUser(t.ctx, '@dan', 'harassment');
    for (const url of ['/posts', '/me', '/places/near?lat=40.8&lng=-73.96']) {
      const r = await get(dan, url);
      expect(r.statusCode, url).toBe(403);
      expect(r.json().error.code).toBe('BANNED');
    }
    expect((await post(dan, '/reports', { userId: ben.id })).statusCode).toBe(403);
    // /auth/dev is not behind requireAuth: signing in still returns a token (it is refused at every route).
    const again = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/dev',
      payload: { username: 'dan' },
    });
    expect(again.statusCode).toBe(200);
    expect(
      (await get({ headers: { authorization: `Bearer ${again.json().token}` } }, '/me')).statusCode,
    ).toBe(403);

    await unbanUser(t.ctx, '@dan');
    expect((await get(dan, '/posts')).statusCode).toBe(200);
    expect((await users(t.ctx.db).findOne({ _id: dan.id }))!.bannedAt).toBeUndefined();
  });

  test('deleted: the old token is a 401 on routes that never looked the user up', async () => {
    const eve = await devLogin(t.app, 'eve');
    expect((await get(eve, '/posts')).statusCode).toBe(200);
    expect(
      (await t.app.inject({ method: 'DELETE', url: '/v1/me', headers: eve.headers })).statusCode,
    ).toBe(200);
    for (const url of ['/posts', '/me', '/places/near?lat=40.8&lng=-73.96']) {
      const r = await get(eve, url);
      expect(r.statusCode, url).toBe(401);
      expect(r.json().error.code).toBe('UNAUTHORIZED');
    }
  });

  test('a valid token for a user that does not exist is a 401', async () => {
    const ghost = { headers: { authorization: `Bearer ${t.app.jwt.sign({ sub: newId() })}` } };
    expect((await get(ghost, '/posts')).statusCode).toBe(401);
    expect((await get({ headers: {} }, '/posts')).statusCode).toBe(401);
    expect((await get({ headers: {} }, '/places/near?lat=40.8&lng=-73.96')).statusCode).toBe(200); // anonymous
  });

  test('a banned account cannot text Hermi either', async () => {
    const fay = await devLogin(t.app, 'fay');
    await users(t.ctx.db).updateOne(
      { _id: fay.id },
      { $set: { imessageHandles: ['+12125550142'] } },
    );
    expect((await userByHandle(t.ctx, '+12125550142'))?._id).toBe(fay.id);
    await banUser(t.ctx, fay.id, 'abuse');
    expect(await userByHandle(t.ctx, '+12125550142')).toBeNull();
  });
});

describe('admin functions', () => {
  test('pending lists oldest first with age, author, place, caption and job state', async () => {
    await posts(t.ctx.db).deleteMany({});
    const older = await makePost({
      createdAt: new Date(Date.now() - 3 * 3600_000),
      text: 'old one',
    });
    const newer = await makePost({ text: 'new one' });
    await makePost({ status: 'live' });
    await jobs().insertOne({
      _id: newId(),
      type: 'moderate_post',
      payload: { postId: older._id },
      status: 'pending',
      runAt: new Date(Date.now() + 60_000),
      attempts: 3,
      maxAttempts: 8,
      lastError: 'Error: gemini 503\n    at stack',
      createdAt: new Date(),
    });
    const rows = await listPending(t.ctx);
    expect(rows.map((r) => r.id)).toEqual([older._id, newer._id]);
    expect(rows[0]).toMatchObject({
      author: { id: ana.id, username: 'ana' },
      place: 'Cafe Mogador',
      caption: 'old one',
      moderation: {
        state: 'retrying',
        attempts: 3,
        maxAttempts: 8,
        lastError: 'Error: gemini 503',
      },
    });
    expect(rows[0]!.ageMs).toBeGreaterThan(2.9 * 3600_000);
    expect(rows[1]!.moderation.state).toBe('none');
  });

  test('reports groups open reports by target, oldest first; reviewed ones only with includeReviewed', async () => {
    await posts(t.ctx.db).deleteMany({});
    await reports(t.ctx.db).deleteMany({});
    const a = await makePost({ status: 'live', text: 'post a' });
    const b = await makePost({ status: 'live', text: 'post b' });
    await reportOf(a._id, ben.id);
    await reportOf(a._id, ben.id); // same person twice still counts as one reporter
    await reportOf(b._id, ana.id, 'reviewed');
    await reports(t.ctx.db).insertOne({
      _id: newId(),
      reporterId: ana.id,
      userId: ben.id,
      reason: 'creep',
      status: 'open',
      createdAt: new Date(),
    });
    const groups = await listReports(t.ctx);
    expect(groups.map((g) => `${g.kind}:${g.id}`)).toEqual([`post:${a._id}`, `user:${ben.id}`]);
    expect(groups[0]).toMatchObject({
      count: 2,
      reporters: 1,
      reasons: ['rude'],
      post: { status: 'live', place: 'Cafe Mogador', caption: 'post a', authorId: ana.id },
    });
    expect(groups[1]).toMatchObject({
      count: 1,
      reasons: ['creep'],
      user: { username: 'ben', banned: false },
    });
    expect((await listReports(t.ctx, { includeReviewed: true })).map((g) => g.id)).toContain(b._id);
  });

  test('show-post gives the details, its reports and signed media links', async () => {
    const { media } = await checkinWithMedia(t.ctx, ana.id, spots[1]!, offset(ORIGIN, 600, 0), [
      'photo',
    ]);
    const p = await makePost({ status: 'live', mediaIds: [media[0]!._id] });
    await reportOf(p._id, ben.id);
    const d = await showPost(t.ctx, p._id);
    expect(d).toMatchObject({
      id: p._id,
      status: 'live',
      author: { username: 'ana', banned: false },
      place: 'Cafe Mogador',
      reports: [{ reporter: 'ben', reason: 'rude', status: 'open' }],
      media: [{ id: media[0]!._id, kind: 'photo', url: expect.stringMatching(/^https?:\/\//) }],
    });
    await expect(showPost(t.ctx, newId())).rejects.toMatchObject({ status: 404 });
  });

  test('approve-post: pending → live, a Review refreshes its place summary, other states are refused', async () => {
    const review = await makePost({ type: 'review', text: 'worth the wait', again: true });
    const r = await approvePost(t.ctx, review._id);
    expect(r).toEqual({ id: review._id, status: 'live' });
    expect(await posts(t.ctx.db).findOne({ _id: review._id })).toMatchObject({
      status: 'live',
      liveAt: expect.any(Date),
      moderationReason: 'Approved by admin',
    });
    expect(
      await jobs().findOne({ type: 'summarize_reviews', 'payload.placeId': cafe } as never),
    ).toBeTruthy();
    await expect(approvePost(t.ctx, review._id)).rejects.toMatchObject({ status: 409 });
    await expect(approvePost(t.ctx, newId())).rejects.toMatchObject({ status: 404 });
    const gone = await makePost({ status: 'removed' });
    await expect(approvePost(t.ctx, gone._id)).rejects.toMatchObject({ status: 409 });
  });

  test('remove-post: removed with the reason, reports actioned, a live Review refreshes the summary', async () => {
    await jobs().deleteMany({ type: 'summarize_reviews' });
    const p = await makePost({ type: 'review', status: 'live', text: 'awful', again: false });
    await reportOf(p._id, ben.id);
    await reportOf(p._id, ana.id, 'reviewed');
    await expect(removePost(t.ctx, p._id, '  ')).rejects.toMatchObject({ status: 400 });
    expect(await removePost(t.ctx, p._id, 'hate speech')).toEqual({
      id: p._id,
      was: 'live',
      reportsActioned: 2,
    });
    expect(await posts(t.ctx.db).findOne({ _id: p._id })).toMatchObject({
      status: 'removed',
      moderationReason: 'Removed by admin: hate speech',
    });
    expect(await reports(t.ctx.db).countDocuments({ postId: p._id, status: 'actioned' })).toBe(2);
    expect(await jobs().countDocuments({ type: 'summarize_reviews', status: 'pending' })).toBe(1);
    expect((await get(ben, `/posts/${p._id}`)).statusCode).toBe(404);
    await expect(removePost(t.ctx, newId(), 'x')).rejects.toMatchObject({ status: 404 });
  });

  test('ban: bannedAt and reason set, live and pending posts removed, tokens cleared, reports closed', async () => {
    const gus = await devLogin(t.app, 'gus');
    await users(t.ctx.db).updateOne(
      { _id: gus.id },
      { $set: { pushTokens: ['ExponentPushToken[a]', 'b'], openToPlans: true, ghostMode: false } },
    );
    const live = await makePost({ authorId: gus.id, status: 'live', type: 'review', text: 'meh' });
    const pending = await makePost({ authorId: gus.id });
    const rejected = await makePost({ authorId: gus.id, status: 'rejected' });
    const other = await makePost({ authorId: ben.id, status: 'live' });
    await reportOf(live._id, ben.id);
    await reports(t.ctx.db).insertOne({
      _id: newId(),
      reporterId: ben.id,
      userId: gus.id,
      reason: 'bad',
      status: 'open',
      createdAt: new Date(),
    });
    await jobs().deleteMany({ type: 'summarize_reviews' });

    expect(await previewBan(t.ctx, '@gus')).toMatchObject({
      user: { id: gus.id, username: 'gus' },
      alreadyBanned: false,
      livePosts: 1,
      pendingPosts: 1,
      pushTokens: 2,
      openReports: 1,
    });
    await expect(banUser(t.ctx, '@gus', '')).rejects.toMatchObject({ status: 400 });
    expect((await users(t.ctx.db).findOne({ _id: gus.id }))!.bannedAt).toBeUndefined(); // nothing yet

    const r = await banUser(t.ctx, '@gus', 'sexual content');
    expect(r).toMatchObject({
      postsRemoved: 2,
      pushTokensCleared: 2,
      reportsActioned: 2,
      alreadyBanned: false,
    });
    const u = (await users(t.ctx.db).findOne({ _id: gus.id }))!;
    expect(u).toMatchObject({ bannedAt: expect.any(Date), banReason: 'sexual content' });
    expect(u.pushTokens).toBeUndefined();
    expect(u).toMatchObject({ ghostMode: true, openToPlans: false }); // off the social map and matching
    expect(await statusOf(live._id)).toBe('removed');
    expect(await statusOf(pending._id)).toBe('removed');
    expect(await statusOf(rejected._id)).toBe('rejected');
    expect(await statusOf(other._id)).toBe('live');
    expect(await jobs().countDocuments({ type: 'summarize_reviews', status: 'pending' })).toBe(1);
    expect(
      await reports(t.ctx.db).countDocuments({
        status: 'actioned',
        $or: [{ userId: gus.id }, { postId: live._id }],
      }),
    ).toBe(2);

    // Running it again is safe, keeps the original ban time, and takes any post made since.
    const firstAt = u.bannedAt;
    await makePost({ authorId: gus.id });
    expect(await banUser(t.ctx, gus.id, 'still bad')).toMatchObject({
      postsRemoved: 1,
      alreadyBanned: true,
    });
    expect((await users(t.ctx.db).findOne({ _id: gus.id }))!.bannedAt).toEqual(firstAt);

    await unbanUser(t.ctx, gus.id);
    const unbanned = (await users(t.ctx.db).findOne({ _id: gus.id }))!;
    expect(unbanned).not.toHaveProperty('banReason');
    expect(unbanned).not.toHaveProperty('bannedAt');
    expect(unbanned).toMatchObject({ ghostMode: true, openToPlans: false }); // they turn these back on themselves
    expect(await statusOf(live._id)).toBe('removed'); // an unban does not bring posts back
    await expect(unbanUser(t.ctx, gus.id)).rejects.toMatchObject({ status: 409 });
    await expect(banUser(t.ctx, '@nobody', 'x')).rejects.toMatchObject({ status: 404 });
  });

  test('a deleted account cannot be banned (nothing left to ban)', async () => {
    const hal = await devLogin(t.app, 'hal');
    await t.app.inject({ method: 'DELETE', url: '/v1/me', headers: hal.headers });
    await expect(banUser(t.ctx, hal.id, 'x')).rejects.toMatchObject({ status: 409 });
  });

  test('dismiss-reports closes a post’s or a user’s reports without touching them', async () => {
    await reports(t.ctx.db).deleteMany({});
    const p = await makePost({ status: 'live' });
    await reportOf(p._id, ben.id);
    expect(await dismissReports(t.ctx, p._id)).toEqual({ dismissed: 1 });
    expect(await statusOf(p._id)).toBe('live');
    await reports(t.ctx.db).insertOne({
      _id: newId(),
      reporterId: ana.id,
      userId: ben.id,
      reason: '',
      status: 'open',
      createdAt: new Date(),
    });
    expect(await dismissReports(t.ctx, '@ben')).toEqual({ dismissed: 1 });
    await expect(dismissReports(t.ctx, newId())).rejects.toMatchObject({ status: 404 });
  });
});

describe('the admin script', () => {
  // pnpm reports any failing script as exit 1, so the exit codes are checked by running the script itself.
  const run = (...args: string[]) =>
    spawnSync(
      'pnpm',
      ['exec', 'tsx', '--env-file-if-exists=../../.env', 'scripts/admin.ts', ...args],
      {
        cwd: join(import.meta.dirname, '..'),
        encoding: 'utf8',
        env: {
          ...testEnv(),
          NODE_ENV: 'test',
          MONGO_DB: t.ctx.config.MONGO_DB,
          TIGER_SCHEMA: t.ctx.config.TIGER_SCHEMA,
          FAKE_PROVIDERS: '1',
        },
      },
    );

  test('is wired up as `pnpm --filter @itp/api admin`', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'));
    expect(pkg.scripts.admin).toBe('tsx --env-file-if-exists=../../.env scripts/admin.ts');
  });

  test('previews without --yes, acts with it, and exits 2 on bad usage', async () => {
    const p = await makePost({ status: 'live', text: 'to be removed' });
    const preview = run('remove-post', p._id, '--reason', 'spam');
    expect(preview.status).toBe(1);
    expect(preview.stdout).toContain(`Will remove post ${p._id}`);
    expect(preview.stdout).toContain('Nothing changed');
    expect(await statusOf(p._id)).toBe('live');

    const done = run('remove-post', p._id, '--reason', 'spam', '--yes');
    expect(done.status, done.stderr).toBe(0);
    expect(done.stdout).toContain('removed');
    expect(await statusOf(p._id)).toBe('removed');

    expect(run('remove-post', p._id).status).toBe(2); // no --reason
    expect(run('nonsense').status).toBe(2);
    expect(run('ban', '@nobody', '--reason', 'x', '--yes').status).toBe(1);
    const retry = run('retry-moderation');
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.stdout).toMatch(/Re-queued the safety check for \d+ pending post\(s\)/);
    const list = run('pending');
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toMatch(/\d+ pending post\(s\), oldest first/);
  }, 60_000);
});

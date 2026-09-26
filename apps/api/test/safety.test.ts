import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AI_SOURCE_TYPES } from '../src/providers/c2pa.ts';
import { FakeDetector, OffDetector } from '../src/providers/detector.ts';
import type { PostDoc } from '../src/services/posts.ts';
import { reviewReport, scanPhoto } from '../src/services/safety.ts';
import { checkinWithMedia } from './fixtures/media.ts';
import { insertPlaces, ORIGIN, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'itp-safety-'));
execFileSync('ffmpeg', [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=1200x900',
  '-frames:v',
  '1',
  join(dir, 'me.jpg'),
]);
const selfie = readFileSync(join(dir, 'me.jpg'));
// Trailing bytes after the JPEG end marker: still a valid image, and the fake detector's "deepfake" signal.
const deepfake = Buffer.concat([selfie, Buffer.from('SYNTHETIC-FACE')]);

let t: Awaited<ReturnType<typeof setupTestApp>>;
let u: Awaited<ReturnType<typeof devLogin>>;

beforeAll(async () => {
  t = await setupTestApp();
  u = await devLogin(t.app, 'selfie');
});
afterAll(() => t.teardown());

const upload = (body: Buffer, type = 'image/jpeg') =>
  t.app.inject({
    method: 'POST',
    url: '/v1/me/photo',
    headers: { ...u.headers, 'content-type': type },
    payload: body,
  });
const me = async () =>
  (await t.app.inject({ method: 'GET', url: '/v1/me', headers: u.headers })).json();

describe('profile photos', () => {
  test('without a detector the photo goes live as a ≤640 px JPEG; PATCH photoKey is ignored', async () => {
    t.ctx.providers.detector = new OffDetector();
    const r = await upload(selfie);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      photoUrl: expect.stringMatching(/\/p\/[0-9a-f]{32}\.jpg$/),
      photoReview: null,
    });
    const key = r.json().photoUrl.match(/p\/[0-9a-f]{32}\.jpg$/)[0];
    const probe = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', '-i', 'pipe:0'], {
        input: (await t.ctx.providers.storage.get(key))!,
      }).toString(),
    ).streams[0];
    expect(Math.max(probe.width, probe.height)).toBeLessThanOrEqual(640);

    const before = (await me()).photoUrl;
    await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: u.headers,
      payload: { photoKey: 'r/someone-elses.jpg' },
    });
    expect((await me()).photoUrl).toBe(before);
  });

  test('not an image → 400', async () => {
    expect(
      (await t.app.inject({ method: 'POST', url: '/v1/me/photo', headers: u.headers, payload: {} }))
        .statusCode,
    ).toBe(400);
    expect((await upload(Buffer.from('not really a png'), 'image/png')).statusCode).toBe(400);
  });

  test('Reality Defender: scanning first, live when authentic, refused with a push when manipulated', async () => {
    t.ctx.providers.detector = new FakeDetector();
    const live = (await me()).photoUrl;

    const ok = (await upload(selfie)).json();
    expect(ok.photoReview).toEqual({ status: 'scanning', reason: null });
    expect(ok.photoUrl).toBe(live); // the old photo stays until the scan passes
    const job = (key: string) => ({ userId: u.id, key });
    const pending = (await t.ctx.db.collection('users').findOne({ _id: u.id as never }))!
      .photoReview;
    // First poll is still running: the job throws so the queue retries, without uploading again.
    await expect(scanPhoto(t.ctx, job(pending.key))).rejects.toThrow(/still running/);
    await scanPhoto(t.ctx, job(pending.key));
    const after = await me();
    expect(after.photoReview).toBeNull();
    expect(after.photoUrl).toContain(pending.key);

    await upload(deepfake);
    const bad = (await t.ctx.db.collection('users').findOne({ _id: u.id as never }))!.photoReview;
    await scanPhoto(t.ctx, job(bad.key)).catch(() => {});
    await scanPhoto(t.ctx, job(bad.key));
    const refused = await me();
    expect(refused.photoReview).toMatchObject({
      status: 'rejected',
      reason: expect.stringMatching(/AI-generated/),
    });
    expect(refused.photoUrl).toBe(after.photoUrl);
    expect(
      await t.ctx.db
        .collection('jobs')
        .findOne({ type: 'push', 'payload.msg.data.kind': 'photo_rejected' }),
    ).toBeTruthy();
  });

  test('an image whose Content Credentials declare AI generation is refused before any scan', async () => {
    const { Builder, LocalSigner } = await import('@contentauth/c2pa-node');
    const keys = Object.fromEntries(
      execFileSync('bash', [
        join(import.meta.dirname, '../scripts/make-c2pa-cert.sh'),
        join(dir, 'keys'),
      ])
        .toString()
        .trim()
        .split('\n')
        .map((l) => [
          l.slice(0, l.indexOf('=')),
          l.slice(l.indexOf('=') + 1).replace(/\\n/g, '\n'),
        ]),
    );
    const builder = await Builder.withJsonAsync({
      claim_generator_info: [{ name: 'Some image model' }],
      title: 'face.jpg',
      assertions: [
        {
          label: 'c2pa.actions',
          data: { actions: [{ action: 'c2pa.created', digitalSourceType: AI_SOURCE_TYPES[0] }] },
        },
      ],
    } as never);
    const out: { buffer: Buffer | null } = { buffer: null };
    builder.sign(
      LocalSigner.newSigner(
        Buffer.from(keys.C2PA_CERT_PEM!),
        Buffer.from(keys.C2PA_KEY_PEM!),
        'es256',
      ),
      { buffer: selfie, mimeType: 'image/jpeg' },
      out,
    );
    const r = await upload(out.buffer!);
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('PHOTO_REJECTED');
  });
});

describe('reported posts', () => {
  const livePost = async (text?: string, photoBytes?: Buffer) => {
    const [p] = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Bar', category: 'drinks', at: ORIGIN }),
    ]);
    const { media } = await checkinWithMedia(
      t.ctx,
      u.id,
      p!._id,
      ORIGIN,
      photoBytes ? ['photo'] : [],
    );
    if (photoBytes) await t.ctx.providers.storage.put(media[0]!.key, photoBytes, 'image/jpeg');
    const post: PostDoc = {
      _id: newId(),
      authorId: u.id,
      type: photoBytes ? 'photos' : 'review',
      status: 'live',
      placeId: p!._id,
      mediaIds: media.map((m) => m._id),
      text,
      stamp: { placeName: 'Bar', time: new Date(), tier: 'tag' },
      hiddenFrom: [],
      createdAt: new Date(),
    };
    await t.ctx.db.collection<PostDoc>('posts').insertOne(post);
    return post._id;
  };
  const report = async (postId: string, reporterId = newId()) =>
    t.ctx.db.collection('reports').insertOne({
      _id: newId() as never,
      reporterId,
      postId,
      status: 'open',
      createdAt: new Date(),
    });
  const status = async (id: string) =>
    (await t.ctx.db.collection<PostDoc>('posts').findOne({ _id: id }))!.status;

  test('no detector: Gemini re-checks; a clean post with one report stays up', async () => {
    t.ctx.providers.detector = new OffDetector();
    const fine = await livePost('Great pierogi');
    await report(fine);
    await reviewReport(t.ctx, { postId: fine });
    expect(await status(fine)).toBe('live');
    expect(await t.ctx.db.collection('reports').findOne({ postId: fine })).toMatchObject({
      status: 'reviewed',
    });

    const bad = await livePost('kill yourself');
    await report(bad);
    await reviewReport(t.ctx, { postId: bad });
    expect(await status(bad)).toBe('removed');
  });

  test('three different reporters take a post down', async () => {
    const id = await livePost('Fine text');
    for (let i = 0; i < 3; i++) await report(id);
    await reviewReport(t.ctx, { postId: id });
    expect(await t.ctx.db.collection<PostDoc>('posts').findOne({ _id: id })).toMatchObject({
      status: 'removed',
      moderationReason: 'Reported by 3 people',
    });
  });

  test('Reality Defender flags manipulated media on a reported post', async () => {
    t.ctx.providers.detector = new FakeDetector();
    const id = await livePost(undefined, deepfake);
    await report(id);
    await expect(reviewReport(t.ctx, { postId: id })).rejects.toThrow(/still running/);
    await reviewReport(t.ctx, { postId: id });
    expect(await status(id)).toBe('removed');
    expect(await t.ctx.db.collection('reports').findOne({ postId: id })).toMatchObject({
      status: 'actioned',
    });

    const real = await livePost(undefined, selfie);
    await report(real);
    await reviewReport(t.ctx, { postId: real }).catch(() => {});
    await reviewReport(t.ctx, { postId: real });
    expect(await status(real)).toBe('live');
  });
});

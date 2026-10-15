import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@itp/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { AI_SOURCE_TYPES } from '../src/providers/c2pa.ts';
import { FakeDetector, OffDetector } from '../src/providers/detector.ts';
import type { MemoryStorage } from '../src/providers/storage.ts';
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

describe('a replaced profile photo takes its objects with it', () => {
  type PhotoUser = Awaited<ReturnType<typeof devLogin>>;
  let who: PhotoUser;
  let n = 0;
  const memory = () => t.ctx.providers.storage as MemoryStorage;
  const uploadAs = (body: Buffer) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/me/photo',
      headers: { ...who.headers, 'content-type': 'image/jpeg' },
      payload: body,
    });
  /** What the user document points at right now. */
  const refs = async () => {
    const d = (await t.ctx.db.collection('users').findOne({ _id: who.id as never }))!;
    return {
      live: d.photoKey as string | undefined,
      review: d.photoReview?.key as string | undefined,
      origKey: d.photoReview?.origKey as string | undefined,
      status: d.photoReview?.status as string | undefined,
    };
  };
  /** Every profile-photo object in storage (the renditions under p/ and the originals kept for the scan). */
  const stored = () =>
    [...memory().objects.keys()]
      .filter((k) => k.startsWith('p/') || k.startsWith('orig/profile/'))
      .sort();
  /** Runs the scan job to its end: the first poll is still pending, the second answers. */
  const scan = async (key: string) => {
    await scanPhoto(t.ctx, { userId: who.id, key }).catch(() => {});
    await scanPhoto(t.ctx, { userId: who.id, key });
  };

  beforeEach(async () => {
    for (const k of stored()) memory().objects.delete(k);
    who = await devLogin(t.app, `swapper_${++n}`);
  });

  test('no detector: the second upload goes live and the first photo is deleted', async () => {
    t.ctx.providers.detector = new OffDetector();
    expect((await uploadAs(selfie)).statusCode).toBe(200);
    const first = (await refs()).live!;
    expect(stored()).toEqual([first]);

    const second = await uploadAs(selfie);
    expect(second.statusCode).toBe(200);
    const live = (await refs()).live!;
    expect(live).not.toBe(first);
    expect(second.json().photoUrl).toContain(live);
    expect(stored()).toEqual([live]);
  });

  test('detector on, both scans pass: the live photo stays until the next one passes, and originals go once scanned', async () => {
    t.ctx.providers.detector = new FakeDetector();
    await uploadAs(selfie);
    const a = await refs();
    expect(a).toMatchObject({ live: undefined, status: 'scanning' });
    expect(stored()).toEqual([a.review!, a.origKey!].sort());
    await scan(a.review!);
    expect(await refs()).toMatchObject({ live: a.review, review: undefined });
    expect(stored()).toEqual([a.review]); // the original was only for the scan

    await uploadAs(selfie);
    const b = await refs();
    expect(b).toMatchObject({ live: a.review, status: 'scanning' });
    expect(stored()).toEqual([a.review!, b.review!, b.origKey!].sort()); // the live photo is still shown
    await scan(b.review!);
    expect(await refs()).toMatchObject({ live: b.review, review: undefined });
    expect(stored()).toEqual([b.review]);
  });

  test('detector on, a second upload before the first scan finishes replaces the pending review, not the live photo', async () => {
    t.ctx.providers.detector = new OffDetector();
    await uploadAs(selfie);
    const live = (await refs()).live!;
    t.ctx.providers.detector = new FakeDetector();

    await uploadAs(selfie);
    const a = await refs();
    await uploadAs(selfie);
    const b = await refs();
    expect(b.review).not.toBe(a.review);
    expect(b.live).toBe(live);
    expect(stored()).toEqual([live, b.review!, b.origKey!].sort());

    // The scan queued for the first upload finds it replaced and leaves everything as it is.
    await scanPhoto(t.ctx, { userId: who.id, key: a.review! });
    expect(stored()).toEqual([live, b.review!, b.origKey!].sort());
    await scan(b.review!);
    expect(stored()).toEqual([b.review]);
  });

  test('scan refused: its objects stay while the app shows the reason, and the next upload clears them', async () => {
    t.ctx.providers.detector = new OffDetector();
    await uploadAs(selfie);
    const live = (await refs()).live!;
    t.ctx.providers.detector = new FakeDetector();

    await uploadAs(deepfake);
    const bad = await refs();
    await scan(bad.review!);
    expect(await refs()).toMatchObject({ live, review: bad.review, status: 'rejected' });
    expect(stored()).toEqual([live, bad.review!, bad.origKey!].sort());

    await uploadAs(selfie);
    const good = await refs();
    expect(good.review).not.toBe(bad.review);
    expect(stored()).toEqual([live, good.review!, good.origKey!].sort());
    await scan(good.review!);
    expect(stored()).toEqual([good.review]);
  });

  test('scan refused twice in a row: only the latest refusal is kept', async () => {
    t.ctx.providers.detector = new FakeDetector();
    await uploadAs(deepfake);
    const one = await refs();
    await scan(one.review!);
    await uploadAs(deepfake);
    const two = await refs();
    await scan(two.review!);
    expect(await refs()).toMatchObject({ live: undefined, status: 'rejected' });
    expect(stored()).toEqual([two.review!, two.origKey!].sort());
  });

  test('a storage failure is logged and never fails the upload or the scan', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = vi.spyOn(memory(), 'delete').mockRejectedValue(new Error('bucket unavailable'));
    try {
      t.ctx.providers.detector = new OffDetector();
      await uploadAs(selfie);
      const first = (await refs()).live!;
      const second = await uploadAs(selfie);
      expect(second.statusCode).toBe(200);
      expect(second.json().photoUrl).toContain((await refs()).live);
      expect(stored()).toContain(first); // left behind for a clean-up to find
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`could not delete ${first}`));

      t.ctx.providers.detector = new FakeDetector();
      await uploadAs(selfie);
      const review = await refs();
      await scan(review.review!);
      expect(await refs()).toMatchObject({ live: review.review, review: undefined });
      expect(stored()).toContain(review.origKey);
    } finally {
      failing.mockRestore();
      warn.mockRestore();
    }
  });

  test('only profile-photo keys are ever deleted, whatever a user document says', async () => {
    t.ctx.providers.detector = new OffDetector();
    const foreign = [
      'r/a-clip-rendition.mp4',
      'orig/profile/someone-else/x.jpg',
      'orig/me/cap.jpg',
    ];
    for (const k of foreign) await memory().put(k, Buffer.from('keep'), 'image/jpeg');
    await t.ctx.db.collection('users').updateOne(
      { _id: who.id as never },
      {
        $set: {
          photoKey: foreign[0],
          photoReview: { key: foreign[1], origKey: foreign[2], status: 'rejected', at: new Date() },
        },
      },
    );
    expect((await uploadAs(selfie)).statusCode).toBe(200);
    for (const k of foreign) expect(await memory().get(k), k).not.toBeNull();
    for (const k of foreign) memory().objects.delete(k);
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

  test('Gemini down: three reporters still take the post down; fewer retry and the post stays up', async () => {
    t.ctx.providers.detector = new OffDetector();
    const down = vi
      .spyOn(t.ctx.providers.llm, 'moderate')
      .mockRejectedValue(new Error('gemini 503'));
    try {
      const few = await livePost('Fine text');
      await report(few);
      await report(few);
      await expect(reviewReport(t.ctx, { postId: few })).rejects.toThrow(/503/);
      expect(await status(few)).toBe('live');
      expect(await t.ctx.db.collection('reports').findOne({ postId: few })).toMatchObject({
        status: 'open',
      });

      const many = await livePost('Fine text');
      for (let i = 0; i < 3; i++) await report(many);
      await reviewReport(t.ctx, { postId: many });
      expect(await t.ctx.db.collection<PostDoc>('posts').findOne({ _id: many })).toMatchObject({
        status: 'removed',
        moderationReason: 'Reported by 3 people',
      });
      expect(down).toHaveBeenCalledTimes(2);
    } finally {
      down.mockRestore();
    }
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

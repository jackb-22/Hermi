import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { handlers } from '../src/jobs/handlers.ts';
import { enqueue, Worker } from '../src/jobs/queue.ts';
import { checkinWithMedia } from './fixtures/media.ts';
import { insertPlaces, ORIGIN, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'itp-fx-'));
const ff = (...args: string[]) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const probe = (buf: Buffer, ext: string) => {
  const p = join(dir, `probe.${ext}`);
  writeFileSync(p, buf);
  return JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', p]).toString(),
  ).streams as { codec_type: string; codec_name: string; width?: number; height?: number }[];
};

let t: Awaited<ReturnType<typeof setupTestApp>>;
let worker: Worker;
let clip: Buffer;
let photo: Buffer;
let sound: Buffer;

beforeAll(async () => {
  ff(
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=1920x1080:rate=30:duration=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-shortest',
    join(dir, 'clip.mp4'),
  );
  ff('-f', 'lavfi', '-i', 'testsrc=size=3000x2000', '-frames:v', '1', join(dir, 'photo.jpg'));
  ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-c:a', 'aac', join(dir, 'amb.m4a'));
  [clip, photo, sound] = ['clip.mp4', 'photo.jpg', 'amb.m4a'].map((f) =>
    readFileSync(join(dir, f)),
  ) as [Buffer, Buffer, Buffer];
  t = await setupTestApp();
  worker = new Worker(t.ctx, handlers, { info: () => {}, error: () => {} });
});
afterAll(() => t.teardown());

test('clip → 720p H.264 + poster; photo → ≤1440 px JPEG; ambient → AAC; idempotent', async () => {
  const [p] = await insertPlaces(t.ctx.db, [
    placeDoc({ name: 'Club', category: 'music', at: ORIGIN }),
  ]);
  const u = await devLogin(t.app, 'filmer');
  const { media } = await checkinWithMedia(t.ctx, u.id, p!._id, ORIGIN, [
    'video',
    'photo',
    'audio',
  ]);
  const bytes = [clip, photo, sound];
  for (const [i, m] of media.entries()) {
    await t.ctx.providers.storage.put(m.key, bytes[i]!, m.contentType);
    await enqueue(t.ctx, 'process_media', { mediaId: m._id });
  }

  // A clip post waits for its rendition before the safety check can look at frames.
  const post = await t.app.inject({
    method: 'POST',
    url: '/v1/posts',
    headers: u.headers,
    payload: { mediaIds: [media[0]!._id] },
  });
  expect(post.json().status).toBe('pending');
  await worker.drain();
  t.ctx.clock.offsetMs = 10 * 60_000; // past the moderation retry backoff
  await worker.drain();
  t.ctx.clock.offsetMs = 0;
  expect(
    (await t.ctx.db.collection('posts').findOne({ _id: post.json().id } as never))?.status,
  ).toBe('live');

  const docs = await t.ctx.db
    .collection('media')
    .find({ _id: { $in: media.map((m) => m._id) } } as never)
    .toArray();
  const byKind = Object.fromEntries(docs.map((d) => [d.kind, d]));
  const get = async (k: string) => (await t.ctx.providers.storage.get(k))!;

  const v = probe(await get(byKind.video!.rendition.key), 'mp4');
  expect(v.find((s) => s.codec_type === 'video')).toMatchObject({
    codec_name: 'h264',
    height: 720,
    width: 1280,
  });
  expect(v.find((s) => s.codec_type === 'audio')?.codec_name).toBe('aac');
  expect(byKind.video!.rendition.key).toMatch(/^r\/[0-9a-f]{32}\.mp4$/);
  expect(probe(await get(byKind.video!.rendition.posterKey), 'jpg')[0]).toMatchObject({
    width: 1280,
    height: 720,
  });
  expect(probe(await get(byKind.photo!.rendition.key), 'jpg')[0]).toMatchObject({
    width: 1440,
    height: 960,
  });
  expect(probe(await get(byKind.audio!.rendition.key), 'm4a')[0]?.codec_name).toBe('aac');

  const before = byKind.video!.rendition.key;
  await enqueue(t.ctx, 'process_media', { mediaId: byKind.video!._id });
  await worker.drain();
  expect(
    (await t.ctx.db.collection('media').findOne({ _id: byKind.video!._id } as never))?.rendition
      .key,
  ).toBe(before);

  const feedPost = (
    await t.app.inject({ url: `/v1/posts/${post.json().id}`, headers: u.headers })
  ).json();
  expect(feedPost.media[0]).toMatchObject({
    kind: 'video',
    posterUrl: expect.stringContaining('/r/'),
  });
});

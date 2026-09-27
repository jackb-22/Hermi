import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { handlers } from '../src/jobs/handlers.ts';
import { Worker } from '../src/jobs/queue.ts';
import { signMediaUrl } from '../src/providers/storage.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { venueTag } from './fixtures/tags.ts';
import { devLogin, setupTestApp } from './helpers.ts';

// The laptop / Cloud Run setup: no CDN, storage the phone cannot reach, so the API serves every media URL.
const BASE = 'http://api.test';
let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
  t = await setupTestApp({
    PUBLIC_BASE_URL: BASE,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_KEY: 's3dev',
    S3_SECRET: 's3dev12345',
    S3_FORCE_PATH_STYLE: '1',
    S3_BUCKET: 'itp-test',
    MEDIA_UPLOAD_MODE: 'api',
    MEDIA_DELIVERY: 'api',
  });
});
afterAll(() => t.teardown());

const path = (url: string) => {
  const u = new URL(url);
  expect(u.origin).toBe(BASE);
  return u.pathname + u.search;
};
const get = (url: string, headers: Record<string, string> = {}, method: 'GET' | 'HEAD' = 'GET') =>
  t.app.inject({ method, url, headers });

describe('GET /media/* (MEDIA_DELIVERY=api)', () => {
  const bytes = randomBytes(1000);
  const pub = `r/${randomBytes(8).toString('hex')}.mp4`;
  const orig = `orig/u1/${randomBytes(8).toString('hex')}.jpg`;
  beforeAll(async () => {
    await t.ctx.providers.storage.put(pub, bytes, 'video/mp4', { public: true });
    await t.ctx.providers.storage.put(orig, bytes, 'image/jpeg');
  });

  test('public renditions: whole file, cacheable forever, ranges advertised', async () => {
    const r = await get(path(t.ctx.providers.storage.publicUrl(pub)));
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.equals(bytes)).toBe(true);
    expect(r.headers).toMatchObject({
      'content-type': 'video/mp4',
      'content-length': '1000',
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=31536000, immutable',
    });
  });

  test('byte ranges (iOS video playback needs them); past the end is 416', async () => {
    const a = await get(`/media/${pub}`, { range: 'bytes=0-99' });
    expect(a.statusCode).toBe(206);
    expect(a.headers['content-range']).toBe('bytes 0-99/1000');
    expect(a.rawPayload.equals(bytes.subarray(0, 100))).toBe(true);
    const b = await get(`/media/${pub}`, { range: 'bytes=900-' });
    expect(b.statusCode).toBe(206);
    expect(b.headers['content-range']).toBe('bytes 900-999/1000');
    expect(b.rawPayload).toHaveLength(100);
    expect((await get(`/media/${pub}`, { range: 'bytes=5000-' })).statusCode).toBe(416);
  });

  test('HEAD answers with headers only', async () => {
    const r = await get(`/media/${pub}`, {}, 'HEAD');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-length']).toBe('1000');
    expect(r.rawPayload).toHaveLength(0);
  });

  test('originals need the signed URL the API handed out; tampered or expired links fail', async () => {
    expect((await get(`/media/${orig}`)).statusCode).toBe(403);
    const signed = await t.ctx.providers.storage.presignGet(orig);
    const ok = await get(path(signed));
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('private, max-age=300');
    expect((await get(path(signed).replace(/sig=./, 'sig=x'))).statusCode).toBe(403);
    const expired = signMediaUrl(BASE, t.ctx.config.JWT_SECRET, orig, -10);
    expect((await get(path(expired))).statusCode).toBe(403);
    // A signature for one key does not open another.
    const other = path(signed).replace(orig, `orig/u1/${randomBytes(8).toString('hex')}.jpg`);
    expect((await get(other)).statusCode).toBe(403);
  });

  test('unknown keys and path tricks are 404', async () => {
    expect((await get('/media/r/nothing-here.jpg')).statusCode).toBe(404);
    expect((await get(`/media/r/..%2F${orig}`)).statusCode).toBe(404);
    expect((await get('/media/r/.hidden')).statusCode).toBe(404);
  });
});

test('a capture end to end: upload through the API, rendition and original both served by the API', async () => {
  const [p] = await insertPlaces(t.ctx.db, [
    placeDoc({ name: 'Venue', category: 'music', at: ORIGIN }),
  ]);
  const tag = await venueTag(t.ctx.db, p!._id);
  const u = await devLogin(t.app, 'laptopdemo');
  const at = offset(ORIGIN, 20, 0);
  const c = (
    await t.app.inject({
      method: 'POST',
      url: '/v1/checkins',
      headers: u.headers,
      payload: { tier: 'tag', tagUrl: tag.url, ...at, accuracy: 10 },
    })
  ).json();
  const jpg = execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x480',
    '-frames:v',
    '1',
    '-f',
    'mjpeg',
    'pipe:1',
  ]);
  const presign = (
    await t.app.inject({
      method: 'POST',
      url: '/v1/media/presign',
      headers: u.headers,
      payload: {
        checkinId: c.checkin.id,
        kind: 'photo',
        contentType: 'image/jpeg',
        sha256: createHash('sha256').update(jpg).digest('hex'),
        bytes: jpg.length,
        capturedAt: new Date().toISOString(),
        ...at,
      },
    })
  ).json();
  expect(presign.upload.url).toBe(`${BASE}/v1/media/${presign.media.id}/upload`);
  const put = await t.app.inject({
    method: 'PUT',
    url: path(presign.upload.url),
    headers: presign.upload.headers,
    payload: jpg,
  });
  expect(put.statusCode).toBe(200);
  const committed = await t.app.inject({
    method: 'POST',
    url: `/v1/media/${presign.media.id}/commit`,
    headers: u.headers,
  });
  expect(committed.json().status).toBe('verified');
  await new Worker(t.ctx, handlers, { info: () => {}, error: (o) => console.error(o) }).drain();

  const [m] = (
    await t.app.inject({
      url: `/v1/media?checkinId=${c.checkin.id}`,
      headers: u.headers,
    })
  ).json().items;
  expect(m.renditionUrl).toMatch(new RegExp(`^${BASE}/media/r/[0-9a-f]{32}\\.jpg$`));
  const rendition = await get(path(m.renditionUrl));
  expect(rendition.statusCode).toBe(200);
  expect(rendition.headers['content-type']).toBe('image/jpeg');
  const original = await get(path(m.url));
  expect(original.statusCode).toBe(200);
  expect(original.rawPayload.equals(jpg)).toBe(true);
});

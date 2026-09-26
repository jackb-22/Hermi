import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { venueTag } from './fixtures/tags.ts';
import { devLogin, setupTestApp } from './helpers.ts';

const S3 = {
  S3_ENDPOINT: 'http://localhost:9000',
  S3_KEY: 's3dev',
  S3_SECRET: 's3dev12345',
  S3_FORCE_PATH_STYLE: '1',
  S3_BUCKET: 'itp-test',
};

describe.each([
  ['memory storage, upload via API', {}],
  ['S3 (RustFS), direct presigned PUT', S3],
] as const)('%s', (_name, env) => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let u: Awaited<ReturnType<typeof devLogin>>;
  let checkinId: string;
  const at = offset(ORIGIN, 20, 0);

  beforeAll(async () => {
    t = await setupTestApp({ ...env });
    const [p] = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Venue', category: 'music', at: ORIGIN }),
    ]);
    const tag = await venueTag(t.ctx.db, p!._id);
    u = await devLogin(t.app, 'shooter');
    const c = await t.app.inject({
      method: 'POST',
      url: '/v1/checkins',
      headers: u.headers,
      payload: { tier: 'tag', tagUrl: tag.url, ...at, accuracy: 10 },
    });
    checkinId = c.json().checkin.id;
  });
  afterAll(() => t.teardown());

  const capture = async (
    bytes: Buffer,
    o: { lat?: number; lng?: number; capturedAt?: string; sha?: string } = {},
  ) => {
    const sha = o.sha ?? createHash('sha256').update(bytes).digest('hex');
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/media/presign',
      headers: u.headers,
      payload: {
        checkinId,
        kind: 'photo',
        contentType: 'image/jpeg',
        sha256: sha,
        bytes: bytes.length,
        capturedAt: o.capturedAt ?? new Date().toISOString(),
        lat: o.lat ?? at.lat,
        lng: o.lng ?? at.lng,
      },
    });
    return r;
  };

  const upload = async (
    presign: { upload: { url: string; headers: Record<string, string> } },
    bytes: Buffer,
  ) => {
    const { url, headers } = presign.upload;
    if (url.includes('/v1/media/')) {
      const path = new URL(url).pathname;
      const r = await t.app.inject({ method: 'PUT', url: path, headers, payload: bytes });
      expect(r.statusCode).toBe(200);
    } else {
      const r = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(bytes) });
      expect(r.status).toBe(200);
    }
  };

  test('capture → upload → commit verifies, enqueues processing, stays private', async () => {
    const bytes = randomBytes(2048);
    const p = await capture(bytes);
    expect(p.statusCode).toBe(200);
    expect(p.json().media).toMatchObject({ status: 'pending', url: null });
    await upload(p.json(), bytes);
    const c = await t.app.inject({
      method: 'POST',
      url: `/v1/media/${p.json().media.id}/commit`,
      headers: u.headers,
    });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({
      status: 'verified',
      url: expect.any(String),
      verifyUrl: expect.stringContaining('/verify/'),
    });
    const job = await t.ctx.db.collection('jobs').findOne({ type: 'process_media' });
    expect(job?.payload).toEqual({ mediaId: p.json().media.id });
    const list = await t.app.inject({ url: '/v1/media', query: { checkinId }, headers: u.headers });
    expect(list.json().items).toHaveLength(1);
  });

  test('hash mismatch is rejected', async () => {
    const bytes = randomBytes(1024);
    const p = await capture(bytes, { sha: 'a'.repeat(64) });
    await upload(p.json(), bytes);
    const c = await t.app.inject({
      method: 'POST',
      url: `/v1/media/${p.json().media.id}/commit`,
      headers: u.headers,
    });
    expect(c.json().error.code).toBe('MEDIA_HASH_MISMATCH');
  });

  test('outside the time window or too far away', async () => {
    const early = await capture(randomBytes(10), {
      capturedAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(early.json().error.code).toBe('MEDIA_OUT_OF_WINDOW');
    const bytes = randomBytes(512);
    const far = await capture(bytes, offset(ORIGIN, 400, 0));
    await upload(far.json(), bytes);
    const c = await t.app.inject({
      method: 'POST',
      url: `/v1/media/${far.json().media.id}/commit`,
      headers: u.headers,
    });
    expect(c.json().error.code).toBe('MEDIA_TOO_FAR');
  });

  test("someone else's check-in cannot be used", async () => {
    const other = await devLogin(t.app, 'thief');
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/media/presign',
      headers: other.headers,
      payload: {
        checkinId,
        kind: 'photo',
        contentType: 'image/jpeg',
        sha256: 'b'.repeat(64),
        bytes: 10,
        capturedAt: new Date().toISOString(),
        ...at,
      },
    });
    expect(r.statusCode).toBe(404);
  });
});

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { processMedia } from '../src/jobs/processMedia.ts';
import { DIGITAL_CAPTURE, ReadOnlyCredentials } from '../src/providers/c2pa.ts';
import type { MediaDoc } from '../src/services/media.ts';
import { checkinWithMedia } from './fixtures/media.ts';
import { insertPlaces, ORIGIN, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'itp-c2pa-'));
// The same script the deploy uses, so the certificate profile c2pa-rs demands is tested too.
const env = Object.fromEntries(
  execFileSync('bash', [
    join(import.meta.dirname, '../scripts/make-c2pa-cert.sh'),
    join(dir, 'keys'),
  ])
    .toString()
    .trim()
    .split('\n')
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
) as { C2PA_CERT_PEM: string; C2PA_KEY_PEM: string };

const ff = (...args: string[]) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
ff('-f', 'lavfi', '-i', 'testsrc=size=640x480', '-frames:v', '1', join(dir, 'photo.jpg'));
ff(
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=320x240:rate=30:duration=1',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  join(dir, 'clip.mp4'),
);
const photo = readFileSync(join(dir, 'photo.jpg'));
const clip = readFileSync(join(dir, 'clip.mp4'));

let t: Awaited<ReturnType<typeof setupTestApp>>;
let userId: string;

beforeAll(async () => {
  t = await setupTestApp(env);
  userId = (await devLogin(t.app, 'signer')).id;
});
afterAll(() => t.teardown());

// One place per capture: the same user cannot check in at one place twice within 6 hours.
const capture = async (kind: 'photo' | 'video', bytes: Buffer) => {
  const [p] = await insertPlaces(t.ctx.db, [
    placeDoc({ name: 'Pastry Shop', category: 'food', at: ORIGIN }),
  ]);
  const { media } = await checkinWithMedia(t.ctx, userId, p!._id, ORIGIN, [kind]);
  await t.ctx.providers.storage.put(media[0]!.key, bytes, media[0]!.contentType);
  return media[0]!;
};
const doc = (id: string) => t.ctx.db.collection<MediaDoc>('media').findOne({ _id: id });

describe('C2PA Content Credentials', () => {
  test('a verified photo gets a signed copy of the original: in-app capture, place, check-in', async () => {
    expect(t.ctx.providers.c2pa.canSign).toBe(true);
    const m = await capture('photo', photo);
    await processMedia(t.ctx, { mediaId: m._id });
    const after = (await doc(m._id))!;
    expect(after.rendition).toBeTruthy();
    expect(after.c2pa).toMatchObject({
      manifestKey: expect.stringMatching(/^c2pa\/[0-9a-f]{32}\.jpg$/),
      signer: 'Verified IRL Signer',
    });

    const signed = (await t.ctx.providers.storage.get(after.c2pa!.manifestKey))!;
    const summary = await t.ctx.providers.c2pa.read(signed, 'image/jpeg');
    expect(summary).toMatchObject({
      generator: 'Incentivize the Physical',
      signer: 'Verified IRL Signer',
      validationState: 'Valid',
      failures: [],
      sourceTypes: [DIGITAL_CAPTURE],
    });
    expect(summary!.assertions).toContain('app.itp.checkin');

    // Idempotent: a retried job neither re-signs nor re-renders.
    await processMedia(t.ctx, { mediaId: m._id });
    expect((await doc(m._id))!.c2pa!.manifestKey).toBe(after.c2pa!.manifestKey);
    expect((await doc(m._id))!.rendition!.key).toBe(after.rendition!.key);
  });

  test('clips are signed too; the verify page links the file and the inspector once posted', async () => {
    const m = await capture('video', clip);
    await processMedia(t.ctx, { mediaId: m._id });
    const after = (await doc(m._id))!;
    const summary = await t.ctx.providers.c2pa.read(
      (await t.ctx.providers.storage.get(after.c2pa!.manifestKey))!,
      'video/mp4',
    );
    expect(summary?.validationState).toBe('Valid');

    await t.ctx.db
      .collection<MediaDoc>('media')
      .updateOne({ _id: m._id }, { $set: { posted: true } });
    const v = (await t.app.inject(`/v1/credentials/${m.sha256}`)).json();
    expect(v.credential).toMatchObject({
      c2pa: true,
      signer: 'Verified IRL Signer',
      manifestUrl: expect.stringContaining(after.c2pa!.manifestKey),
      inspectUrl: expect.stringMatching(/^https:\/\/contentcredentials\.org\/verify\?source=/),
    });
    const html = (await t.app.inject(`/verify/${m.sha256}`)).body;
    expect(html).toContain('Download with credentials');
  });

  test('a capture rendered before signing was configured gets signed on a later run', async () => {
    const m = await capture('photo', photo);
    await t.ctx.db
      .collection<MediaDoc>('media')
      .updateOne(
        { _id: m._id },
        { $set: { rendition: { key: 'r/already.jpg', contentType: 'image/jpeg' } } },
      );
    await processMedia(t.ctx, { mediaId: m._id });
    const after = (await doc(m._id))!;
    expect(after.rendition!.key).toBe('r/already.jpg');
    expect(after.c2pa).toBeTruthy();
  });

  test('reading: files without a manifest give null; unsigned deployments still read', async () => {
    const ro = new ReadOnlyCredentials();
    expect(ro.canSign).toBe(false);
    expect(await ro.read(photo, 'image/jpeg')).toBeNull();
    const m = (await doc((await capture('photo', photo))._id))!;
    await processMedia(t.ctx, { mediaId: m._id });
    const signed = (await t.ctx.providers.storage.get((await doc(m._id))!.c2pa!.manifestKey))!;
    expect((await ro.read(signed, 'image/jpeg'))?.signer).toBe('Verified IRL Signer');
  });
});

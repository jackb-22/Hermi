import type { AppContext } from '../context.ts';
import { renditionKey, transcodeAudio, transcodePhoto, transcodeVideo } from '../media/ffmpeg.ts';
import { signableType } from '../providers/c2pa.ts';
import { extFor, getCheckin, type MediaDoc, media } from '../services/media.ts';
import { places } from '../services/places.ts';

/**
 * Worker: transcodes a verified capture into its public feed rendition under an unguessable key on the CDN
 * (clips: 720p H.264 + poster; photos: ≤1440 px JPEG; ambient: AAC). Originals stay private.
 * Transcoding strips any C2PA credential, so the credential lives on a signed copy of the original: a manifest
 * (in-app capture, place, time, verified check-in) embedded with c2pa-node, public under its own unguessable key.
 */
export async function processMedia(ctx: AppContext, payload: { mediaId: string }) {
  const { db, providers } = ctx;
  const m = await media(db).findOne({ _id: payload.mediaId });
  if (m?.status !== 'verified') return;
  const wantsCredential = !m.c2pa && providers.c2pa.canSign && !!signableType(m.contentType);
  if (m.rendition && !wantsCredential) return;
  const original = await providers.storage.get(m.key);
  if (!original) throw new Error(`original missing for ${m._id}`);
  if (!m.rendition) await render(ctx, m, original);
  if (wantsCredential) {
    // A signing failure must not hold up the feed: the capture record still backs the stamp.
    try {
      await signCredential(ctx, m, original);
    } catch (e) {
      console.warn(`[c2pa] signing ${m._id} failed: ${(e as Error).message}`);
    }
  }
}

async function render(ctx: AppContext, m: MediaDoc, original: Buffer) {
  const { db, providers } = ctx;
  const ext = extFor(m.contentType);
  let rendition: NonNullable<MediaDoc['rendition']>;
  if (m.kind === 'video') {
    const [mp4, poster] = await transcodeVideo(original, ext);
    rendition = {
      key: renditionKey('mp4'),
      posterKey: renditionKey('jpg'),
      contentType: 'video/mp4',
    };
    await providers.storage.put(rendition.key, mp4!, 'video/mp4', { public: true });
    await providers.storage.put(rendition.posterKey!, poster!, 'image/jpeg', { public: true });
  } else if (m.kind === 'photo') {
    const [jpg] = await transcodePhoto(original, ext);
    rendition = { key: renditionKey('jpg'), contentType: 'image/jpeg' };
    await providers.storage.put(rendition.key, jpg!, 'image/jpeg', { public: true });
  } else {
    const [m4a] = await transcodeAudio(original, ext);
    rendition = { key: renditionKey('m4a'), contentType: 'audio/mp4' };
    await providers.storage.put(rendition.key, m4a!, 'audio/mp4', { public: true });
  }
  await media(db).updateOne({ _id: m._id, rendition: { $exists: false } }, { $set: { rendition } });
}

async function signCredential(ctx: AppContext, m: MediaDoc, original: Buffer) {
  const { db, providers, config } = ctx;
  const [c, place] = await Promise.all([
    getCheckin(ctx.tiger, m.checkinId),
    places(db).findOne({ _id: m.placeId }),
  ]);
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, '');
  const signed = await providers.c2pa.sign(original, m.contentType, {
    title: `${place?.name ?? 'Capture'} · ${m.capturedAt.toISOString()}`,
    capturedAt: m.capturedAt,
    checkin: {
      capturedInApp: true,
      place: place?.name ?? null,
      placeId: m.placeId,
      capturedAt: m.capturedAt.toISOString(),
      checkinTier: c?.tier ?? null,
      checkinAt: c?.time.toISOString() ?? null,
      attested: c?.attested ?? false,
      originalSha256: m.sha256,
      verifyUrl: `${base}/verify/${m.sha256}`,
    },
  });
  const key = `c2pa/${renditionKey(extFor(m.contentType)).slice(2)}`;
  await providers.storage.put(key, signed, m.contentType, { public: true });
  const summary = await providers.c2pa.read(signed, m.contentType);
  await media(db).updateOne(
    { _id: m._id, c2pa: { $exists: false } },
    {
      $set: {
        c2pa: { manifestKey: key, signedAt: ctx.clock.now(), signer: summary?.signer ?? null },
      },
    },
  );
}

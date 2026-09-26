import { createHash } from 'node:crypto';
import { newId, toGeoJSONPoint } from '@itp/shared';
import type { AppContext } from '../../src/context.ts';
import { createCheckin } from '../../src/services/checkins.ts';
import type { MediaDoc } from '../../src/services/media.ts';

/** A tag check-in at the place plus verified captures, skipping the upload dance (covered in media.test). */
export async function checkinWithMedia(
  ctx: AppContext,
  userId: string,
  placeId: string,
  at: { lat: number; lng: number },
  kinds: ('photo' | 'video' | 'audio')[] = ['photo'],
  sessionId?: string,
) {
  const c = await createCheckin(ctx, {
    userId,
    placeId,
    tier: 'tag',
    at,
    accuracy: 10,
    time: ctx.clock.now(),
    attested: false,
    sessionId,
  });
  const docs: MediaDoc[] = kinds.map((kind) => ({
    _id: newId(),
    userId,
    checkinId: c.checkin.id,
    placeId,
    kind,
    contentType: kind === 'photo' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'audio/m4a',
    sha256: createHash('sha256').update(newId()).digest('hex'),
    bytes: 10,
    key: `orig/${userId}/${newId()}`,
    status: 'verified',
    capturedAt: ctx.clock.now(),
    at: toGeoJSONPoint(at),
    attested: false,
    posted: false,
    createdAt: ctx.clock.now(),
  }));
  if (docs.length) await ctx.db.collection<MediaDoc>('media').insertMany(docs);
  for (const d of docs)
    await ctx.providers.storage.put(d.key, Buffer.from('fake-bytes'), d.contentType);
  return { checkin: c.checkin, media: docs };
}

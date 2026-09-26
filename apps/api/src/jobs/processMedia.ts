import type { AppContext } from '../context.ts';
import { renditionKey, transcodeAudio, transcodePhoto, transcodeVideo } from '../media/ffmpeg.ts';
import { extFor, type MediaDoc, media } from '../services/media.ts';

/**
 * Worker: transcodes a verified capture into its public feed rendition under an unguessable key on the CDN
 * (clips: 720p H.264 + poster; photos: ≤1440 px JPEG; ambient: AAC). Originals stay private.
 * Transcoding strips any C2PA credential, which is why the Verified IRL stamp links to the original.
 */
export async function processMedia(ctx: AppContext, payload: { mediaId: string }) {
  const { db, providers } = ctx;
  const m = await media(db).findOne({ _id: payload.mediaId });
  if (m?.status !== 'verified' || m.rendition) return;
  const original = await providers.storage.get(m.key);
  if (!original) throw new Error(`original missing for ${m._id}`);
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

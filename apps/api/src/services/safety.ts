import { randomBytes } from 'node:crypto';
import { ApiError, newId } from '@itp/shared';
import type { AppContext } from '../context.ts';
import type { JobDoc } from '../jobs/queue.ts';
import { enqueue } from '../jobs/queue.ts';
import { transcodePhoto } from '../media/ffmpeg.ts';
import { AI_SOURCE_TYPES } from '../providers/c2pa.ts';
import type { DetectionOutcome } from '../providers/detector.ts';
import { extFor, media } from './media.ts';
import { notify } from './notify.ts';
import { type PostDoc, posts } from './posts.ts';
import { users } from './users.ts';

/** Reported by this many different people, a post comes down even if the detector passes it. */
export const REPORTS_TO_REMOVE = 3;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp']);

/**
 * Profile photos are the one upload from outside the camera, and an AI face is how catfishing starts. Read any
 * C2PA manifest first (AI generators declare it), then scan with Reality Defender before the photo goes live.
 */
export async function uploadProfilePhoto(
  ctx: AppContext,
  userId: string,
  data: Buffer,
  contentType: string,
): Promise<'live' | 'scanning'> {
  const { providers, db, clock } = ctx;
  if (!IMAGE_TYPES.has(contentType))
    throw new ApiError(400, 'BAD_REQUEST', 'Send a JPEG, PNG, HEIC or WebP image');
  const manifest = await providers.c2pa.read(data, contentType).catch(() => null);
  if (manifest?.sourceTypes.some((t) => AI_SOURCE_TYPES.includes(t)))
    throw new ApiError(
      422,
      'PHOTO_REJECTED',
      'This image says it was made with AI (Content Credentials); use a real photo of you',
    );
  let jpg: Buffer;
  try {
    [jpg] = (await transcodePhoto(data, extFor(contentType), 640)) as [Buffer];
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Could not read that image');
  }
  const key = `p/${randomBytes(16).toString('hex')}.jpg`;
  await providers.storage.put(key, jpg, 'image/jpeg', { public: true });

  if (!providers.detector.enabled) {
    await users(db).updateOne(
      { _id: userId },
      { $set: { photoKey: key }, $unset: { photoReview: '' } },
    );
    return 'live';
  }
  const origKey = `orig/profile/${userId}/${newId()}.${extFor(contentType)}`;
  await providers.storage.put(origKey, data, contentType);
  await users(db).updateOne(
    { _id: userId },
    { $set: { photoReview: { key, origKey, contentType, status: 'scanning', at: clock.now() } } },
  );
  await enqueue(ctx, 'scan_photo', { userId, key }, { maxAttempts: 10 });
  return 'scanning';
}

/** Upload once (the request id is kept), then poll; a pending result throws so the queue retries with backoff. */
async function detect(
  ctx: AppContext,
  existing: string | undefined,
  load: () => Promise<{ data: Buffer; name: string }>,
  save: (requestId: string) => Promise<unknown>,
): Promise<DetectionOutcome> {
  let requestId = existing;
  if (!requestId) {
    const { data, name } = await load();
    requestId = await ctx.providers.detector.submit(data, name);
    await save(requestId);
  }
  const out = await ctx.providers.detector.result(requestId);
  if (!out) throw new Error(`scan ${requestId} still running`);
  return out;
}

/** Job: the profile photo goes live if the scan passes; a manipulated face is refused and the user told. */
export async function scanPhoto(
  ctx: AppContext,
  payload: { userId: string; key: string },
  _job?: JobDoc,
) {
  const { db, providers } = ctx;
  const u = await users(db).findOne({ _id: payload.userId });
  const r = u?.photoReview;
  // A newer upload replaced this one: its own job handles it.
  if (!u || r?.status !== 'scanning' || r.key !== payload.key) return;
  const out = await detect(
    ctx,
    r.requestId,
    async () => ({
      data: (await providers.storage.get(r.origKey)) ?? Buffer.alloc(0),
      name: `profile.${extFor(r.contentType)}`,
    }),
    (requestId) =>
      users(db).updateOne(
        { _id: u._id, 'photoReview.key': r.key },
        { $set: { 'photoReview.requestId': requestId } },
      ),
  );
  if (out.verdict === 'MANIPULATED') {
    await users(db).updateOne(
      { _id: u._id, 'photoReview.key': r.key },
      {
        $set: {
          'photoReview.status': 'rejected',
          'photoReview.reason':
            'This photo looks AI-generated or edited. Please use a real photo of you.',
        },
      },
    );
    await notify(ctx, [u._id], {
      title: 'Profile photo not added',
      body: 'It looks AI-generated or edited. Please use a real photo of you.',
      data: { kind: 'photo_rejected' },
    });
    return;
  }
  // Authentic, or the detector could not tell: the photo goes live (reports and blocks still apply).
  await users(db).updateOne(
    { _id: u._id, 'photoReview.key': r.key },
    { $set: { photoKey: r.key }, $unset: { photoReview: '' } },
  );
}

type Scanned = PostDoc & {
  reportScan?: { requestId?: string; verdict?: string; score?: number | null };
};

/**
 * Job: review a reported post. The detector scans its first image (a photo, or a clip's poster frame); without one,
 * Gemini re-checks it. Manipulated media, a failed safety check, or three different reporters take it down.
 */
export async function reviewReport(ctx: AppContext, payload: { postId: string }, _job?: JobDoc) {
  const { db, providers, clock } = ctx;
  const col = db.collection<Scanned>('posts');
  const p = await col.findOne({ _id: payload.postId });
  if (p?.status !== 'live') return;
  const reports = db.collection<{ postId?: string; reporterId: string; status: string }>('reports');
  const reporters = (await reports.distinct('reporterId', { postId: p._id })).length;

  const docs = await media(db)
    .find({ _id: { $in: p.mediaIds } })
    .toArray();
  const photo = docs.find((m) => m.kind === 'photo');
  const poster = docs.find((m) => m.kind === 'video' && m.rendition?.posterKey);
  const imageKey = photo?.key ?? poster?.rendition?.posterKey;

  let reason: string | null = null;
  if (providers.detector.enabled && imageKey) {
    let verdict = p.reportScan?.verdict;
    if (!verdict) {
      const out = await detect(
        ctx,
        p.reportScan?.requestId,
        async () => ({
          data: (await providers.storage.get(imageKey)) ?? Buffer.alloc(0),
          name: photo ? `post.${extFor(photo.contentType)}` : 'poster.jpg',
        }),
        (requestId) => col.updateOne({ _id: p._id }, { $set: { reportScan: { requestId } } }),
      );
      verdict = out.verdict;
      await col.updateOne(
        { _id: p._id },
        { $set: { 'reportScan.verdict': out.verdict, 'reportScan.score': out.score } },
      );
    }
    if (verdict === 'MANIPULATED')
      reason = 'Reported; Reality Defender flagged the media as manipulated';
  } else {
    const images = [];
    for (const m of docs.slice(0, 3)) {
      const key = m.kind === 'photo' ? (m.rendition?.key ?? m.key) : m.rendition?.posterKey;
      const data = key ? await providers.storage.get(key) : null;
      if (data)
        images.push({
          mimeType: m.kind === 'photo' && !m.rendition ? m.contentType : 'image/jpeg',
          data,
        });
    }
    const v = await providers.llm.moderate({ text: p.text, images });
    if (!v.allowed) reason = `Reported; failed the safety check again: ${v.reason}`;
  }
  if (!reason && reporters >= REPORTS_TO_REMOVE) reason = `Reported by ${reporters} people`;

  if (reason) {
    await posts(db).updateOne(
      { _id: p._id, status: 'live' },
      { $set: { status: 'removed', moderationReason: reason } },
    );
    await reports.updateMany(
      { postId: p._id },
      { $set: { status: 'actioned', reviewedAt: clock.now() } },
    );
  } else {
    await reports.updateMany(
      { postId: p._id, status: 'open' },
      { $set: { status: 'reviewed', reviewedAt: clock.now() } },
    );
  }
}

import { fromGeoJSONPoint } from '@itp/shared';
import type { PostSchema } from '@itp/shared/api';
import type { Db } from 'mongodb';
import type { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { PlaceDoc } from '../db/placeTypes.ts';
import type { GeoPoint, UserDoc } from '../db/types.ts';
import { enqueue, type JobDoc } from '../jobs/queue.ts';
import { videoFrames } from '../media/ffmpeg.ts';
import { type MediaDoc, media } from './media.ts';
import { places } from './places.ts';
import { toUserCard } from './social.ts';
import { users } from './users.ts';

export type PostType = 'clip' | 'photos' | 'review' | 'recap';

export interface PostDoc {
  _id: string;
  authorId: string;
  type: PostType;
  status: 'pending' | 'live' | 'rejected' | 'removed';
  moderationReason?: string;
  placeId?: string;
  loc?: GeoPoint;
  planId?: string;
  sessionId?: string;
  mediaIds: string[];
  text?: string;
  again?: boolean;
  route?: {
    line: { lat: number; lng: number }[];
    stops: { placeId: string; name: string; index: number; loc: { lat: number; lng: number } }[];
  };
  stamp: { placeName: string; time: Date; tier: 'gps' | 'tag' };
  /** Reporters no longer see the post; it is queued for review. */
  hiddenFrom: string[];
  createdAt: Date;
  liveAt?: Date;
}

export const posts = (db: Db) => db.collection<PostDoc>('posts');

/** "Going" = people with the place in a saved or joined plan within the next 7 days. */
export async function goingCounts(
  db: Db,
  placeIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  if (!placeIds.length) return new Map();
  const rows = await db
    .collection('plans')
    .aggregate<{ _id: string; people: string[] }>([
      {
        $match: {
          'stops.placeId': { $in: placeIds },
          startAt: { $gte: now, $lte: new Date(now.getTime() + 7 * 86_400_000) },
          status: { $in: ['draft', 'planned', 'active'] },
        },
      },
      { $unwind: '$stops' },
      { $match: { 'stops.placeId': { $in: placeIds } } },
      {
        $project: {
          place: '$stops.placeId',
          people: {
            $concatArrays: [
              ['$hostId'],
              {
                $map: {
                  input: {
                    $filter: { input: '$members', cond: { $eq: ['$$this.status', 'joined'] } },
                  },
                  in: '$$this.userId',
                },
              },
            ],
          },
        },
      },
      { $unwind: '$people' },
      { $group: { _id: '$place', people: { $addToSet: '$people' } } },
    ])
    .toArray();
  return new Map(rows.map((r) => [r._id, r.people.length]));
}

/** Bulk-hydrates posts for the feed and profile grid in a handful of queries. */
export async function hydratePosts(
  ctx: AppContext,
  docs: PostDoc[],
): Promise<z.infer<typeof PostSchema>[]> {
  const { db, config, providers, clock } = ctx;
  const storage = providers.storage;
  const [authors, placeDocs, mediaDocs] = await Promise.all([
    users(db)
      .find({ _id: { $in: [...new Set(docs.map((p) => p.authorId))] } })
      .toArray(),
    places(db)
      .find({ _id: { $in: [...new Set(docs.flatMap((p) => (p.placeId ? [p.placeId] : [])))] } })
      .toArray(),
    media(db)
      .find({ _id: { $in: docs.flatMap((p) => p.mediaIds) } })
      .toArray(),
  ]);
  const byPlace = new Map(placeDocs.map((p) => [p._id, p as PlaceDoc]));
  const [ambient, going] = await Promise.all([
    media(db)
      .find({ _id: { $in: mediaDocs.flatMap((m) => (m.ambientId ? [m.ambientId] : [])) } })
      .toArray(),
    goingCounts(db, [...byPlace.keys()], clock.now()),
  ]);
  const byUser = new Map(authors.map((u) => [u._id, u as UserDoc]));
  const byMedia = new Map([...mediaDocs, ...ambient].map((m) => [m._id, m as MediaDoc]));
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, '');
  const url = async (m: MediaDoc) =>
    m.rendition ? storage.publicUrl(m.rendition.key) : await storage.presignGet(m.key);

  return Promise.all(
    docs.map(async (p) => {
      const place = p.placeId ? byPlace.get(p.placeId) : undefined;
      const author = byUser.get(p.authorId);
      const items = await Promise.all(
        p.mediaIds.flatMap((id) => {
          const m = byMedia.get(id);
          if (!m || m.kind === 'audio') return [];
          const amb = m.ambientId ? byMedia.get(m.ambientId) : undefined;
          return [
            (async () => ({
              id: m._id,
              kind: m.kind as 'photo' | 'video',
              url: await url(m),
              posterUrl: m.rendition?.posterKey ? storage.publicUrl(m.rendition.posterKey) : null,
              ambientUrl: amb ? await url(amb) : null,
              verifyUrl: `${base}/verify/${m.sha256}`,
            }))(),
          ];
        }),
      );
      return {
        id: p._id,
        type: p.type,
        status: p.status,
        author: author
          ? toUserCard(author, config)
          : {
              id: p.authorId,
              name: null,
              username: null,
              spriteUrl: null,
              photoUrl: null,
              verified: false,
              campus: null,
            },
        place: place
          ? {
              id: place._id,
              name: place.name,
              category: place.category,
              loc: fromGeoJSONPoint(place.loc),
            }
          : null,
        planId: p.planId ?? null,
        media: items,
        text: p.text ?? null,
        again: p.again ?? null,
        route: p.route ?? null,
        stamp: {
          placeName: p.stamp.placeName,
          time: p.stamp.time.toISOString(),
          tier: p.stamp.tier,
        },
        counts: { been: place?.been ?? 0, going: place ? (going.get(place._id) ?? 0) : 0 },
        createdAt: p.createdAt.toISOString(),
      };
    }),
  );
}

const SUMMARY_REVIEWS = 20;

/** Re-summarize a place's reviews once the set of live Review posts there changed. */
export const enqueueReviewSummary = (ctx: AppContext, placeId?: string) =>
  placeId
    ? enqueue(ctx, 'summarize_reviews', { placeId }, { dedupeKey: `summary:${placeId}` })
    : Promise.resolve('');

/** Job: the place sheet's two-line summary, from the newest live (moderated) Review posts only. */
export async function summarizeReviews(ctx: AppContext, payload: { placeId: string }) {
  const { db, providers, clock } = ctx;
  const place = await places(db).findOne({ _id: payload.placeId });
  if (!place) return;
  const reviews = await posts(db)
    .find({ placeId: place._id, type: 'review', status: 'live', text: { $exists: true } })
    .sort({ createdAt: -1 })
    .limit(SUMMARY_REVIEWS)
    .toArray();
  if (!reviews.length) {
    await places(db).updateOne({ _id: place._id }, { $unset: { reviewSummary: '' } });
    return;
  }
  const text = await providers.llm.summarizeReviews(
    place.name,
    reviews.map((r) => ({ again: r.again ?? true, text: r.text ?? '' })),
  );
  await places(db).updateOne(
    { _id: place._id },
    { $set: { reviewSummary: { text, count: reviews.length, at: clock.now() } } },
  );
}

/** Captions, review text and images pass a Gemini safety check before a post goes live. */
export async function moderatePost(ctx: AppContext, payload: { postId: string }, job?: JobDoc) {
  const { db, providers, clock } = ctx;
  const p = await posts(db).findOne({ _id: payload.postId });
  if (p?.status !== 'pending') return;
  const docs = await media(db)
    .find({ _id: { $in: p.mediaIds } })
    .toArray();
  // Clips are checked on three frames of the rendition; wait (job retry) until the worker has made it.
  if (docs.some((m) => m.kind === 'video' && !m.rendition)) {
    // Never leave a post pending forever: if the clip could not be processed by the last attempt, reject it.
    if (job && job.attempts >= job.maxAttempts) {
      await posts(db).updateOne(
        { _id: p._id, status: 'pending' },
        { $set: { status: 'rejected', moderationReason: 'clip could not be processed' } },
      );
      return;
    }
    throw new Error('video rendition not ready yet');
  }
  const images: { mimeType: string; data: Buffer }[] = [];
  for (const m of docs) {
    if (images.length >= 3) break;
    if (m.kind === 'video') {
      const clip = await providers.storage.get(m.rendition!.key);
      if (clip)
        for (const f of await videoFrames(clip, 'mp4'))
          images.push({ mimeType: 'image/jpeg', data: f });
    } else if (m.kind === 'photo') {
      const data = await providers.storage.get(m.rendition?.key ?? m.key);
      if (data) images.push({ mimeType: m.rendition ? 'image/jpeg' : m.contentType, data });
    }
  }
  const verdict = await providers.llm.moderate({ text: p.text, images });
  await posts(db).updateOne(
    { _id: p._id, status: 'pending' },
    {
      $set: verdict.allowed
        ? { status: 'live', liveAt: clock.now(), moderationReason: verdict.reason }
        : { status: 'rejected', moderationReason: verdict.reason },
    },
  );
  if (verdict.allowed && p.type === 'review') await enqueueReviewSummary(ctx, p.placeId);
}

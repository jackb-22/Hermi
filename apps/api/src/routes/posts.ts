import { ApiError, fromGeoJSONPoint, newId } from '@itp/shared';
import {
  BlockBody,
  CreatePostBody,
  OkSchema,
  Paged,
  PostSchema,
  PostsListQuery,
  ReportBody,
  ReviewBody,
  ReviewResponse,
} from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Filter } from 'mongodb';
import { z } from 'zod';
import { enqueue } from '../jobs/queue.ts';
import { authed, bearer } from '../plugins/auth.ts';
import { getCheckin, media } from '../services/media.ts';
import { places } from '../services/places.ts';
import { hydratePosts, type PostDoc, posts } from '../services/posts.ts';
import { sessions } from '../services/sessions.ts';
import { blockedIds } from '../services/social.ts';
import { errs } from './_util.ts';

const IdParams = z.object({ id: z.string() });
const PAGE = 24;

export const postRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, tiger, clock } = app.ctx;
  const one = async (p: PostDoc) => (await hydratePosts(app.ctx, [p]))[0]!;

  const publish = async (doc: PostDoc) => {
    await posts(db).insertOne(doc);
    await media(db).updateMany({ _id: { $in: doc.mediaIds } }, { $set: { posted: true } });
    // Clips wait for their rendition; 8 attempts of exponential backoff give the worker several minutes.
    await enqueue(
      app.ctx,
      'moderate_post',
      { postId: doc._id },
      { dedupeKey: `moderate:${doc._id}`, maxAttempts: 8 },
    );
    return one(doc);
  };

  app.post(
    '/posts',
    {
      ...authed,
      schema: {
        tags: ['posts'],
        summary:
          'Post from a recap: route card → Recap, one clip → Clip, photos → Photos. No + button, no camera roll.',
        description:
          'Only verified in-app captures made during your own check-ins. Posting earns 0 XP. The post is pending until the safety check passes.',
        security: bearer,
        body: CreatePostBody,
        response: { 200: PostSchema, ...errs(400, 401, 404, 409) },
      },
    },
    async (req) => {
      const b = req.body;
      const picked = await media(db)
        .find({ _id: { $in: b.mediaIds } })
        .toArray();
      if (picked.length !== b.mediaIds.length || picked.some((m) => m.userId !== req.userId))
        throw new ApiError(404, 'NOT_FOUND', 'Unknown media');
      if (picked.some((m) => m.status !== 'verified'))
        throw new ApiError(
          400,
          'MEDIA_NOT_VERIFIED',
          'Only verified in-app captures can be posted',
        );
      if (picked.some((m) => m.kind === 'audio'))
        throw new ApiError(
          400,
          'BAD_REQUEST',
          'Ambient clips ride along with their photo; do not select them',
        );
      // A capture appears in at most one Clip/Photos/Recap post. Review posts only reference the visit's photo,
      // so reviewing first (on the recap screen) never blocks posting that capture.
      const usedIn = await posts(db).findOne({
        mediaIds: { $in: b.mediaIds },
        type: { $ne: 'review' },
        status: { $in: ['pending', 'live'] },
      });
      if (usedIn) throw new ApiError(409, 'CONFLICT', 'Already posted');
      const ordered = b.mediaIds.map((id) => picked.find((m) => m._id === id)!);
      const now = clock.now();

      if (b.includeRoute) {
        if (!b.sessionId)
          throw new ApiError(400, 'BAD_REQUEST', 'A route card needs the sessionId of the recap');
        const s = await sessions(db).findOne({ _id: b.sessionId, userId: req.userId });
        if (!s?.recap) throw new ApiError(404, 'NOT_FOUND', 'No recap for that session');
        if (s.recap.posted) throw new ApiError(409, 'CONFLICT', 'Recap already posted');
        const stopIds = new Set(s.recap.stops.map((x) => x.checkinId));
        if (ordered.some((m) => !stopIds.has(m.checkinId)))
          throw new ApiError(400, 'BAD_REQUEST', 'Recap media must come from that session');
        const first = s.recap.stops[0];
        if (!first) throw new ApiError(400, 'BAD_REQUEST', 'Nothing was checked in on this outing');
        const placeDocs = new Map(
          (
            await places(db)
              .find({ _id: { $in: s.recap.stops.map((x) => x.placeId) } })
              .toArray()
          ).map((p) => [p._id, p]),
        );
        const firstPlace = placeDocs.get(first.placeId);
        const doc: PostDoc = {
          _id: newId(),
          authorId: req.userId,
          type: 'recap',
          status: 'pending',
          placeId: first.placeId,
          loc: firstPlace?.loc,
          planId: s.planId,
          sessionId: s._id,
          mediaIds: b.mediaIds,
          text: b.caption,
          route: {
            line: s.recap.route,
            stops: s.recap.stops.map((x, i) => ({
              placeId: x.placeId,
              name: x.placeName,
              index: i + 1,
              loc: placeDocs.get(x.placeId)
                ? fromGeoJSONPoint(placeDocs.get(x.placeId)!.loc)
                : s.recap!.route[0]!,
            })),
          },
          stamp: { placeName: first.placeName, time: new Date(first.time), tier: first.tier },
          hiddenFrom: [],
          createdAt: now,
        };
        await sessions(db).updateOne({ _id: s._id }, { $set: { 'recap.posted': true } });
        return publish(doc);
      }

      if (!ordered.length)
        throw new ApiError(400, 'BAD_REQUEST', 'Select a clip or photos to post');
      const videos = ordered.filter((m) => m.kind === 'video');
      if (videos.length && ordered.length > 1)
        throw new ApiError(400, 'BAD_REQUEST', 'A Clip is one video on its own');
      if (new Set(ordered.map((m) => m.placeId)).size > 1)
        throw new ApiError(
          400,
          'BAD_REQUEST',
          'Photos in one post come from one place; include the route card for a multi-stop recap',
        );
      const c = await getCheckin(tiger, ordered[0]!.checkinId);
      const place = await places(db).findOne({ _id: ordered[0]!.placeId });
      return publish({
        _id: newId(),
        authorId: req.userId,
        type: videos.length ? 'clip' : 'photos',
        status: 'pending',
        placeId: ordered[0]!.placeId,
        loc: place?.loc,
        planId: c?.plan_id ?? undefined,
        sessionId: c?.session_id ?? undefined,
        mediaIds: b.mediaIds,
        text: b.caption,
        stamp: {
          placeName: place?.name ?? 'Unknown place',
          time: c?.time ?? ordered[0]!.capturedAt,
          tier: c?.tier ?? 'gps',
        },
        hiddenFrom: [],
        createdAt: now,
      });
    },
  );

  app.post(
    '/reviews',
    {
      ...authed,
      schema: {
        tags: ['posts'],
        summary:
          '"Would go again?" for a checked-in stop; with text it becomes a Review post. Stays unlocked forever.',
        security: bearer,
        body: ReviewBody,
        response: { 200: ReviewResponse, ...errs(400, 401, 404, 409) },
      },
    },
    async (req) => {
      const c = await getCheckin(tiger, req.body.checkinId);
      if (!c || c.user_id !== req.userId) throw new ApiError(404, 'NOT_FOUND', 'No such check-in');
      const reviewId = newId();
      try {
        await db.collection('reviews').insertOne({
          _id: reviewId as never,
          userId: req.userId,
          placeId: c.place_id,
          checkinId: c.id,
          again: req.body.again,
          text: req.body.text,
          tier: c.tier,
          createdAt: clock.now(),
        });
      } catch (e) {
        if ((e as { code?: number }).code === 11000)
          throw new ApiError(409, 'CONFLICT', 'Already reviewed this visit');
        throw e;
      }
      const place = await places(db).findOneAndUpdate(
        { _id: c.place_id },
        { $inc: { 'wouldGoAgain.total': 1, 'wouldGoAgain.yes': req.body.again ? 1 : 0 } },
        { returnDocument: 'after' },
      );
      await sessions(db).updateOne(
        { userId: req.userId, 'recap.stops.checkinId': c.id },
        { $set: { 'recap.stops.$.reviewed': true } },
      );
      let post = null;
      if (req.body.text?.trim()) {
        const photo = await media(db)
          .find({ checkinId: c.id, status: 'verified', kind: 'photo' })
          .sort({ capturedAt: -1 })
          .limit(1)
          .toArray();
        post = await publish({
          _id: newId(),
          authorId: req.userId,
          type: 'review',
          status: 'pending',
          placeId: c.place_id,
          loc: place?.loc,
          planId: c.plan_id ?? undefined,
          mediaIds: photo.map((m) => m._id),
          text: req.body.text.trim(),
          again: req.body.again,
          stamp: { placeName: place?.name ?? 'Unknown place', time: c.time, tier: c.tier },
          hiddenFrom: [],
          createdAt: clock.now(),
        });
      }
      const w = place?.wouldGoAgain;
      return {
        reviewId,
        place: {
          id: c.place_id,
          wouldGoAgainPct: w?.total ? Math.round((100 * w.yes) / w.total) : null,
        },
        post,
      };
    },
  );

  const visible = async (viewerId: string): Promise<Filter<PostDoc>> => {
    const blocked = await blockedIds(db, viewerId);
    return {
      hiddenFrom: { $ne: viewerId },
      authorId: { $nin: blocked },
      $or: [{ status: 'live' }, { authorId: viewerId, status: 'pending' }],
    };
  };

  app.get(
    '/posts/:id',
    {
      ...authed,
      schema: {
        tags: ['posts'],
        security: bearer,
        params: IdParams,
        response: { 200: PostSchema, ...errs(401, 404) },
      },
    },
    async (req) => {
      const p = await posts(db).findOne({
        $and: [{ _id: req.params.id }, await visible(req.userId)],
      });
      if (!p) throw new ApiError(404, 'NOT_FOUND', 'No such post');
      return one(p);
    },
  );

  app.get(
    '/posts',
    {
      ...authed,
      schema: {
        tags: ['posts'],
        summary: "A user's posts, newest first (profile Posts grid). Defaults to yours.",
        security: bearer,
        querystring: PostsListQuery,
        response: { 200: Paged(PostSchema), ...errs(401) },
      },
    },
    async (req) => {
      const mine: Filter<PostDoc> = { authorId: req.query.authorId ?? req.userId };
      if (req.query.cursor) mine.createdAt = { $lt: new Date(req.query.cursor) };
      const q: Filter<PostDoc> = { $and: [mine, await visible(req.userId)] };
      const docs = await posts(db).find(q).sort({ createdAt: -1 }).limit(PAGE).toArray();
      return {
        items: await hydratePosts(app.ctx, docs),
        nextCursor: docs.length === PAGE ? docs.at(-1)!.createdAt.toISOString() : null,
      };
    },
  );

  app.delete(
    '/posts/:id',
    {
      ...authed,
      schema: {
        tags: ['posts'],
        security: bearer,
        params: IdParams,
        response: { 200: OkSchema, ...errs(401, 404) },
      },
    },
    async (req) => {
      const r = await posts(db).updateOne(
        { _id: req.params.id, authorId: req.userId },
        { $set: { status: 'removed' } },
      );
      if (!r.matchedCount) throw new ApiError(404, 'NOT_FOUND', 'No such post');
      return { ok: true as const };
    },
  );

  app.post(
    '/reports',
    {
      ...authed,
      schema: {
        tags: ['safety'],
        summary:
          'Report a post or a user. A reported post disappears for you at once and is queued for review.',
        security: bearer,
        body: ReportBody,
        response: { 200: OkSchema, ...errs(400, 401) },
      },
    },
    async (req) => {
      if (!req.body.postId && !req.body.userId)
        throw new ApiError(400, 'BAD_REQUEST', 'postId or userId required');
      if (req.body.postId)
        await posts(db).updateOne(
          { _id: req.body.postId },
          { $addToSet: { hiddenFrom: req.userId } },
        );
      await db.collection('reports').insertOne({
        _id: newId() as never,
        reporterId: req.userId,
        postId: req.body.postId,
        userId: req.body.userId,
        reason: req.body.reason,
        status: 'open',
        createdAt: clock.now(),
      });
      if (req.body.postId)
        await enqueue(
          app.ctx,
          'review_report',
          { postId: req.body.postId },
          { dedupeKey: `report:${req.body.postId}` },
        );
      return { ok: true as const };
    },
  );

  app.post(
    '/blocks',
    {
      ...authed,
      schema: {
        tags: ['safety'],
        summary: 'Block a user (both directions disappear)',
        security: bearer,
        body: BlockBody,
        response: { 200: OkSchema, ...errs(400, 401) },
      },
    },
    async (req) => {
      if (req.body.userId === req.userId)
        throw new ApiError(400, 'BAD_REQUEST', 'You cannot block yourself');
      await db
        .collection('blocks')
        .updateOne(
          { blocker: req.userId, blocked: req.body.userId },
          { $setOnInsert: { createdAt: clock.now() } },
          { upsert: true },
        );
      return { ok: true as const };
    },
  );

  app.delete(
    '/blocks/:id',
    {
      ...authed,
      schema: { tags: ['safety'], security: bearer, params: IdParams, response: { 200: OkSchema } },
    },
    async (req) => {
      await db.collection('blocks').deleteOne({ blocker: req.userId, blocked: req.params.id });
      return { ok: true as const };
    },
  );
};

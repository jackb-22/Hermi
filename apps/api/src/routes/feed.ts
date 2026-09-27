import { localDayKey } from '@itp/shared';
import { FeedQuery, FeedResponse, OkSchema, SeenBody } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { FEED_DAILY_CAP, feedRank, interleave } from '../domain/feedRank.ts';
import { tasteMatch } from '../domain/taste.ts';
import { authed, bearer } from '../plugins/auth.ts';
import { openPlansFor } from '../services/matching.ts';
import { places } from '../services/places.ts';
import { type PlanDoc, plans, toPlanView } from '../services/plans.ts';
import { hydratePosts, type PostDoc, posts } from '../services/posts.ts';
import { blockedIds, friendIds } from '../services/social.ts';
import { getUser } from '../services/users.ts';
import { errs } from './_util.ts';

const DAY = 86_400_000;
const NEAR_M = 5000;

interface SeenDoc {
  userId: string;
  day: string;
  postIds: string[];
  createdAt: Date;
}

const tier = (p: PostDoc) => (p.placeholder ? 2 : p.mediaIds.length ? 0 : 1);

export const feedRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, config, clock } = app.ctx;
  const seenColl = () => db.collection<SeenDoc>('feed_seen');

  app.get(
    '/feed',
    {
      ...authed,
      schema: {
        tags: ['feed'],
        summary:
          'The finite feed: friends first, then places near you, then taste. At most 30 unseen posts a day, then "You\'re caught up. Go outside."',
        description:
          'Send lat/lng for the "near you" part. Mark posts seen with POST /feed/seen as cards become visible. Not reachable in Action mode (client rule).',
        security: bearer,
        querystring: FeedQuery,
        response: { 200: FeedResponse, ...errs(401) },
      },
    },
    async (req) => {
      const now = clock.now();
      const [me, friends, blocked, seenDocs] = await Promise.all([
        getUser(db, req.userId),
        friendIds(db, req.userId),
        blockedIds(db, req.userId),
        seenColl()
          .find({
            userId: req.userId,
            day: { $in: [0, 1, 2].map((d) => localDayKey(new Date(now.getTime() - d * DAY))) },
          })
          .toArray(),
      ]);
      const seen = new Set(seenDocs.flatMap((d) => d.postIds));
      const seenToday = seenDocs.find((d) => d.day === localDayKey(now))?.postIds.length ?? 0;
      const budget = Math.max(0, FEED_DAILY_CAP - seenToday);
      const friendSet = new Set(friends);
      const base = {
        status: 'live' as const,
        hiddenFrom: { $ne: me._id },
        authorId: { $nin: [me._id, ...blocked] },
        createdAt: { $gte: new Date(now.getTime() - 7 * DAY) },
      };

      // Posts and joinable plans are independent: build both at once.
      const postsP = (async () => {
        // Candidates: friends' posts from the last 7 days plus posts within 5 km.
        const [fromFriends, nearby] = await Promise.all([
          posts(db)
            .find({ ...base, authorId: { $in: friends.filter((f) => !blocked.includes(f)) } })
            .sort({ createdAt: -1 })
            .limit(200)
            .toArray(),
          req.query.lat !== undefined && req.query.lng !== undefined
            ? posts(db)
                .aggregate<PostDoc & { d: number }>([
                  {
                    $geoNear: {
                      near: { type: 'Point', coordinates: [req.query.lng, req.query.lat] },
                      key: 'loc',
                      distanceField: 'd',
                      maxDistance: NEAR_M,
                      query: base,
                    },
                  },
                  { $limit: 300 },
                ])
                .toArray()
            : Promise.resolve([] as (PostDoc & { d: number })[]),
        ]);
        const cands = new Map<string, PostDoc & { d?: number }>();
        for (const p of [...fromFriends, ...nearby])
          if (!seen.has(p._id)) cands.set(p._id, { ...cands.get(p._id), ...p });
        const placeTags = new Map(
          (
            await places(db)
              .find(
                {
                  _id: {
                    $in: [
                      ...new Set(
                        [...cands.values()].flatMap((p) => (p.placeId ? [p.placeId] : [])),
                      ),
                    ],
                  },
                },
                { projection: { tags: 1 } },
              )
              .toArray()
          ).map((p) => [p._id, p.tags]),
        );
        const ranked = [...cands.values()]
          .map((p) => ({
            p,
            score: feedRank({
              friend: friendSet.has(p.authorId),
              taste: tasteMatch(me.prefVector, placeTags.get(p.placeId ?? '') ?? []),
              distanceM: p.d,
              ageH: (now.getTime() - p.createdAt.getTime()) / 3600_000,
            }),
          }))
          // Real photos/clips first (plans are interleaved among them), then text-only posts, then
          // placeholder filler; rank decides within each tier.
          .sort((a, b) => tier(a.p) - tier(b.p) || b.score - a.score)
          .slice(0, budget)
          .map((x) => x.p);
        return { ranked, hydrated: await hydratePosts(app.ctx, ranked) };
      })();
      postsP.catch(() => {}); // awaited below; keeps a failure from going unhandled if the plans part throws first

      // Joinable plans: friends' shared plans (Join) and open plans from students on your campus (Request).
      const planQuery = {
        hostId: { $ne: me._id, $nin: blocked },
        status: { $in: ['planned', 'active'] as PlanDoc['status'][] },
        startAt: {
          $gte: new Date(now.getTime() - 3600_000),
          $lte: new Date(now.getTime() + 7 * DAY),
        },
        'members.userId': { $ne: me._id },
      };
      const [friendPlans, openPlans] = await Promise.all([
        plans(db)
          .find({
            ...planQuery,
            visibility: 'friends',
            hostId: { $in: friends.filter((f) => !blocked.includes(f)) },
          })
          .sort({ startAt: 1 })
          .limit(10)
          .toArray(),
        me.verifiedAt
          ? plans(db)
              .find({ ...planQuery, visibility: 'find' })
              .sort({ startAt: 1 })
              .limit(40)
              .toArray()
              .then(async (list) => (await openPlansFor(app.ctx, me, list)).slice(0, 10))
          : Promise.resolve([] as PlanDoc[]),
      ]);
      const joinable = [
        ...friendPlans.map((p) => ({ p, action: 'join' as const })),
        ...openPlans.map((p) => ({ p, action: 'request' as const })),
      ];

      const [{ ranked, hydrated: postViews }, planViews] = await Promise.all([
        postsP,
        Promise.all(
          joinable.map(async (j) => ({
            plan: await toPlanView(db, config, j.p, me._id, { pref: me.prefVector }),
            action: j.action,
          })),
        ),
      ]);
      const hydrated = new Map(postViews.map((h) => [h.id, h]));
      const cards = interleave(ranked, planViews).map((c) =>
        c.t === 'post'
          ? { kind: 'post' as const, post: hydrated.get(c.v._id)! }
          : { kind: 'plan' as const, plan: c.v.plan, action: c.v.action },
      );
      return {
        cards: [
          ...cards,
          {
            kind: 'end' as const,
            title: "You're caught up. Go outside.",
            action: { label: 'Plan from saved places nearby', type: 'plan_from_saved' as const },
          },
        ],
        unseenLeftToday: budget - ranked.length,
      };
    },
  );

  app.post(
    '/feed/seen',
    {
      ...authed,
      schema: {
        tags: ['feed'],
        summary: 'Mark posts as seen (counts toward the 30-a-day cap)',
        security: bearer,
        body: SeenBody,
        response: { 200: OkSchema, ...errs(401) },
      },
    },
    async (req) => {
      const now = clock.now();
      await seenColl().updateOne(
        { userId: req.userId, day: localDayKey(now) },
        { $addToSet: { postIds: { $each: req.body.postIds } }, $setOnInsert: { createdAt: now } },
        { upsert: true },
      );
      return { ok: true as const };
    },
  );
};

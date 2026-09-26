import { ApiError } from '@itp/shared';
import { FriendsResponse, ProfileSchema, VerifySchema } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { UserDoc } from '../db/types.ts';
import { authed, bearer } from '../plugins/auth.ts';
import { places } from '../services/places.ts';
import { plans } from '../services/plans.ts';
import { posts } from '../services/posts.ts';
import { computeScore, scoreAt } from '../services/score.ts';
import {
  blockedIds,
  friendIds,
  friendships,
  pairKey,
  toStreak,
  toUserCard,
} from '../services/social.ts';
import { studentStatus, users } from '../services/users.ts';
import { verifyInfo } from '../services/verify.ts';
import { errs } from './_util.ts';

export const profileRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, tiger, config, clock } = app.ctx;

  /** Latest check-in per user ("Film Forum · 2h"); ghost mode hides it from everyone but yourself. */
  const lastCheckins = async (userIds: string[], viewerId: string, docs: Map<string, UserDoc>) => {
    const visible = userIds.filter((id) => id === viewerId || !docs.get(id)?.ghostMode);
    if (!visible.length)
      return new Map<string, { placeId: string; placeName: string; at: string }>();
    const { rows } = await tiger.query<{ user_id: string; place_id: string; time: Date }>(
      'select distinct on (user_id) user_id, place_id, time from checkins where user_id = any($1) order by user_id, time desc',
      [visible],
    );
    const names = new Map(
      (
        await places(db)
          .find({ _id: { $in: rows.map((r) => r.place_id) } }, { projection: { name: 1 } })
          .toArray()
      ).map((p) => [p._id, p.name]),
    );
    return new Map(
      rows.map((r) => [
        r.user_id,
        {
          placeId: r.place_id,
          placeName: names.get(r.place_id) ?? 'Somewhere',
          at: r.time.toISOString(),
        },
      ]),
    );
  };

  app.get(
    '/profile/:id',
    {
      ...authed,
      schema: {
        tags: ['profile'],
        summary:
          'Profile header, Score row and counts. Use "me" for yourself. A friend’s profile is the same minus anything private.',
        description:
          'Tiles: GET /tiles?userId. Posts: GET /posts?authorId. Plans: GET /plans?userId. Stats sheet (yours only): GET /stats.',
        security: bearer,
        params: z.object({ id: z.string() }),
        response: { 200: ProfileSchema, ...errs(401, 404) },
      },
    },
    async (req) => {
      const id = req.params.id === 'me' ? req.userId : req.params.id;
      const u = await users(db).findOne({ _id: id, deletedAt: { $exists: false } });
      if (!u || (await blockedIds(db, req.userId)).includes(id))
        throw new ApiError(404, 'NOT_FOUND', 'No such user');
      const now = clock.now();
      const isMe = id === req.userId;
      const [friends, f, score, postCount, planCount, visited, last] = await Promise.all([
        friendIds(db, id),
        isMe ? null : friendships(db).findOne({ _id: pairKey(id, req.userId) }),
        computeScore(app.ctx, u),
        posts(db).countDocuments({ authorId: id, status: 'live' }),
        plans(db).countDocuments({
          $or: [{ hostId: id }, { members: { $elemMatch: { userId: id, status: 'joined' } } }],
          status: { $ne: 'cancelled' },
          ...(isMe ? {} : { visibility: { $in: ['friends', 'find'] } }),
        }),
        tiger.query<{ n: number }>(
          'select count(distinct place_id)::int as n from checkins where user_id = $1',
          [id],
        ),
        lastCheckins([id], req.userId, new Map([[id, u]])),
      ]);
      return {
        user: {
          ...toUserCard(u, config),
          studentStatus: studentStatus(u, now),
          gradYear: u.gradYear ?? null,
        },
        isMe,
        isFriend: !!f,
        friendCount: friends.length,
        streak: f ? toStreak(f, now) : null,
        score,
        lastCheckin: last.get(id) ?? null,
        counts: { posts: postCount, plans: planCount, placesVisited: visited.rows[0]?.n ?? 0 },
      };
    },
  );

  app.get(
    '/friends',
    {
      ...authed,
      schema: {
        tags: ['profile'],
        summary:
          'Friend list: sprite, streak flame, Score and last check-in ("Film Forum · 2h") unless they are in ghost mode',
        security: bearer,
        response: { 200: FriendsResponse, ...errs(401) },
      },
    },
    async (req) => {
      const now = clock.now();
      const fs = await friendships(db)
        .find({ $or: [{ a: req.userId }, { b: req.userId }] })
        .toArray();
      const ids = fs.map((f) => (f.a === req.userId ? f.b : f.a));
      const docs = new Map(
        (
          await users(db)
            .find({ _id: { $in: ids }, deletedAt: { $exists: false } })
            .toArray()
        ).map((u) => [u._id, u]),
      );
      const [scores, last] = await Promise.all([
        scoreAt(tiger, ids, now),
        lastCheckins(ids, req.userId, docs),
      ]);
      const items = fs.flatMap((f) => {
        const other = f.a === req.userId ? f.b : f.a;
        const u = docs.get(other);
        return u
          ? [
              {
                user: toUserCard(u, config),
                streak: toStreak(f, now),
                score: scores.get(other) ?? 0,
                lastCheckin: last.get(other) ?? null,
              },
            ]
          : [];
      });
      items.sort(
        (x, y) =>
          y.streak.weeks - x.streak.weeks ||
          (y.lastCheckin?.at ?? '').localeCompare(x.lastCheckin?.at ?? ''),
      );
      return { items, nextCursor: null };
    },
  );

  app.get(
    '/credentials/:hash',
    {
      schema: {
        tags: ['proof'],
        summary:
          'Verified IRL credential for a posted capture as JSON (public). The shareable HTML page is https://<domain>/verify/:hash',
        params: z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) }),
        response: { 200: VerifySchema, ...errs(404) },
      },
    },
    async (req) => {
      const info = await verifyInfo(app.ctx, req.params.hash);
      if (!info) throw new ApiError(404, 'NOT_FOUND', 'No published capture with that hash');
      return info;
    },
  );
};

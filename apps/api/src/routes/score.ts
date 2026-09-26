import { ApiError, type Tile } from '@itp/shared';
import {
  LeaderboardQuery,
  LeaderboardResponse,
  ScoreSchema,
  StatsResponse,
  TilesResponse,
} from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { UserDoc } from '../db/types.ts';
import { displayStreak } from '../domain/streak.ts';
import { authed, bearer } from '../plugins/auth.ts';
import { boroughStats } from '../services/boroughs.ts';
import { places } from '../services/places.ts';
import { campusScores, daily, expiring, rankOf, scoreAt } from '../services/score.ts';
import { friendIds, friendships, toUserCard } from '../services/social.ts';
import { getUser, users } from '../services/users.ts';
import { errs } from './_util.ts';

const DAY = 86_400_000;

export const scoreRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, tiger, config, clock } = app.ctx;

  const tilesOf = async (userId: string): Promise<Tile[]> =>
    db
      .collection<{ userId: string; x: number; y: number }>('user_tiles')
      .find({ userId }, { projection: { _id: 0, x: 1, y: 1 } })
      .toArray();

  app.get(
    '/score',
    {
      ...authed,
      schema: {
        tags: ['score'],
        summary:
          'Score row: 30-day Score, ▲▼ vs 7 days ago, 30-bar sparkline, what expires next, "#3 among friends · #41 at Columbia"',
        security: bearer,
        querystring: z.object({ userId: z.string().optional() }),
        response: { 200: ScoreSchema, ...errs(401, 404) },
      },
    },
    async (req) => {
      const now = clock.now();
      const u = req.query.userId
        ? await users(db).findOne({ _id: req.query.userId })
        : await getUser(db, req.userId);
      if (!u) throw new ApiError(404, 'NOT_FOUND', 'No such user');
      const friends = await friendIds(db, u._id);
      const circle = [u._id, ...friends];
      const [nowScores, weekAgo, spark] = await Promise.all([
        scoreAt(tiger, circle, now),
        scoreAt(tiger, [u._id], new Date(now.getTime() - 7 * DAY)),
        daily(tiger, u._id, now),
      ]);
      const score = nowScores.get(u._id) ?? 0;
      let campus = null;
      if (u.campus && u.verifiedAt) {
        const rows = await campusScores(tiger, u.campus, now);
        const list = rows.map((r) => ({ id: r.user_id, score: r.xp }));
        if (!list.some((r) => r.id === u._id)) list.push({ id: u._id, score });
        campus = { ...rankOf(list, u._id), campus: u.campus };
      }
      return {
        userId: u._id,
        score,
        delta7d: score - (weekAgo.get(u._id) ?? 0),
        sparkline: spark,
        expiring: expiring(spark),
        ranks: {
          friends: rankOf(
            circle.map((id) => ({ id, score: nowScores.get(id) ?? 0 })),
            u._id,
          ),
          campus,
        },
      };
    },
  );

  app.get(
    '/leaderboard',
    {
      ...authed,
      schema: {
        tags: ['score'],
        summary: 'Leaderboard: Friends and Campus tabs (campus replaces global)',
        security: bearer,
        querystring: LeaderboardQuery,
        response: { 200: LeaderboardResponse, ...errs(401) },
      },
    },
    async (req) => {
      const now = clock.now();
      const me = await getUser(db, req.userId);
      let list: { id: string; score: number }[];
      if (req.query.scope === 'campus') {
        if (!me.campus) return { scope: 'campus' as const, campus: null, items: [], me: null };
        list = (await campusScores(tiger, me.campus, now)).map((r) => ({
          id: r.user_id,
          score: r.xp,
        }));
        if (!list.some((r) => r.id === me._id)) list.push({ id: me._id, score: 0 });
      } else {
        const circle = [me._id, ...(await friendIds(db, me._id))];
        const s = await scoreAt(tiger, circle, now);
        list = circle.map((id) => ({ id, score: s.get(id) ?? 0 }));
      }
      list.sort((a, b) => b.score - a.score);
      const top = list.slice(0, 50);
      const docs = new Map(
        (
          await users(db)
            .find({ _id: { $in: top.map((r) => r.id) } })
            .toArray()
        ).map((u) => [u._id, u]),
      );
      const items = top.flatMap((r) => {
        const u = docs.get(r.id);
        return u
          ? [
              {
                rank: rankOf(list, r.id).rank,
                user: toUserCard(u, config),
                score: r.score,
                isMe: r.id === me._id,
              },
            ]
          : [];
      });
      const mine = list.find((r) => r.id === me._id);
      return {
        scope: req.query.scope,
        campus: me.campus ?? null,
        items,
        me: mine ? { rank: rankOf(list, me._id).rank, score: mine.score } : null,
      };
    },
  );

  app.get(
    '/tiles',
    {
      ...authed,
      schema: {
        tags: ['score'],
        summary: 'Colored-in map: your tiles (or a friend’s), % of Manhattan, per borough',
        security: bearer,
        querystring: z.object({ userId: z.string().optional() }),
        response: { 200: TilesResponse, ...errs(401, 404) },
      },
    },
    async (req) => {
      const who = req.query.userId ?? req.userId;
      if (who !== req.userId && !(await friendIds(db, req.userId)).includes(who))
        throw new ApiError(404, 'NOT_FOUND', 'Only friends can see your map');
      const tiles = await tilesOf(who);
      const boroughs = boroughStats(tiles);
      const xs = tiles.map((t) => t.x);
      const ys = tiles.map((t) => t.y);
      return {
        userId: who,
        zoom: 18 as const,
        tiles: tiles.map(({ x, y }) => ({ x, y })),
        count: tiles.length,
        bounds: tiles.length
          ? {
              minX: Math.min(...xs),
              minY: Math.min(...ys),
              maxX: Math.max(...xs),
              maxY: Math.max(...ys),
            }
          : null,
        manhattanPct: boroughs.find((b) => b.name === 'Manhattan')!.pct,
        boroughs,
      };
    },
  );

  app.get(
    '/stats',
    {
      ...authed,
      schema: {
        tags: ['score'],
        summary: 'Stats sheet (the i on your map). Private: only ever your own.',
        security: bearer,
        response: { 200: StatsResponse, ...errs(401) },
      },
    },
    async (req) => {
      const now = clock.now();
      const me = req.userId;
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [top, move, hours, fr, tiles] = await Promise.all([
        tiger.query<{ place_id: string; n: number }>(
          'select place_id, count(*)::int as n from checkins where user_id = $1 group by place_id order by n desc limit 5',
          [me],
        ),
        tiger.query<{ month: boolean; meters: number; steps: number }>(
          `select day >= $2 as month, sum(meters)::float8 as meters, sum(steps)::int as steps from movement_daily
           where user_id = $1 and mode in ('walk', 'bike') group by 1`,
          [me, monthStart],
        ),
        db
          .collection<{ userId: string; status: string; startedAt: Date; endedAt?: Date }>(
            'sessions',
          )
          .find({ userId: me, status: 'ended' }, { projection: { startedAt: 1, endedAt: 1 } })
          .toArray(),
        friendships(db)
          .find({ $or: [{ a: me }, { b: me }] })
          .sort({ hangouts: -1 })
          .limit(5)
          .toArray(),
        tilesOf(me),
      ]);
      const placeDocs = new Map(
        (
          await places(db)
            .find({ _id: { $in: top.rows.map((r) => r.place_id) } })
            .toArray()
        ).map((p) => [p._id, p]),
      );
      const friendDocs = new Map(
        (
          await users(db)
            .find({ _id: { $in: fr.map((f) => (f.a === me ? f.b : f.a)) } })
            .toArray()
        ).map((u) => [u._id, u as UserDoc]),
      );
      const m = move.rows.find((r) => r.month);
      const all = move.rows.reduce(
        (a, r) => ({ meters: a.meters + r.meters, steps: a.steps + r.steps }),
        { meters: 0, steps: 0 },
      );
      const h = (list: typeof hours) =>
        Math.round(
          list.reduce((a, s) => a + ((s.endedAt?.getTime() ?? 0) - s.startedAt.getTime()), 0) /
            360_000,
        ) / 10;
      return {
        topPlaces: top.rows.map((r) => ({
          placeId: r.place_id,
          name: placeDocs.get(r.place_id)?.name ?? 'Unknown',
          category: placeDocs.get(r.place_id)?.category ?? 'food',
          visits: r.n,
        })),
        peopleMost: fr.flatMap((f) => {
          const u = friendDocs.get(f.a === me ? f.b : f.a);
          return u
            ? [
                {
                  user: toUserCard(u, config),
                  hangouts: f.hangouts,
                  streakWeeks: displayStreak(f, now).weeks,
                },
              ]
            : [];
        }),
        onFoot: {
          monthKm: Math.round((m?.meters ?? 0) / 100) / 10,
          allTimeKm: Math.round(all.meters / 100) / 10,
          monthSteps: m?.steps ?? 0,
          allTimeSteps: all.steps,
        },
        boroughs: boroughStats(tiles),
        hoursOut: { month: h(hours.filter((s) => s.startedAt >= monthStart)), allTime: h(hours) },
      };
    },
  );
};

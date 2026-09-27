import { ApiError, PIN_TYPES, type PinType } from '@itp/shared';
import {
  PlaceDetailSchema,
  PlacesBboxQuery,
  PlacesNearQuery,
  PlacesNearResponse,
  PlacesResponse,
} from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Filter } from 'mongodb';
import { z } from 'zod';
import type { PlaceDoc } from '../db/placeTypes.ts';
import type { UserDoc } from '../db/types.ts';
import { violatesDislikes } from '../domain/taste.ts';
import { bearer, optionalAuth } from '../plugins/auth.ts';
import { placeRank, places, toPlace } from '../services/places.ts';
import { friendIds } from '../services/social.ts';
import { users } from '../services/users.ts';
import { errs } from './_util.ts';

export const NEAR_MIN_RESULTS = 5;
export const NEAR_CAP_M = 1200; // 15-minute walk
export const NEAR_TOP = 10;

/**
 * Which index answers a bbox. Zoomed out, most of a category is on screen, so walking it in rank order stops
 * after the first few dozen (a whole-Manhattan screen examined 24k food places to sort them, now 75). Zoomed
 * in, the few places in view are cheaper to find by location and sort.
 */
const RANK_SCAN_MIN_KM2 = 3;
const RANK_INDEX = { category: 1, been: -1, confidence: -1, loc: '2dsphere' };
const GEO_INDEX = { category: 1, loc: '2dsphere' };
const bboxKm2 = (w: number, s: number, e: number, n: number) =>
  (e - w) * 111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180) * (n - s) * 110.57;

export const placesRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, tiger, clock } = app.ctx;

  const viewer = async (userId: string): Promise<UserDoc | null> =>
    userId ? users(db).findOne({ _id: userId }) : null;
  const ageFilter = (u: UserDoc | null): Filter<PlaceDoc> =>
    u?.is21 ? {} : { adultOnly: { $ne: true } };

  app.get(
    '/places',
    {
      preHandler: optionalAuth,
      schema: {
        tags: ['places'],
        summary: 'Pins for the visible map: top places per category inside a bbox',
        description:
          'Ranked by verified visits and (when signed in) preference match. Bars are hidden unless the user confirmed 21+.',
        security: bearer,
        querystring: PlacesBboxQuery,
        response: { 200: PlacesResponse, ...errs(400) },
      },
    },
    async (req) => {
      const [w, s, e, n] = req.query.bbox.split(',').map(Number) as [
        number,
        number,
        number,
        number,
      ];
      if (w >= e || s >= n)
        throw new ApiError(400, 'BAD_REQUEST', 'bbox must be west,south,east,north');
      const u = await viewer(req.userId);
      const polygon = {
        type: 'Polygon' as const,
        coordinates: [
          [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
            [w, s],
          ],
        ],
      };
      const cats: readonly PinType[] = req.query.cat === 'all' ? PIN_TYPES : [req.query.cat];
      const hint = bboxKm2(w, s, e, n) > RANK_SCAN_MIN_KM2 ? RANK_INDEX : GEO_INDEX;
      const lists = await Promise.all(
        cats.map(async (category) => {
          const found = await places(db)
            .find({ category, loc: { $geoWithin: { $geometry: polygon } }, ...ageFilter(u) })
            .sort({ been: -1, confidence: -1 })
            .limit(req.query.limit * 3)
            .hint(hint)
            .toArray();
          return found
            .map((p) => ({ p, score: placeRank(p, u?.prefVector) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, req.query.limit)
            .map(({ p }) => toPlace(p, { pref: u?.prefVector }));
        }),
      );
      return { items: lists.flat(), nextCursor: null };
    },
  );

  app.get(
    '/places/near',
    {
      preHandler: optionalAuth,
      schema: {
        tags: ['places'],
        summary: 'Places around a dropped pin (radius set by zoom)',
        description: `Returns the top ${NEAR_TOP} by rank, widening the radius in steps until at least ${NEAR_MIN_RESULTS} results or the ${NEAR_CAP_M} m cap.`,
        security: bearer,
        querystring: PlacesNearQuery,
        response: { 200: PlacesNearResponse, ...errs(400) },
      },
    },
    async (req) => {
      const u = await viewer(req.userId);
      const from = { lat: req.query.lat, lng: req.query.lng };
      const query: Filter<PlaceDoc> = { ...ageFilter(u) };
      if (req.query.cat !== 'all') query.category = req.query.cat;
      let radius = Math.min(Math.max(req.query.r ?? 400, 100), NEAR_CAP_M);
      let found: (PlaceDoc & { distanceM: number })[] = [];
      for (;;) {
        found = await places(db)
          .aggregate<PlaceDoc & { distanceM: number }>([
            {
              $geoNear: {
                near: { type: 'Point', coordinates: [from.lng, from.lat] },
                key: 'loc',
                distanceField: 'distanceM',
                maxDistance: radius,
                query,
                spherical: true,
              },
            },
            { $limit: 80 },
          ])
          .toArray();
        found = found.filter((p) => !violatesDislikes(u?.dislikes, p.category, p.tags));
        if (found.length >= NEAR_MIN_RESULTS || radius >= NEAR_CAP_M) break;
        radius = Math.min(NEAR_CAP_M, Math.round(radius * 1.5));
      }
      const items = found
        .map((p) => ({ p, score: placeRank(p, u?.prefVector, p.distanceM) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, NEAR_TOP)
        .map(({ p }) => toPlace(p, { pref: u?.prefVector, distanceM: p.distanceM }));
      return { items, nextCursor: null, radiusM: radius };
    },
  );

  app.get(
    '/places/:id',
    {
      preHandler: optionalAuth,
      schema: {
        tags: ['places'],
        summary: 'Place sheet: details plus the counts line',
        security: bearer,
        params: z.object({ id: z.string() }),
        querystring: z.object({
          lat: z.coerce.number().optional(),
          lng: z.coerce.number().optional(),
        }),
        response: { 200: PlaceDetailSchema, ...errs(404) },
      },
    },
    async (req) => {
      const p = await places(db).findOne({ _id: req.params.id });
      if (!p) throw new ApiError(404, 'NOT_FOUND', 'No such place');
      const u = await viewer(req.userId);
      const now = clock.now();
      const hourAgo = new Date(now.getTime() - 60 * 60_000);
      const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
      const friends = u ? await friendIds(db, u._id) : [];
      const [here, fb, goingPlans] = await Promise.all([
        tiger.query<{ n: number }>(
          'select count(distinct user_id)::int as n from checkins where place_id = $1 and time > $2 and time <= $3',
          [p._id, hourAgo, now],
        ),
        friends.length
          ? tiger.query<{ n: number }>(
              'select count(distinct user_id)::int as n from checkins where place_id = $1 and user_id = any($2)',
              [p._id, friends],
            )
          : Promise.resolve({ rows: [{ n: 0 }] }),
        db
          .collection<{ hostId: string; members?: { userId: string; status: string }[] }>('plans')
          .find({
            'stops.placeId': p._id,
            startAt: { $gte: now, $lte: weekAhead },
            status: { $ne: 'cancelled' },
          })
          .project<{ hostId: string; members?: { userId: string; status: string }[] }>({
            hostId: 1,
            members: 1,
          })
          .toArray(),
      ]);
      const going = new Set<string>();
      for (const plan of goingPlans) {
        going.add(plan.hostId);
        for (const m of plan.members ?? []) if (m.status === 'joined') going.add(m.userId);
      }
      const from =
        req.query.lat !== undefined && req.query.lng !== undefined
          ? { lat: req.query.lat, lng: req.query.lng }
          : undefined;
      return {
        ...toPlace(p, { pref: u?.prefVector, from }),
        hereNow: here.rows[0]?.n ?? 0,
        friendsBeen: fb.rows[0]?.n ?? 0,
        going: going.size,
        hours: p.hours ?? null,
        reviewSummary: null,
      };
    },
  );
};

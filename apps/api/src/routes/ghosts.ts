import { ApiError, fromGeoJSONPoint, newId, type PinType } from '@itp/shared';
import {
  AcceptGhostBody,
  GhostsQuery,
  GhostsResponse,
  OkSchema,
  PlanGhostsQuery,
  PlanSchema,
  SkipGhostsBody,
} from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authed, bearer } from '../plugins/auth.ts';
import { suggestGhosts } from '../services/ghosts.ts';
import { remember } from '../services/memory.ts';
import { places } from '../services/places.ts';
import {
  assertHost,
  getPlan,
  loadPlaces,
  normalizeStops,
  saveAndView,
  toSchedStops,
} from '../services/plans.ts';
import { getUser } from '../services/users.ts';
import { errs } from './_util.ts';

const IdParams = z.object({ id: z.string() });

/** Skipped and accepted ghosts; the planner's memory (B28) learns from these. */
export interface BehaviorEventDoc {
  _id: string;
  userId: string;
  kind: 'ghost_skipped' | 'ghost_accepted';
  placeId: string;
  category?: PinType;
  planId?: string;
  at: Date;
}

export const ghostRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, clock } = app.ctx;
  const behavior = () => db.collection<BehaviorEventDoc>('behavior_events');

  app.get(
    '/ghosts',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary:
          'Ghost pins: up to three suggested next stops after a pin (before or without a plan)',
        description:
          'Best venue per category within a 15-minute walk of the last pin, ranked by pref · time · P(c | prev) · (1 + novelty); ' +
          'Gemini re-ranks the top five and writes the labels. Tap one to add it; ignore them and they fade.',
        security: bearer,
        querystring: GhostsQuery,
        response: { 200: GhostsResponse, ...errs(400, 401, 404) },
      },
    },
    async (req) => {
      const q = req.query;
      const user = await getUser(db, req.userId);
      const after = q.after ? await places(db).findOne({ _id: q.after }) : null;
      if (q.after && !after) throw new ApiError(404, 'NOT_FOUND', 'No such place');
      const anchor = after ? fromGeoJSONPoint(after.loc) : { lat: q.lat!, lng: q.lng! };
      return suggestGhosts(app.ctx, {
        user,
        anchor,
        anchorPlaceId: after?._id,
        prev: after?.category,
        at: q.at ? new Date(q.at) : clock.now(),
        exclude: q.exclude?.split(',').filter(Boolean) ?? [],
        planSoFar: after ? [`${after.name} (${after.category})`] : [],
      });
    },
  );

  app.get(
    '/plans/:id/ghosts',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Ghost pins after a plan stop (the last one by default), timed from its departure',
        security: bearer,
        params: IdParams,
        querystring: PlanGhostsQuery,
        response: { 200: GhostsResponse, ...errs(400, 401, 403, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      assertHost(plan, req.userId);
      const user = await getUser(db, req.userId);
      const byId = await loadPlaces(
        db,
        plan.stops.map((s) => s.placeId),
      );
      const sched = toSchedStops(plan.stops, byId);
      const i = req.query.afterStopId
        ? plan.stops.findIndex((s) => s.id === req.query.afterStopId)
        : plan.stops.length - 1;
      if (req.query.afterStopId && i < 0) throw new ApiError(404, 'NOT_FOUND', 'No such stop');
      if (i < 0 && (req.query.lat === undefined || req.query.lng === undefined))
        throw new ApiError(400, 'BAD_REQUEST', 'The plan has no stops yet; give lat and lng');
      const stop = i >= 0 ? plan.stops[i]! : undefined;
      return suggestGhosts(app.ctx, {
        user,
        anchor: stop ? sched[i]!.loc : { lat: req.query.lat!, lng: req.query.lng! },
        anchorPlaceId: stop?.placeId,
        anchorStopId: stop?.id,
        prev: stop ? sched[i]!.category : undefined,
        at: stop ? stop.departAt : plan.startAt,
        exclude: plan.stops.flatMap((s) => (s.placeId ? [s.placeId] : [])),
        planSoFar: sched.slice(0, i + 1).map((s) => `${s.name} (${s.category})`),
      });
    },
  );

  app.post(
    '/plans/:id/ghosts/accept',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Tap a ghost to make it real: inserts the place right after the stop it followed',
        security: bearer,
        params: IdParams,
        body: AcceptGhostBody,
        response: { 200: PlanSchema, ...errs(400, 401, 403, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      assertHost(plan, req.userId);
      const { placeId, afterStopId } = req.body;
      const at = afterStopId
        ? plan.stops.findIndex((s) => s.id === afterStopId) + 1
        : plan.stops.length;
      if (afterStopId && at === 0) throw new ApiError(404, 'NOT_FOUND', 'No such stop');
      if (plan.stops.length >= 12)
        throw new ApiError(400, 'BAD_REQUEST', 'A plan has at most 12 stops');
      const byId = await loadPlaces(db, [placeId]);
      const [stop] = normalizeStops([{ placeId }], [], plan.mode, byId, clock.now());
      plan.stops.splice(at, 0, stop!);
      // Stop numbers moved, so pending fixes that point at indexes are stale.
      plan.ghostChanges = [];
      await behavior().insertOne({
        _id: newId(),
        userId: req.userId,
        kind: 'ghost_accepted',
        placeId,
        category: byId.get(placeId)?.category,
        planId: plan._id,
        at: clock.now(),
      });
      return saveAndView(app.ctx, plan, req.userId);
    },
  );

  app.post(
    '/ghosts/skip',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary:
          'Optional: report ghosts that faded untapped, so the planner remembers what you pass on',
        security: bearer,
        body: SkipGhostsBody,
        response: { 200: OkSchema, ...errs(400, 401) },
      },
    },
    async (req) => {
      const docs = await places(db)
        .find({ _id: { $in: req.body.placeIds } }, { projection: { category: 1, name: 1 } })
        .toArray();
      if (docs.length)
        await behavior().insertMany(
          docs.map((p) => ({
            _id: newId(),
            userId: req.userId,
            kind: 'ghost_skipped' as const,
            placeId: p._id,
            category: p.category,
            planId: req.body.planId,
            at: clock.now(),
          })),
        );
      if (docs.length)
        await remember(
          app.ctx,
          req.userId,
          `Passed on suggested next stops: ${docs.map((p) => `${p.name} (${p.category})`).join(', ')}`,
          'ghost_skip',
        );
      return { ok: true as const };
    },
  );
};

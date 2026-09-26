import { randomBytes } from 'node:crypto';
import { ApiError, fromGeoJSONPoint, haversineM, newId } from '@itp/shared';
import {
  ApplyChangesBody,
  CreatePlanBody,
  FromSavedBody,
  OkSchema,
  Paged,
  PatchPlanBody,
  PlanSchema,
  PlansListQuery,
  PutStopsBody,
} from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Filter } from 'mongodb';
import { z } from 'zod';
import { authed, bearer } from '../plugins/auth.ts';
import { places } from '../services/places.ts';
import {
  assertHost,
  defaultName,
  getPlan,
  loadPlaces,
  nextQuarterHour,
  normalizeStops,
  type PlanDoc,
  plans,
  saveAndView as savePlanAndView,
  toPlanView,
} from '../services/plans.ts';
import { applyGhostChange, schedulePlan } from '../services/scheduler.ts';
import { friendIds } from '../services/social.ts';
import { getUser } from '../services/users.ts';
import { errs } from './_util.ts';

const IdParams = z.object({ id: z.string() });

export const planRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, config, clock } = app.ctx;

  /** Host and anyone on the member list; friends of the host for friends-visible plans; anyone for open (find) plans. */
  const assertCanView = async (plan: PlanDoc, userId: string) => {
    if (plan.hostId === userId || plan.members.some((m) => m.userId === userId)) return;
    if (plan.visibility === 'find') return;
    if (plan.visibility === 'friends' && (await friendIds(db, plan.hostId)).includes(userId))
      return;
    throw new ApiError(404, 'NOT_FOUND', 'No such plan');
  };

  const view = async (plan: PlanDoc, userId: string) => {
    const me = await getUser(db, userId);
    return toPlanView(db, config, plan, userId, { pref: me.prefVector });
  };

  const saveAndView = (plan: PlanDoc, userId: string) => savePlanAndView(app.ctx, plan, userId);

  app.post(
    '/plans',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary:
          'Create a plan (draft) from dropped pins; it is scheduled immediately with default stays and estimated legs',
        security: bearer,
        body: CreatePlanBody,
        response: { 200: PlanSchema, ...errs(400, 401) },
      },
    },
    async (req) => {
      const now = clock.now();
      const byId = await loadPlaces(
        db,
        req.body.stops.map((s) => s.placeId),
      );
      const plan: PlanDoc = {
        _id: newId(),
        hostId: req.userId,
        name: req.body.name ?? 'New plan',
        nameIsDefault: !req.body.name,
        startAt: req.body.startAt ? new Date(req.body.startAt) : nextQuarterHour(now),
        endBy: req.body.endBy ? new Date(req.body.endBy) : undefined,
        mode: req.body.mode,
        visibility: 'just_me',
        status: 'draft',
        stops: normalizeStops(req.body.stops, [], req.body.mode, byId, now),
        members: [],
        ghostChanges: [],
        shareToken: randomBytes(9).toString('base64url'),
        createdAt: now,
        updatedAt: now,
      };
      return saveAndView(plan, req.userId);
    },
  );

  app.get(
    '/plans',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Plans you host or joined (profile Plans tab)',
        security: bearer,
        querystring: PlansListQuery,
        response: { 200: Paged(PlanSchema), ...errs(401) },
      },
    },
    async (req) => {
      const who = req.query.userId ?? req.userId;
      const mine = who === req.userId;
      const q: Filter<PlanDoc> = {
        $or: [{ hostId: who }, { members: { $elemMatch: { userId: who, status: 'joined' } } }],
        status: { $ne: 'cancelled' },
      };
      if (!mine) q.visibility = { $in: ['friends', 'find'] };
      const now = clock.now();
      if (req.query.scope === 'drafts') q.status = 'draft';
      if (req.query.scope === 'completed') q.status = 'completed';
      if (req.query.scope === 'upcoming')
        Object.assign(q, {
          status: { $in: ['planned', 'active'] },
          startAt: { $gte: new Date(now.getTime() - 12 * 3600_000) },
        });
      const docs = await plans(db).find(q).sort({ startAt: -1 }).limit(50).toArray();
      const me = await getUser(db, req.userId);
      const items = await Promise.all(
        docs.map((p) => toPlanView(db, config, p, req.userId, { pref: me.prefVector })),
      );
      return { items, nextCursor: null };
    },
  );

  app.get(
    '/plans/:id',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        security: bearer,
        params: IdParams,
        response: { 200: PlanSchema, ...errs(401, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      await assertCanView(plan, req.userId);
      return view(plan, req.userId);
    },
  );

  app.patch(
    '/plans/:id',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Edit name, start/end time or plan mode (mode resets every leg)',
        security: bearer,
        params: IdParams,
        body: PatchPlanBody,
        response: { 200: PlanSchema, ...errs(400, 401, 403, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      assertHost(plan, req.userId);
      const b = req.body;
      if (b.name) Object.assign(plan, { name: b.name, nameIsDefault: false });
      if (b.startAt) plan.startAt = new Date(b.startAt);
      if (b.endBy !== undefined) plan.endBy = b.endBy ? new Date(b.endBy) : undefined;
      if (b.mode) {
        plan.mode = b.mode;
        for (const s of plan.stops) s.legMode = b.mode;
      }
      return saveAndView(plan, req.userId);
    },
  );

  app.put(
    '/plans/:id/stops',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary:
          'Replace the ordered stop list (drop, fill, reorder, delete, per-leg mode); times recompute instantly',
        security: bearer,
        params: IdParams,
        body: PutStopsBody,
        response: { 200: PlanSchema, ...errs(400, 401, 403, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      assertHost(plan, req.userId);
      const byId = await loadPlaces(
        db,
        req.body.stops.map((s) => s.placeId),
      );
      plan.stops = normalizeStops(req.body.stops, plan.stops, plan.mode, byId, clock.now());
      plan.ghostChanges = [];
      return saveAndView(plan, req.userId);
    },
  );

  app.delete(
    '/plans/:id',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        security: bearer,
        params: IdParams,
        response: { 200: OkSchema, ...errs(401, 403, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      assertHost(plan, req.userId);
      await plans(db).updateOne(
        { _id: plan._id },
        { $set: { status: 'cancelled', updatedAt: clock.now() } },
      );
      return { ok: true as const };
    },
  );

  app.post(
    '/plans/:id/schedule',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'AI button (tap): schedule it',
        description:
          'Legs from Apple Maps ETAs (Google fallback), opening hours from Google Places, stay lengths from Gemini (5–240 min), ' +
          'then code assembles and validates. Failing rows come back in issues[] with one proposed fix in ghostChanges[].',
        security: bearer,
        params: IdParams,
        response: { 200: PlanSchema, ...errs(401, 403, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      assertHost(plan, req.userId);
      const { issues, byId } = await schedulePlan(app.ctx, plan);
      if (plan.nameIsDefault) plan.name = defaultName(plan.stops, byId);
      plan.updatedAt = clock.now();
      await plans(db).replaceOne({ _id: plan._id }, plan);
      const me = await getUser(db, req.userId);
      return toPlanView(db, config, plan, req.userId, { byId, issues, pref: me.prefVector });
    },
  );

  app.post(
    '/plans/:id/changes/apply',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Accept ghost changes: all of them, or the listed ids one at a time',
        security: bearer,
        params: IdParams,
        body: ApplyChangesBody,
        response: { 200: PlanSchema, ...errs(400, 401, 403, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      assertHost(plan, req.userId);
      const ids = req.body.ids ?? plan.ghostChanges.map((g) => g.id);
      for (const id of ids) {
        const g = plan.ghostChanges.find((x) => x.id === id);
        if (!g) throw new ApiError(400, 'BAD_REQUEST', `No pending change ${id}`);
        await applyGhostChange(app.ctx, plan, g);
      }
      plan.ghostChanges = plan.ghostChanges.filter((g) => !ids.includes(g.id));
      return saveAndView(plan, req.userId);
    },
  );

  app.post(
    '/plans/:id/changes/dismiss',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Dismiss ghost changes (all, or the listed ids)',
        security: bearer,
        params: IdParams,
        body: ApplyChangesBody,
        response: { 200: PlanSchema, ...errs(401, 403, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      assertHost(plan, req.userId);
      const ids = req.body.ids;
      plan.ghostChanges = ids ? plan.ghostChanges.filter((g) => !ids.includes(g.id)) : [];
      return saveAndView(plan, req.userId);
    },
  );

  app.post(
    '/plans/from-saved',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary:
          'The feed end card button: builds a plan from your saved places nearby and schedules it',
        description:
          'Up to 4 saved places within 1.5 km, in nearest-neighbour walking order, through the same AI scheduling as any plan.',
        security: bearer,
        body: FromSavedBody,
        response: { 200: PlanSchema, ...errs(401, 404) },
      },
    },
    async (req) => {
      const saved = await db
        .collection<{ userId: string; type: string; refId: string }>('saves')
        .find({ userId: req.userId, type: 'place' })
        .toArray();
      const near = await places(db)
        .find({
          _id: { $in: saved.map((s) => s.refId) },
          loc: {
            $nearSphere: {
              $geometry: { type: 'Point', coordinates: [req.body.lng, req.body.lat] },
              $maxDistance: 1500,
            },
          },
        })
        .limit(12)
        .toArray();
      if (!near.length)
        throw new ApiError(
          404,
          'NOT_FOUND',
          'No saved places nearby; save a few from the map or feed first',
        );
      // Nearest-neighbour order from where you are.
      const order: typeof near = [];
      let here = { lat: req.body.lat, lng: req.body.lng };
      const left = [...near];
      while (left.length && order.length < 4) {
        left.sort(
          (a, b) =>
            haversineM(here, fromGeoJSONPoint(a.loc)) - haversineM(here, fromGeoJSONPoint(b.loc)),
        );
        const next = left.shift()!;
        order.push(next);
        here = fromGeoJSONPoint(next.loc);
      }
      const now = clock.now();
      const byId = await loadPlaces(
        db,
        order.map((p) => p._id),
      );
      const plan: PlanDoc = {
        _id: newId(),
        hostId: req.userId,
        name: 'New plan',
        nameIsDefault: true,
        startAt: req.body.startAt ? new Date(req.body.startAt) : nextQuarterHour(now),
        mode: 'walk',
        visibility: 'just_me',
        status: 'draft',
        stops: normalizeStops(
          order.map((p) => ({ placeId: p._id })),
          [],
          'walk',
          byId,
          now,
        ),
        members: [],
        ghostChanges: [],
        shareToken: randomBytes(9).toString('base64url'),
        createdAt: now,
        updatedAt: now,
      };
      const { issues } = await schedulePlan(app.ctx, plan);
      plan.name = defaultName(plan.stops, byId);
      await plans(db).insertOne(plan);
      const me = await getUser(db, req.userId);
      return toPlanView(db, config, plan, req.userId, { issues, pref: me.prefVector });
    },
  );
};

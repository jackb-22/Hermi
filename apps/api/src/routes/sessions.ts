import { ApiError, newId } from '@itp/shared';
import { ActiveSessionResponse, PointsBody, PointsResponse, StartSessionBody, StartSessionResponse } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { filterTrace } from '../domain/plausibility.ts';
import { authed, bearer } from '../plugins/auth.ts';
import { getPlan, isMember, loadPlaces, plans, toPlanView } from '../services/plans.ts';
import { type SessionDoc, activeSession, geofences, getOwnSession, insertPoints, sessions, toSession } from '../services/sessions.ts';
import { errs } from './_util.ts';

export const sessionRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, tiger, config, clock } = app.ctx;

  app.post(
    '/sessions',
    {
      ...authed,
      schema: {
        tags: ['action'],
        summary: 'Start (Action mode) from a plan, or Head out without one',
        description: 'Idempotent: if a session for the same plan is already active it is returned. Starting a different one leaves the old one to be ended by the client.',
        security: bearer,
        body: StartSessionBody,
        response: { 200: StartSessionResponse, ...errs(400, 401, 404, 409) },
      },
    },
    async (req) => {
      const planId = req.body.planId;
      const plan = planId ? await getPlan(db, planId) : null;
      if (plan && !isMember(plan, req.userId)) throw new ApiError(404, 'NOT_FOUND', 'No such plan');
      const existing = await activeSession(db, req.userId);
      let s: SessionDoc;
      if (existing && existing.planId === planId) s = existing;
      else if (existing) throw new ApiError(409, 'CONFLICT', 'Another session is active; end it first', { sessionId: existing._id });
      else {
        s = { _id: newId(), userId: req.userId, planId, kind: plan ? 'plan' : 'headout', status: 'active', startedAt: clock.now(), pointsAccepted: 0, pointsRejected: 0 };
        await sessions(db).insertOne(s);
        if (plan && plan.status !== 'completed') await plans(db).updateOne({ _id: plan._id }, { $set: { status: 'active', updatedAt: clock.now() } });
      }
      if (!plan) return { session: toSession(s), geofences: [], plan: null };
      const byId = await loadPlaces(db, plan.stops.map((x) => x.placeId));
      const fresh = await getPlan(db, plan._id);
      return { session: toSession(s), geofences: geofences(fresh, byId), plan: await toPlanView(db, config, fresh, req.userId, { byId }) };
    },
  );

  app.get(
    '/sessions/active',
    { ...authed, schema: { tags: ['action'], summary: 'Resume Action mode after an app restart', security: bearer, response: { 200: ActiveSessionResponse } } },
    async (req) => {
      const s = await activeSession(db, req.userId);
      return { session: s ? toSession(s) : null };
    },
  );

  app.post(
    '/sessions/:id/points',
    {
      ...authed,
      schema: {
        tags: ['action'],
        summary: 'Upload a batch of background location points',
        description: 'Points with accuracy worse than 100 m, jumps above 200 km/h, out-of-order or future timestamps are dropped and counted.',
        security: bearer,
        params: z.object({ id: z.string() }),
        body: PointsBody,
        response: { 200: PointsResponse, ...errs(400, 401, 404, 409) },
      },
    },
    async (req) => {
      const s = await getOwnSession(db, req.params.id, req.userId);
      if (s.status !== 'active') throw new ApiError(409, 'SESSION_NOT_ACTIVE', 'Session has ended');
      const pts = req.body.points.map((p) => ({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed, time: new Date(p.time) }));
      const { accepted, rejected, last } = filterTrace(pts, s.lastPoint, clock.now());
      await insertPoints(tiger, req.userId, s._id, accepted);
      const nRejected = Object.values(rejected).reduce((a, b) => a + b, 0);
      await sessions(db).updateOne({ _id: s._id }, { $set: { lastPoint: last }, $inc: { pointsAccepted: accepted.length, pointsRejected: nRejected } });
      return { accepted: accepted.length, rejected };
    },
  );
};

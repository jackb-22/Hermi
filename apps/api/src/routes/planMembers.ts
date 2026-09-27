import { ApiError, newId } from '@itp/shared';
import {
  InviteBody,
  JoinBody,
  NameSuggestionResponse,
  PlanSchema,
  SavePlanBody,
} from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authed, bearer } from '../plugins/auth.ts';
import { openPlansFor } from '../services/matching.ts';
import { notify } from '../services/notify.ts';
import {
  assertHost,
  enqueueMatch,
  getPlan,
  loadPlaces,
  type MemberStatus,
  type PlanDoc,
  plans,
  toPlanView,
} from '../services/plans.ts';
import { blockedIds, friendIds } from '../services/social.ts';
import { getUser } from '../services/users.ts';
import { errs } from './_util.ts';

const IdParams = z.object({ id: z.string() });

export const planMemberRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, config, clock, providers } = app.ctx;

  const view = async (plan: PlanDoc, userId: string) => {
    const me = await getUser(db, userId);
    return toPlanView(db, config, (await plans(db).findOne({ _id: plan._id }))!, userId, {
      pref: me.prefVector,
    });
  };
  const memberStatus = (p: PlanDoc, userId: string) =>
    p.members.find((m) => m.userId === userId)?.status;
  const setMember = async (planId: string, userId: string, status: MemberStatus) => {
    const now = clock.now();
    const r = await plans(db).updateOne(
      { _id: planId, 'members.userId': userId },
      { $set: { 'members.$.status': status, 'members.$.at': now, updatedAt: now } },
    );
    if (!r.matchedCount)
      await plans(db).updateOne(
        { _id: planId },
        { $push: { members: { userId, status, at: now } }, $set: { updatedAt: now } },
      );
  };
  const suggestName = async (plan: PlanDoc) => {
    const byId = await loadPlaces(
      db,
      plan.stops.map((s) => s.placeId),
    );
    return providers.llm.planName(
      plan.stops.flatMap((s) =>
        s.placeId && byId.get(s.placeId) ? [byId.get(s.placeId)!.name] : [],
      ),
    );
  };
  const onlyFriends = async (hostId: string, ids: string[]) => {
    const friends = new Set(await friendIds(db, hostId));
    const bad = ids.filter((id) => !friends.has(id));
    if (bad.length)
      throw new ApiError(
        400,
        'BAD_REQUEST',
        'You can only invite friends; everyone else joins by link or through Find someone',
        { notFriends: bad },
      );
  };

  app.get(
    '/plans/:id/name-suggestion',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Name prefilled by Gemini from the stops (Save sheet)',
        security: bearer,
        params: IdParams,
        response: { 200: NameSuggestionResponse, ...errs(403, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      assertHost(plan, req.userId);
      return { name: await suggestName(plan) };
    },
  );

  app.post(
    '/plans/:id/save',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Save: decide who comes (Just me · Invite friends · All friends · Find someone)',
        description:
          'Moves the draft to planned. Invitees get a push and see Join / Can’t. When everyone who joined checks in together at one stop, all of them get the full-party bonus.',
        security: bearer,
        params: IdParams,
        body: SavePlanBody,
        response: { 200: PlanSchema, ...errs(400, 401, 403, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      assertHost(plan, req.userId);
      await onlyFriends(req.userId, req.body.inviteeIds);
      if (req.body.visibility === 'find') {
        const me = await getUser(db, req.userId);
        if (!me.verifiedAt)
          throw new ApiError(
            403,
            'FORBIDDEN',
            'Find someone is for verified students; verify your school email first',
          );
      }
      const name = req.body.name ?? (plan.nameIsDefault ? await suggestName(plan) : plan.name);
      await plans(db).updateOne(
        { _id: plan._id },
        {
          $set: {
            name,
            nameIsDefault: false,
            visibility: req.body.visibility,
            status: plan.status === 'draft' ? 'planned' : plan.status,
            updatedAt: clock.now(),
          },
        },
      );
      for (const id of req.body.inviteeIds)
        if (!memberStatus(plan, id)) await setMember(plan._id, id, 'invited');
      // Find someone: match verified students now and push the ones who fit ("!" on their map).
      if (req.body.visibility === 'find') await enqueueMatch(app.ctx, plan._id);
      await db
        .collection('saves')
        .updateOne(
          { userId: req.userId, type: 'plan', refId: plan._id },
          { $setOnInsert: { _id: newId() as never, createdAt: clock.now() } },
          { upsert: true },
        );
      const host = await getUser(db, req.userId);
      await notify(app.ctx, req.body.inviteeIds, {
        title: `${host.name ?? 'A friend'} invited you`,
        body: name,
        data: { kind: 'plan_invite', planId: plan._id },
      });
      return view(plan, req.userId);
    },
  );

  app.post(
    '/plans/:id/invite',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Invite more friends',
        security: bearer,
        params: IdParams,
        body: InviteBody,
        response: { 200: PlanSchema, ...errs(400, 403, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      assertHost(plan, req.userId);
      await onlyFriends(req.userId, req.body.userIds);
      const fresh = req.body.userIds.filter((id) => !memberStatus(plan, id));
      for (const id of fresh) await setMember(plan._id, id, 'invited');
      const host = await getUser(db, req.userId);
      await notify(app.ctx, fresh, {
        title: `${host.name ?? 'A friend'} invited you`,
        body: plan.name,
        data: { kind: 'plan_invite', planId: plan._id },
      });
      return view(plan, req.userId);
    },
  );

  app.post(
    '/plans/:id/join',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Join: invited, a friend’s friends-visible plan, or holding the share link',
        security: bearer,
        params: IdParams,
        body: JoinBody,
        response: { 200: PlanSchema, ...errs(401, 403, 404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      if (plan.hostId === req.userId) return view(plan, req.userId);
      if ((await blockedIds(db, req.userId)).includes(plan.hostId))
        throw new ApiError(404, 'NOT_FOUND', 'No such plan');
      const invited =
        memberStatus(plan, req.userId) === 'invited' ||
        memberStatus(plan, req.userId) === 'declined';
      const friendsPlan =
        plan.visibility === 'friends' && (await friendIds(db, plan.hostId)).includes(req.userId);
      // The share link is also the "send a friend before meeting a stranger" safety link, and open (find) plans are
      // visible to any verified student, so a token never skips the host's approval on a find plan.
      const byLink =
        plan.visibility !== 'find' && !!req.body.token && req.body.token === plan.shareToken;
      if (!invited && !friendsPlan && !byLink) {
        throw new ApiError(
          403,
          'FORBIDDEN',
          plan.visibility === 'find'
            ? 'Open plans need the host’s approval: send a request'
            : 'You were not invited to this plan',
        );
      }
      await setMember(plan._id, req.userId, 'joined');
      const me = await getUser(db, req.userId);
      await notify(app.ctx, [plan.hostId], {
        title: `${me.name ?? 'Someone'} is in`,
        body: plan.name,
        data: { kind: 'plan_join', planId: plan._id },
      });
      return view(plan, req.userId);
    },
  );

  app.post(
    '/plans/:id/decline',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Can’t (or leave a plan you joined)',
        security: bearer,
        params: IdParams,
        response: { 200: PlanSchema, ...errs(404) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      if (!memberStatus(plan, req.userId))
        throw new ApiError(404, 'NOT_FOUND', 'You are not on this plan');
      await setMember(plan._id, req.userId, 'declined');
      return view(plan, req.userId);
    },
  );

  app.post(
    '/plans/:id/request',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Request to join an open (Find someone) plan; the host approves each request',
        description:
          'Verified students only; public venues only; no DMs: coordination happens in the plan view.',
        security: bearer,
        params: IdParams,
        response: { 200: PlanSchema, ...errs(403, 404, 409) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      if (plan.visibility !== 'find' || (await blockedIds(db, req.userId)).includes(plan.hostId))
        throw new ApiError(404, 'NOT_FOUND', 'No such open plan');
      const me = await getUser(db, req.userId);
      if (!me.verifiedAt)
        throw new ApiError(403, 'FORBIDDEN', 'Verify your school email to join open plans');
      if (memberStatus(plan, req.userId))
        throw new ApiError(409, 'CONFLICT', 'Already requested or on this plan');
      if (!(await openPlansFor(app.ctx, me, [plan])).length)
        throw new ApiError(
          403,
          'FORBIDDEN',
          'This open plan is for matched students (Open to plans on, nearby, free then)',
        );
      await setMember(plan._id, req.userId, 'requested');
      await notify(app.ctx, [plan.hostId], {
        title: `${me.name ?? 'A student'} wants to join`,
        body: plan.name,
        data: { kind: 'plan_request', planId: plan._id, userId: me._id },
      });
      return view(plan, req.userId);
    },
  );

  for (const [verb, status] of [
    ['approve', 'joined'],
    ['deny', 'declined'],
  ] as const) {
    app.post(
      `/plans/:id/requests/:userId/${verb}`,
      {
        ...authed,
        schema: {
          tags: ['plans'],
          summary: `Host: ${verb} a join request`,
          security: bearer,
          params: z.object({ id: z.string(), userId: z.string() }),
          response: { 200: PlanSchema, ...errs(403, 404) },
        },
      },
      async (req) => {
        const plan = await getPlan(db, req.params.id);
        assertHost(plan, req.userId);
        if (memberStatus(plan, req.params.userId) !== 'requested')
          throw new ApiError(404, 'NOT_FOUND', 'No pending request from that user');
        await setMember(plan._id, req.params.userId, status);
        if (status === 'joined')
          await notify(app.ctx, [req.params.userId], {
            title: 'You’re in',
            body: plan.name,
            data: { kind: 'plan_approved', planId: plan._id },
          });
        return view(plan, req.userId);
      },
    );
  }

  app.get(
    '/plans/by-token/:token',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'Open a shared plan link (/p/:token) in the app',
        security: bearer,
        params: z.object({ token: z.string() }),
        response: { 200: PlanSchema, ...errs(404) },
      },
    },
    async (req) => {
      const plan = await plans(db).findOne({
        shareToken: req.params.token,
        status: { $ne: 'cancelled' },
      });
      if (!plan) throw new ApiError(404, 'NOT_FOUND', 'Link expired');
      return view(plan, req.userId);
    },
  );
};

import { fromGeoJSONPoint } from '@itp/shared';
import { SocialQuery, SocialResponse } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authed, bearer } from '../plugins/auth.ts';
import { places } from '../services/places.ts';
import { type PlanDoc, plans, toPlanView } from '../services/plans.ts';
import { blockedIds, friendIds, toUserCard } from '../services/social.ts';
import { getUser, users } from '../services/users.ts';
import { errs } from './_util.ts';

const OUT_WINDOW_MS = 3 * 3600_000;

export const socialMapRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, tiger, config, clock } = app.ctx;

  app.get(
    '/social',
    {
      ...authed,
      schema: {
        tags: ['social'],
        summary:
          'Social mode layer: friends checked in within 3 h, friends’ shared plans, open "!" plans. Poll every 30 s while the map is open.',
        description:
          'Nothing here is live location: check-ins are deliberate acts, so sharing is consent by design. Ghost mode hides your check-ins.',
        security: bearer,
        querystring: SocialQuery,
        response: { 200: SocialResponse, ...errs(401) },
      },
    },
    async (req) => {
      const now = clock.now();
      const me = await getUser(db, req.userId);
      const [friends, blocked] = await Promise.all([friendIds(db, me._id), blockedIds(db, me._id)]);
      const box = req.query.bbox?.split(',').map(Number) as
        | [number, number, number, number]
        | undefined;
      const inBox = (p: { lat: number; lng: number }) =>
        !box || (p.lng >= box[0] && p.lat >= box[1] && p.lng <= box[2] && p.lat <= box[3]);

      // Friends out right now (last check-in within 3 h), unless they are in ghost mode.
      const visibleFriends = (
        await users(db)
          .find({ _id: { $in: friends }, ghostMode: { $ne: true }, deletedAt: { $exists: false } })
          .toArray()
      ).filter((u) => !blocked.includes(u._id));
      const { rows } = visibleFriends.length
        ? await tiger.query<{
            user_id: string;
            place_id: string;
            time: Date;
            plan_id: string | null;
          }>(
            `select distinct on (user_id) user_id, place_id, time, plan_id from checkins
             where user_id = any($1) and time > $2 and time <= $3 order by user_id, time desc`,
            [visibleFriends.map((u) => u._id), new Date(now.getTime() - OUT_WINDOW_MS), now],
          )
        : { rows: [] };
      const placeDocs = new Map(
        (
          await places(db)
            .find({ _id: { $in: rows.map((r) => r.place_id) } })
            .toArray()
        ).map((p) => [p._id, p]),
      );
      const byUser = new Map(visibleFriends.map((u) => [u._id, u]));
      const friendsOut = rows.flatMap((r) => {
        const p = placeDocs.get(r.place_id);
        const u = byUser.get(r.user_id);
        if (!p || !u || !inBox(fromGeoJSONPoint(p.loc))) return [];
        return [
          {
            user: toUserCard(u, config),
            place: { id: p._id, name: p.name, loc: fromGeoJSONPoint(p.loc) },
            at: r.time.toISOString(),
            planId: r.plan_id,
          },
        ];
      });

      // Upcoming plans: friends' shared plans (or ones I am invited to) and open plans from verified students.
      const upcoming = {
        status: { $in: ['planned', 'active'] as PlanDoc['status'][] },
        startAt: {
          $gte: new Date(now.getTime() - OUT_WINDOW_MS),
          $lte: new Date(now.getTime() + 7 * 86_400_000),
        },
        hostId: { $nin: [me._id, ...blocked] },
      };
      const [shared, open] = await Promise.all([
        plans(db)
          .find({
            ...upcoming,
            $or: [
              { visibility: 'friends', hostId: { $in: friends } },
              { 'members.userId': me._id },
            ],
          })
          .sort({ startAt: 1 })
          .limit(20)
          .toArray(),
        me.verifiedAt
          ? plans(db)
              .find({ ...upcoming, visibility: 'find' })
              .sort({ startAt: 1 })
              .limit(20)
              .toArray()
          : Promise.resolve([] as PlanDoc[]),
      ]);
      const status = (p: PlanDoc) => p.members.find((m) => m.userId === me._id)?.status;
      const views = async (list: PlanDoc[]) =>
        Promise.all(list.map((p) => toPlanView(db, config, p, me._id, { pref: me.prefVector })));
      const sharedViews = (await views(shared.filter((p) => status(p) !== 'declined'))).filter(
        (v) =>
          v.stops.some((s) => inBox(s.place?.loc ?? s.slot?.near ?? { lat: 0, lng: 0 })) || !box,
      );
      const openViews = (
        await views(
          open.filter((p) => !shared.some((s) => s._id === p._id) && status(p) !== 'declined'),
        )
      ).filter((v) => v.stops.some((s) => inBox(s.place?.loc ?? { lat: 0, lng: 0 })) || !box);
      return {
        friendsOut,
        friendPlans: sharedViews.map((plan) => {
          const st = status(shared.find((p) => p._id === plan.id)!);
          return {
            plan,
            action:
              st === 'joined'
                ? ('joined' as const)
                : st === 'invited'
                  ? ('invited' as const)
                  : ('join' as const),
          };
        }),
        openPlans: openViews.map((plan) => ({
          plan,
          action:
            status(open.find((p) => p._id === plan.id)!) === 'requested'
              ? ('requested' as const)
              : ('request' as const),
        })),
        refreshAfterS: 30 as const,
      };
    },
  );
};

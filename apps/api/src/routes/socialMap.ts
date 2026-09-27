import { fromGeoJSONPoint } from '@itp/shared';
import { SocialQuery, SocialResponse } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authed, bearer } from '../plugins/auth.ts';
import { openPlansFor } from '../services/matching.ts';
import { places } from '../services/places.ts';
import { loadPlaces, type PlanDoc, plans, toPlanView } from '../services/plans.ts';
import { sessions } from '../services/sessions.ts';
import { blockedIds, friendIds, toUserCard } from '../services/social.ts';
import { getUser, users } from '../services/users.ts';
import { errs } from './_util.ts';

const OUT_WINDOW_MS = 3 * 3600_000;
/** A check-in this recent means they are still there ("here now" on the place sheet uses the same hour). */
const HERE_NOW_MS = 60 * 60_000;
const ROUTE_DAYS = 7;

export const socialMapRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, tiger, config, clock } = app.ctx;

  app.get(
    '/social',
    {
      ...authed,
      schema: {
        tags: ['social'],
        summary:
          'Social mode layer: friends checked in within 3 h (blink the active ones), friends’ plans as lines (dotted planned, solid completed), open "!" plans. Poll every 30 s while the map is open.',
        description:
          'Nothing here is live location: check-ins are deliberate acts, so sharing is consent by design. Ghost mode hides your check-ins.',
        security: bearer,
        querystring: SocialQuery,
        response: { 200: SocialResponse, ...errs(401) },
      },
    },
    async (req) => {
      const now = clock.now();
      const [me, friends, blocked] = await Promise.all([
        getUser(db, req.userId),
        friendIds(db, req.userId),
        blockedIds(db, req.userId),
      ]);
      const box = req.query.bbox?.split(',').map(Number) as
        | [number, number, number, number]
        | undefined;
      const inBox = (p: { lat: number; lng: number }) =>
        !box || (p.lng >= box[0] && p.lat >= box[1] && p.lng <= box[2] && p.lat <= box[3]);

      // Friends out right now (last check-in within 3 h), unless they are in ghost mode. Runs alongside the plans.
      const friendsOutP = (async () => {
        const visibleFriends = (
          await users(db)
            .find({
              _id: { $in: friends },
              ghostMode: { $ne: true },
              deletedAt: { $exists: false },
            })
            .toArray()
        ).filter((u) => !blocked.includes(u._id));
        const { rows } = visibleFriends.length
          ? await tiger.query<{
              user_id: string;
              place_id: string;
              time: Date;
              plan_id: string | null;
              session_id: string | null;
            }>(
              `select distinct on (user_id) user_id, place_id, time, plan_id, session_id from checkins
             where user_id = any($1) and time > $2 and time <= $3 order by user_id, time desc`,
              [visibleFriends.map((u) => u._id), new Date(now.getTime() - OUT_WINDOW_MS), now],
            )
          : { rows: [] };
        const sessionIds = rows.flatMap((r) => (r.session_id ? [r.session_id] : []));
        const [placeList, live] = await Promise.all([
          places(db)
            .find({ _id: { $in: rows.map((r) => r.place_id) } })
            .toArray(),
          sessionIds.length
            ? sessions(db)
                .find({ _id: { $in: sessionIds }, status: 'active' }, { projection: { _id: 1 } })
                .toArray()
            : [],
        ]);
        const placeDocs = new Map(placeList.map((p) => [p._id, p]));
        const onOuting = new Set(live.map((x) => x._id));
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
              active:
                now.getTime() - r.time.getTime() <= HERE_NOW_MS ||
                (!!r.session_id && onOuting.has(r.session_id)),
            },
          ];
        });
        return friendsOut;
      })();
      // Awaited below; this only keeps a failure here from going unhandled if the plans part throws first.
      friendsOutP.catch(() => {});

      // Upcoming plans: friends' shared plans (or ones I am invited to) and open plans from verified students.
      const upcoming = {
        status: { $in: ['planned', 'active'] as PlanDoc['status'][] },
        startAt: {
          $gte: new Date(now.getTime() - OUT_WINDOW_MS),
          $lte: new Date(now.getTime() + 7 * 86_400_000),
        },
        hostId: { $nin: [me._id, ...blocked] },
      };
      const friendHosts = friends.filter((f) => !blocked.includes(f));
      const [shared, open, completed] = await Promise.all([
        plans(db)
          .find({
            ...upcoming,
            $or: [
              { visibility: 'friends', hostId: { $in: friends } },
              // Invited or joined; a pending request to an open plan stays under openPlans as "requested".
              {
                members: { $elemMatch: { userId: me._id, status: { $in: ['invited', 'joined'] } } },
              },
            ],
          })
          .sort({ startAt: 1 })
          .limit(20)
          .toArray(),
        me.verifiedAt
          ? plans(db)
              .find({ ...upcoming, visibility: 'find' })
              .sort({ startAt: 1 })
              .limit(60)
              .toArray()
              .then(async (list) => (await openPlansFor(app.ctx, me, list)).slice(0, 20))
          : Promise.resolve([] as PlanDoc[]),
        // Friends' outings from the last week, drawn solid: shared with friends, or ones I was on.
        plans(db)
          .find({
            status: 'completed',
            completedAt: { $gte: new Date(now.getTime() - ROUTE_DAYS * 86_400_000) },
            hostId: { $in: friendHosts },
            $or: [{ visibility: { $in: ['friends', 'find'] } }, { 'members.userId': me._id }],
          })
          .sort({ completedAt: -1 })
          .limit(20)
          .toArray(),
      ]);
      const status = (p: PlanDoc) => p.members.find((m) => m.userId === me._id)?.status;
      const views = async (list: PlanDoc[]) =>
        Promise.all(list.map((p) => toPlanView(db, config, p, me._id, { pref: me.prefVector })));
      const routes = async () => {
        const list = [...shared.filter((p) => friendHosts.includes(p.hostId)), ...completed];
        if (!list.length) return [];
        const [byId, hosts] = await Promise.all([
          loadPlaces(
            db,
            list.flatMap((p) => p.stops.map((x) => x.placeId)),
          ),
          users(db)
            .find({ _id: { $in: [...new Set(list.map((p) => p.hostId))] } })
            .toArray(),
        ]);
        const hostById = new Map(hosts.map((u) => [u._id, u]));
        return list.flatMap((p) => {
          const host = hostById.get(p.hostId);
          // A finished outing shows where they went, which ghost mode hides; a plan they shared stays shared.
          if (!host || host.deletedAt || (p.status === 'completed' && host.ghostMode)) return [];
          const at = (x: PlanDoc['stops'][number]) => {
            const place = x.placeId ? byId.get(x.placeId) : undefined;
            return place
              ? [fromGeoJSONPoint(place.loc)]
              : x.slot
                ? [fromGeoJSONPoint(x.slot.near)]
                : [];
          };
          const done = p.stops.findIndex((x) => !x.done);
          const doneThrough = done < 0 ? p.stops.length : done;
          const line = (p.status === 'completed' ? p.stops.filter((x) => x.done) : p.stops).flatMap(
            at,
          );
          if (!line.length || (box && !line.some(inBox))) return [];
          const status =
            p.status === 'completed'
              ? ('completed' as const)
              : p.status === 'active'
                ? ('active' as const)
                : ('planned' as const);
          return [
            {
              planId: p._id,
              name: p.name,
              host: toUserCard(host, config),
              status,
              style:
                status === 'completed'
                  ? ('solid' as const)
                  : status === 'active' && doneThrough > 0
                    ? ('mixed' as const)
                    : ('dotted' as const),
              line,
              doneThrough: status === 'completed' ? line.length : doneThrough,
              startAt: p.startAt.toISOString(),
              completedAt: p.completedAt?.toISOString() ?? null,
            },
          ];
        });
      };
      const [sharedAll, openAll, friendsOut, friendRoutes] = await Promise.all([
        views(shared.filter((p) => status(p) !== 'declined')),
        views(open.filter((p) => !shared.some((s) => s._id === p._id) && status(p) !== 'declined')),
        friendsOutP,
        routes(),
      ]);
      const sharedViews = sharedAll.filter(
        (v) =>
          v.stops.some((s) => inBox(s.place?.loc ?? s.slot?.near ?? { lat: 0, lng: 0 })) || !box,
      );
      const openViews = openAll.filter(
        (v) => v.stops.some((s) => inBox(s.place?.loc ?? { lat: 0, lng: 0 })) || !box,
      );
      return {
        friendsOut,
        routes: friendRoutes,
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

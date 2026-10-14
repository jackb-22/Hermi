import { ApiError } from '@itp/shared';
import type { Filter } from 'mongodb';
import type { AppContext } from '../context.ts';
import { openPlansFor } from './matching.ts';
import { type PlanDoc, plans } from './plans.ts';
import { blockedIds, friendIds } from './social.ts';
import { getUser, users } from './users.ts';

/**
 * The one rule for who may see a plan. GET /plans/:id, the Plans tab of a profile, and saving or copying a plan
 * all go through it:
 * - the host and anyone on the member list, whatever the visibility;
 * - friends of the host for friends and open (find) plans, matched students for open plans;
 * - not through a friendship or a match when the host is deleted or blocked either way, and not a completed
 *   outing of a host in ghost mode (it shows where they went; the social map hides it the same way).
 * The share link is its own capability (GET /plans/by-token) and is not checked here. Keeps the given order.
 */
export async function visiblePlans(
  ctx: AppContext,
  viewerId: string,
  list: PlanDoc[],
): Promise<PlanDoc[]> {
  const { db } = ctx;
  const own = (p: PlanDoc) => p.hostId === viewerId || p.members.some((m) => m.userId === viewerId);
  const social = list.filter(
    (p) => !own(p) && (p.visibility === 'friends' || p.visibility === 'find'),
  );
  const allowed = new Set(list.filter(own).map((p) => p._id));
  if (social.length) {
    const [friends, blocked, hosts] = await Promise.all([
      friendIds(db, viewerId).then((ids) => new Set(ids)),
      blockedIds(db, viewerId).then((ids) => new Set(ids)),
      users(db)
        .find(
          {
            _id: { $in: [...new Set(social.map((p) => p.hostId))] },
            deletedAt: { $exists: false },
          },
          { projection: { ghostMode: 1 } },
        )
        .toArray(),
    ]);
    const hostById = new Map(hosts.map((h) => [h._id, h]));
    const reachable = social.filter((p) => {
      const host = hostById.get(p.hostId);
      return host && !blocked.has(p.hostId) && !(p.status === 'completed' && host.ghostMode);
    });
    for (const p of reachable) if (friends.has(p.hostId)) allowed.add(p._id);
    const strangers = reachable.filter((p) => p.visibility === 'find' && !allowed.has(p._id));
    if (strangers.length)
      for (const p of await openPlansFor(ctx, await getUser(db, viewerId), strangers))
        allowed.add(p._id);
  }
  return list.filter((p) => allowed.has(p._id));
}

/** 404 (not 403) for a plan the viewer may not see, so its existence does not leak. */
export async function assertCanView(ctx: AppContext, plan: PlanDoc, viewerId: string) {
  if (!(await visiblePlans(ctx, viewerId, [plan])).length)
    throw new ApiError(404, 'NOT_FOUND', 'No such plan');
}

/** Most plans looked at to fill one page: hidden ones are dropped after the query, so a page needs slack. */
const SCAN_LIMIT = 500;

/**
 * Plans `who` hosts or joined, newest start first, that `viewerId` may see: all of them for yourself, the same
 * rule as viewing one plan for anyone else. `filter` narrows (scope, status); cancelled plans never show.
 */
export async function plansOf(
  ctx: AppContext,
  viewerId: string,
  who: string,
  opts: { filter?: Filter<PlanDoc>; limit?: number } = {},
): Promise<PlanDoc[]> {
  const mine = who === viewerId;
  const limit = opts.limit ?? 50;
  const found = await plans(ctx.db)
    .find({
      $and: [
        { $or: [{ hostId: who }, { members: { $elemMatch: { userId: who, status: 'joined' } } }] },
        { status: { $ne: 'cancelled' } },
        // Cheap pre-filter for other people: nobody sees someone's private plan unless they are on it.
        ...(mine
          ? []
          : [
              {
                $or: [
                  { visibility: { $in: ['friends', 'find'] } },
                  { hostId: viewerId },
                  { 'members.userId': viewerId },
                ],
              } satisfies Filter<PlanDoc>,
            ]),
        ...(opts.filter ? [opts.filter] : []),
      ],
    })
    .sort({ startAt: -1 })
    .limit(mine ? limit : SCAN_LIMIT)
    .toArray();
  return mine ? found : (await visiblePlans(ctx, viewerId, found)).slice(0, limit);
}

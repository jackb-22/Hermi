import {
  CATEGORY_DEFAULT_TAGS,
  fromGeoJSONPoint,
  haversineM,
  type LatLng,
  type PinType,
  TAG_DIMS,
  type Tag,
} from '@itp/shared';
import type { Document } from 'mongodb';
import type { AppContext } from '../context.ts';
import { PREF_VECTOR_INDEX } from '../db/indexes.ts';
import type { UserDoc } from '../db/types.ts';
import { cosine, norm, tagVector, violatesDislikes } from '../domain/taste.ts';
import type { JobDoc } from '../jobs/queue.ts';
import { notify } from './notify.ts';
import { loadPlaces, type PlanDoc, plans } from './plans.ts';
import { users } from './users.ts';

/** Candidates share the host's campus and, if they checked in lately, were last seen within 3 km of the first stop. */
export const MATCH_RADIUS_M = 3000;
/** "Overlapping taste": cosine of the plan vector and the student's preference vector. */
export const MATCH_MIN_SIMILARITY = 0.05;
export const MATCH_LIMIT = 25;

const DAY = 86_400_000;
const nyTime = (d: Date) =>
  d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

export interface PlanFacts {
  plan: PlanDoc;
  host?: UserDoc;
  vec: number[];
  loc: LatLng | null;
  start: Date;
  end: Date;
  stops: { category: PinType; tags: Tag[]; adultOnly: boolean }[];
}

/** When a plan starts and ends (last departure; three hours for an empty plan). */
const windowOf = (p: Pick<PlanDoc, 'startAt' | 'stops'>) => ({
  start: p.startAt,
  end: p.stops.at(-1)?.departAt ?? new Date(p.startAt.getTime() + 3 * 3600_000),
});

/** Plan vector = the mean of its stops' tag vectors (a place without tags counts as its category's usual tags). */
export async function planFacts(ctx: AppContext, list: PlanDoc[]): Promise<PlanFacts[]> {
  const byId = await loadPlaces(
    ctx.db,
    list.flatMap((p) => p.stops.map((s) => s.placeId)),
  );
  const hosts = new Map(
    (
      await users(ctx.db)
        .find({ _id: { $in: [...new Set(list.map((p) => p.hostId))] } })
        .toArray()
    ).map((u) => [u._id, u as UserDoc]),
  );
  return list.map((plan) => {
    const stops = plan.stops.map((s) => {
      const p = s.placeId ? byId.get(s.placeId) : undefined;
      const category = p?.category ?? s.slot?.category ?? 'food';
      return {
        category,
        tags: p?.tags.length ? p.tags : CATEGORY_DEFAULT_TAGS[category],
        adultOnly: !!p?.adultOnly,
        loc: p ? fromGeoJSONPoint(p.loc) : s.slot ? fromGeoJSONPoint(s.slot.near) : null,
      };
    });
    const vec = new Array<number>(TAG_DIMS).fill(0);
    for (const s of stops)
      tagVector(s.tags).forEach((x, i) => {
        vec[i]! += x / stops.length;
      });
    return {
      plan,
      host: hosts.get(plan.hostId),
      vec,
      loc: stops[0]?.loc ?? null,
      ...windowOf(plan),
      stops: stops.map(({ loc: _, ...s }) => s),
    };
  });
}

export interface ViewerFacts {
  user: UserDoc;
  lastLoc: LatLng | null;
  busy: { planId: string; start: Date; end: Date }[];
  blocked: Set<string>;
}

/** Everything the match test needs about each candidate, in three batched queries. */
export async function viewerFacts(
  ctx: AppContext,
  list: UserDoc[],
  around: { from: Date; to: Date },
): Promise<Map<string, ViewerFacts>> {
  const ids = list.map((u) => u._id);
  const out = new Map<string, ViewerFacts>(
    list.map((u) => [u._id, { user: u, lastLoc: null, busy: [], blocked: new Set() }]),
  );
  if (!ids.length) return out;
  const [last, theirPlans, blocks] = await Promise.all([
    ctx.tiger.query<{ user_id: string; lat: number; lng: number }>(
      `select distinct on (user_id) user_id, lat, lng from checkins
       where user_id = any($1) and time > $2 and lat is not null order by user_id, time desc`,
      [ids, new Date(ctx.clock.now().getTime() - 30 * DAY)],
    ),
    plans(ctx.db)
      .find({
        status: { $in: ['planned', 'active'] },
        startAt: {
          $gte: new Date(around.from.getTime() - DAY),
          $lte: new Date(around.to.getTime() + DAY),
        },
        $or: [
          { hostId: { $in: ids } },
          { members: { $elemMatch: { userId: { $in: ids }, status: 'joined' } } },
        ],
      })
      .project<Pick<PlanDoc, '_id' | 'hostId' | 'members' | 'startAt' | 'stops'>>({
        hostId: 1,
        members: 1,
        startAt: 1,
        'stops.departAt': 1,
      })
      .toArray(),
    ctx.db
      .collection<{ blocker: string; blocked: string }>('blocks')
      .find({ $or: [{ blocker: { $in: ids } }, { blocked: { $in: ids } }] })
      .toArray(),
  ]);
  for (const r of last.rows) out.get(r.user_id)!.lastLoc = { lat: r.lat, lng: r.lng };
  for (const p of theirPlans) {
    const w = { planId: p._id, ...windowOf(p) };
    for (const id of [
      p.hostId,
      ...p.members.filter((m) => m.status === 'joined').map((m) => m.userId),
    ])
      out.get(id)?.busy.push(w);
  }
  for (const b of blocks) {
    out.get(b.blocker)?.blocked.add(b.blocked);
    out.get(b.blocked)?.blocked.add(b.blocker);
  }
  return out;
}

/**
 * The match test, shared by the push job and by every read of open plans. Verified, Open to plans, on the host's
 * campus and nearby, free at that time, not blocked, no disliked stop, 21+ where needed; then taste similarity.
 */
export function matchScore(pf: PlanFacts, vf: ViewerFacts): number | null {
  const u = vf.user;
  const plan = pf.plan;
  if (u._id === plan.hostId || plan.members.some((m) => m.userId === u._id)) return null;
  if (!u.verifiedAt || u.deletedAt || !u.openToPlans) return null;
  if (vf.blocked.has(plan.hostId)) return null;
  if (!u.is21 && pf.stops.some((s) => s.adultOnly)) return null;
  if (pf.stops.some((s) => violatesDislikes(u.dislikes, s.category, s.tags))) return null;
  // Same campus as the host (the vector search pre-filter), then distance in code: a last check-in more than
  // 3 km from the first stop rules someone out; with no recent check-in the shared campus stands in.
  if (pf.host?.campus && u.campus !== pf.host.campus) return null;
  if (!pf.host?.campus && !vf.lastLoc) return null;
  if (vf.lastLoc && pf.loc && haversineM(vf.lastLoc, pf.loc) > MATCH_RADIUS_M) return null;
  if (vf.busy.some((b) => b.planId !== plan._id && b.start < pf.end && pf.start < b.end))
    return null;
  const sim = cosine(u.prefVector ?? [], pf.vec);
  return sim >= MATCH_MIN_SIMILARITY ? sim : null;
}

/**
 * Open (Find someone) plans a viewer may see: plans they matched, plus any they already requested or joined.
 * Keeps the given order.
 */
export async function openPlansFor(
  ctx: AppContext,
  viewer: UserDoc,
  list: PlanDoc[],
): Promise<PlanDoc[]> {
  const open = list.filter((p) => p.visibility === 'find');
  if (!open.length) return [];
  const facts = await planFacts(ctx, open);
  const from = new Date(Math.min(...facts.map((f) => f.start.getTime())));
  const to = new Date(Math.max(...facts.map((f) => f.end.getTime())));
  const vf = (await viewerFacts(ctx, [viewer], { from, to })).get(viewer._id)!;
  return facts
    .filter(
      (f) => f.plan.members.some((m) => m.userId === viewer._id) || matchScore(f, vf) !== null,
    )
    .map((f) => f.plan);
}

/**
 * Find someone: one $vectorSearch over preference vectors, pre-filtered on openToPlans and the host's campus,
 * numCandidates 20× what we fetch; distance, time, blocks and dislikes are checked in code.
 * Falls back to a scan when Atlas Search is unavailable or the index is still building.
 */
export async function findMatches(
  ctx: AppContext,
  plan: PlanDoc,
  limit = MATCH_LIMIT,
): Promise<{ userId: string; score: number }[]> {
  const [pf] = await planFacts(ctx, [plan]);
  if (!pf || !norm(pf.vec)) return [];
  const filter: Document = { openToPlans: true };
  if (pf.host?.campus) filter.campus = pf.host.campus;
  const fetch = limit * 4;
  let ids: string[] = [];
  try {
    ids = (
      await users(ctx.db)
        .aggregate<{ _id: string }>([
          {
            $vectorSearch: {
              index: PREF_VECTOR_INDEX,
              path: 'prefVector',
              queryVector: pf.vec,
              numCandidates: Math.min(10_000, 20 * fetch),
              limit: fetch,
              filter,
            },
          },
          { $project: { _id: 1 } },
        ])
        .toArray()
    ).map((d) => d._id);
  } catch (e) {
    console.warn(`[matching] $vectorSearch unavailable, scanning: ${(e as Error).message}`);
  }
  if (!ids.length)
    ids = (
      await users(ctx.db)
        .find({ ...filter, prefVector: { $exists: true } }, { projection: { _id: 1 } })
        .limit(5000)
        .toArray()
    ).map((d) => d._id);
  const docs = (await users(ctx.db)
    .find({ _id: { $in: ids } })
    .toArray()) as UserDoc[];
  const vfs = await viewerFacts(ctx, docs, { from: pf.start, to: pf.end });
  return docs
    .flatMap((u) => {
      const score = matchScore(pf, vfs.get(u._id)!);
      return score === null ? [] : [{ userId: u._id, score: Math.round(score * 1000) / 1000 }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Job: match an open plan and push the students newly matched to it ("!" on their map). */
export async function matchNotify(ctx: AppContext, payload: { planId: string }, _job?: JobDoc) {
  const plan = await plans(ctx.db).findOne({ _id: payload.planId });
  if (
    plan?.visibility !== 'find' ||
    !['planned', 'active'].includes(plan.status) ||
    windowOf(plan).end < ctx.clock.now()
  )
    return;
  const matches = await findMatches(ctx, plan);
  const already = new Set(plan.notifiedMatchIds ?? []);
  const fresh = matches.map((m) => m.userId).filter((id) => !already.has(id));
  await plans(ctx.db).updateOne(
    { _id: plan._id },
    {
      $set: { matchCount: matches.length, matchedAt: ctx.clock.now() },
      $addToSet: { notifiedMatchIds: { $each: fresh } },
    },
  );
  if (fresh.length)
    await notify(ctx, fresh, {
      title: 'An open plan matches your taste',
      body: `${plan.name} · ${nyTime(plan.startAt)}`,
      data: { kind: 'plan_match', planId: plan._id },
    });
}

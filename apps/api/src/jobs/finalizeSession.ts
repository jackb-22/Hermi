import { tileKey, XP } from '@itp/shared';
import type { RecapSchema } from '@itp/shared/api';
import type { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { PlaceDoc } from '../db/placeTypes.ts';
import {
  detectStays,
  onFoot,
  segmentTrace,
  thinRoute,
  tileCap,
  tilesFromSegments,
} from '../domain/movement.ts';
import { createCheckin } from '../services/checkins.ts';
import { media } from '../services/media.ts';
import { places } from '../services/places.ts';
import { type PlanDoc, plans } from '../services/plans.ts';
import { sessions, sessionTrace } from '../services/sessions.ts';
import { getUser } from '../services/users.ts';
import { awardXp, type XpRow, xpLabel } from '../services/xp.ts';

export const STAY_SNAP_M = 60;
const PARTY_WINDOW_MS = 30 * 60_000;

type Recap = z.infer<typeof RecapSchema>;

/** Everyone who joined: host plus joined members. */
export const party = (p: PlanDoc) => [
  p.hostId,
  ...p.members.filter((m) => m.status === 'joined').map((m) => m.userId),
];

/**
 * At End, the worker writes segments, tiles and distance XP, then builds the recap.
 * Idempotent: session- and plan-level XP carry ref ids and are only written once.
 */
export async function finalizeSession(ctx: AppContext, payload: { sessionId: string }) {
  const { db, tiger } = ctx;
  const s = await sessions(db).findOne({ _id: payload.sessionId });
  if (!s || (s.status === 'ended' && s.recap)) return;
  const user = await getUser(db, s.userId);
  const endedAt = s.endedAt ?? ctx.clock.now();
  const sessionRef = `session:${s._id}`;

  // Segments and steps.
  const trace = await sessionTrace(tiger, s._id);
  const segs = segmentTrace(trace);
  const footMeters = segs.filter((g) => onFoot(g.mode)).reduce((a, g) => a + g.meters, 0);
  const walkMeters = segs.filter((g) => g.mode === 'walk').reduce((a, g) => a + g.meters, 0);
  const steps = s.steps;
  await tiger.query('delete from movement_segments where session_id = $1', [s._id]);
  for (const g of segs) {
    const st =
      steps && g.mode === 'walk' && walkMeters > 0
        ? Math.round((steps * g.meters) / walkMeters)
        : 0;
    await tiger.query(
      'insert into movement_segments (time, end_time, user_id, session_id, mode, meters, steps) values ($1, $2, $3, $4, $5, $6, $7)',
      [g.start, g.end, s.userId, s._id, g.mode, g.meters, st],
    );
  }

  // Tiles: only on foot or bike, capped by what the distance allows.
  const tiles = tilesFromSegments(segs);
  const userTiles = db.collection<{
    userId: string;
    x: number;
    y: number;
    firstAt: Date;
    sessionId: string;
  }>('user_tiles');
  const had = new Set(
    (
      await userTiles
        .find(
          { userId: s.userId, x: { $in: [...new Set(tiles.map((t) => t.x))] } },
          { projection: { x: 1, y: 1, sessionId: 1 } },
        )
        .toArray()
    )
      .filter((t) => t.sessionId !== s._id)
      .map(tileKey),
  );
  const newTiles = tiles.filter((t) => !had.has(tileKey(t))).slice(0, tileCap(footMeters));
  if (newTiles.length) {
    await userTiles.bulkWrite(
      newTiles.map((t) => ({
        updateOne: {
          filter: { userId: s.userId, x: t.x, y: t.y },
          update: { $setOnInsert: { firstAt: endedAt, sessionId: s._id } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  // Head out: stays of 8+ minutes within 75 m become GPS-tier check-ins at the nearest place within 60 m.
  if (s.kind === 'headout') {
    for (const stay of detectStays(trace)) {
      const [near] = await places(db)
        .aggregate<PlaceDoc>([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [stay.center.lng, stay.center.lat] },
              key: 'loc',
              distanceField: 'd',
              maxDistance: STAY_SNAP_M,
              query: user.is21 ? {} : { adultOnly: { $ne: true } },
            },
          },
          { $limit: 1 },
        ])
        .toArray();
      if (!near) continue;
      await createCheckin(ctx, {
        userId: s.userId,
        placeId: near._id,
        tier: 'gps',
        at: stay.center,
        accuracy: 20,
        time: stay.end,
        attested: false,
        sessionId: s._id,
        dwellVerified: true,
      }).catch(
        () => {}, // cooldown or duplicate: the visit already counts
      );
    }
  }

  // Check-ins made during this session.
  const { rows: checkins } = await tiger.query<{
    id: string;
    time: Date;
    place_id: string;
    tier: 'gps' | 'tag';
  }>(
    'select id, time, place_id, tier from checkins where session_id = $1 and user_id = $2 order by time',
    [s._id, s.userId],
  );

  // Session and plan XP.
  const already = async (ref: string, kind: string) =>
    ((
      await tiger.query(
        'select 1 from xp_events where user_id = $1 and ref_id = $2 and kind = $3 limit 1',
        [s.userId, ref, kind],
      )
    ).rowCount ?? 0) > 0;
  const rows: XpRow[] = [];
  if (!(await already(sessionRef, 'distance')))
    rows.push({
      kind: 'distance',
      xp: Math.round((footMeters / 1000) * XP.perKmOnFootOrBike),
      refId: sessionRef,
      label: xpLabel('distance'),
    });
  if (!(await already(sessionRef, 'tiles')))
    rows.push({
      kind: 'tiles',
      xp: newTiles.length * XP.newTile,
      refId: sessionRef,
      label: xpLabel('tiles'),
    });

  const plan = s.planId ? await plans(db).findOne({ _id: s.planId }) : null;
  let planCompleted = false;
  let fullParty = false;
  if (plan) {
    const planRef = `plan:${plan._id}`;
    const { rows: mine } = await tiger.query<{ place_id: string }>(
      'select distinct place_id from checkins where user_id = $1 and plan_id = $2',
      [s.userId, plan._id],
    );
    planCompleted = mine.length >= 2;
    if (planCompleted && !(await already(planRef, 'completed_plan')))
      rows.push({
        kind: 'completed_plan',
        xp: XP.completedPlan,
        refId: planRef,
        label: xpLabel('completed_plan'),
      });

    const people = party(plan);
    if (people.length >= 2) {
      const { rows: all } = await tiger.query<{ user_id: string; place_id: string; time: Date }>(
        'select user_id, place_id, time from checkins where plan_id = $1 and user_id = any($2)',
        [plan._id, people],
      );
      const byPlace = new Map<string, { user_id: string; time: Date }[]>();
      for (const r of all) byPlace.set(r.place_id, [...(byPlace.get(r.place_id) ?? []), r]);
      fullParty = [...byPlace.values()].some((list) => {
        const who = new Set(list.map((r) => r.user_id));
        const times = list.map((r) => r.time.getTime());
        return (
          people.every((p) => who.has(p)) &&
          Math.max(...times) - Math.min(...times) <= PARTY_WINDOW_MS
        );
      });
      if (fullParty && !(await already(planRef, 'full_party')))
        rows.push({
          kind: 'full_party',
          xp: XP.fullParty,
          refId: planRef,
          label: xpLabel('full_party'),
        });

      if (planCompleted && !(await already(planRef, 'new_person'))) {
        const others = people.filter((p) => p !== s.userId);
        const before = await plans(db)
          .find({
            _id: { $ne: plan._id },
            status: 'completed',
            $or: [
              { hostId: s.userId },
              { members: { $elemMatch: { userId: s.userId, status: 'joined' } } },
            ],
          })
          .toArray();
        const seen = new Set(before.flatMap(party));
        if (others.some((o) => !seen.has(o)))
          rows.push({
            kind: 'new_person',
            xp: XP.firstPlanWithSomeoneNew,
            refId: planRef,
            label: xpLabel('new_person'),
          });
      }
    }
    if (plan.hostId === s.userId)
      await plans(db).updateOne(
        { _id: plan._id },
        { $set: { status: 'completed', completedAt: endedAt, updatedAt: endedAt } },
      );
  }
  await awardXp(tiger, s.userId, user.campus, endedAt, rows);

  // Recap document.
  const ids = checkins.map((c) => c.id);
  const refs = [...ids, sessionRef, ...(plan ? [`plan:${plan._id}`] : [])];
  const { rows: xpRows } = await tiger.query<{ kind: string; xp: number; ref_id: string }>(
    'select kind, xp, ref_id from xp_events where user_id = $1 and ref_id = any($2) order by time',
    [s.userId, refs],
  );
  const firstVisits = new Set(xpRows.filter((r) => r.kind === 'first_visit').map((r) => r.ref_id));
  const byKind = new Map<string, number>();
  for (const r of xpRows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + r.xp);
  const placeDocs = new Map(
    (
      await places(db)
        .find({ _id: { $in: checkins.map((c) => c.place_id) } })
        .toArray()
    ).map((p) => [p._id, p]),
  );
  const shots = await media(db)
    .find({ checkinId: { $in: ids }, status: 'verified', kind: { $in: ['photo', 'video'] } })
    .sort({ capturedAt: 1 })
    .toArray();
  const reviewed = new Set(
    (
      await db
        .collection<{ checkinId: string }>('reviews')
        .find({ checkinId: { $in: ids } })
        .toArray()
    ).map((r) => r.checkinId),
  );

  const recap: Recap = {
    sessionId: s._id,
    planId: plan?._id ?? null,
    planName: plan?.name ?? null,
    startedAt: s.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMin: Math.round((endedAt.getTime() - s.startedAt.getTime()) / 60_000),
    route: thinRoute(trace),
    segments: segs.map((g) => ({
      mode: g.mode,
      start: g.start.toISOString(),
      end: g.end.toISOString(),
      meters: Math.round(g.meters),
    })),
    newTiles: newTiles.map(({ x, y }) => ({ x, y })),
    footKm: Math.round(footMeters / 100) / 10,
    totalKm: Math.round(segs.reduce((a, g) => a + g.meters, 0) / 100) / 10,
    steps: steps ?? null,
    stops: checkins.map((c) => {
      const p = placeDocs.get(c.place_id);
      const mine = shots.filter((m) => m.checkinId === c.id);
      const best = mine.filter((m) => m.kind === 'video').at(-1) ?? mine.at(-1);
      return {
        checkinId: c.id,
        placeId: c.place_id,
        placeName: p?.name ?? 'Unknown place',
        category: p?.category ?? 'food',
        tier: c.tier,
        time: c.time.toISOString(),
        firstVisit: firstVisits.has(c.id),
        bestMediaId: best?._id ?? null,
        mediaIds: mine.map((m) => m._id),
        reviewed: reviewed.has(c.id),
      };
    }),
    xp: {
      total: [...byKind.values()].reduce((a, b) => a + b, 0),
      items: [...byKind].map(([kind, xp]) => ({ kind, xp, label: xpLabel(kind as never) ?? kind })),
    },
    planCompleted,
    fullParty,
    posted: false,
  };
  await sessions(db).updateOne({ _id: s._id }, { $set: { status: 'ended', endedAt, recap } });
}

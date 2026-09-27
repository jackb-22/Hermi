import {
  ApiError,
  CHECKIN_COOLDOWN_H,
  fromGeoJSONPoint,
  haversineM,
  type LatLng,
  newId,
  XP,
} from '@itp/shared';
import type { CheckinResponse } from '@itp/shared/api';
import type { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { PlaceDoc } from '../db/placeTypes.ts';
import { checkDwell, GPS_ACCURACY_M } from '../domain/dwell.ts';
import { places, toPlace } from './places.ts';
import { plans } from './plans.ts';
import { hit } from './rateLimit.ts';
import { activeSession, sessions, sessionTrace } from './sessions.ts';
import { getUser } from './users.ts';
import { awardXp, type XpRow, xpLabel } from './xp.ts';

export const TAG_RADIUS_M = 150;
const CHECKINS_PER_HOUR = 12;

export interface CheckinInput {
  userId: string;
  placeId: string;
  tier: 'gps' | 'tag';
  at: LatLng;
  accuracy: number;
  time: Date;
  attested: boolean;
  sessionId?: string;
  tagId?: string;
  /** Server-detected stays (Head out) already proved the dwell from the trace. */
  dwellVerified?: boolean;
}

export type CheckinResult = z.infer<typeof CheckinResponse>;

/** Called after the check-in row is written (co-check-in hangouts, the plan's group chat). Registered in hooks.ts. */
export type CheckinHook = (
  ctx: AppContext,
  c: {
    id: string;
    userId: string;
    placeId: string;
    tier: 'gps' | 'tag';
    time: Date;
    tagId?: string;
    planId?: string;
  },
) => Promise<CheckinResult['hangouts']>;
export const checkinHooks: CheckinHook[] = [];

/**
 * One check-in per user per venue per cooldown: the document for the pair holds when the next one may happen, and
 * only a request whose time is past it can move it (or insert it). A concurrent second request hits the unique _id.
 */
async function claimCooldown(
  ctx: AppContext,
  userId: string,
  placeId: string,
  time: Date,
  placeName: string,
) {
  const until = new Date(time.getTime() + CHECKIN_COOLDOWN_H * 3600_000);
  try {
    await ctx.db
      .collection<{ _id: string; until: Date }>('checkin_cooldowns')
      .updateOne(
        { _id: `${userId}:${placeId}`, until: { $lte: time } },
        { $set: { until } },
        { upsert: true },
      );
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    throw new ApiError(
      429,
      'CHECKIN_RATE_LIMITED',
      `Already checked in at ${placeName} in the last ${CHECKIN_COOLDOWN_H} hours`,
    );
  }
}

/**
 * The single proof-of-presence event. Write path:
 * 1 validate (tag secret or GPS dwell, attestation, rate limits) · 2 Tiger checkins row + xp_events
 * · 3 Mongo place.been on a first visit and the plan stop marked done. Tiger is the source of truth.
 */
export async function createCheckin(ctx: AppContext, input: CheckinInput): Promise<CheckinResult> {
  const { db, tiger, clock } = ctx;
  const place = await places(db).findOne({ _id: input.placeId });
  if (!place) throw new ApiError(404, 'NOT_FOUND', 'No such place');
  const loc = fromGeoJSONPoint(place.loc);
  const user = await getUser(db, input.userId);
  const session = input.sessionId
    ? await sessions(db).findOne({ _id: input.sessionId, userId: input.userId })
    : await activeSession(db, input.userId);

  if (input.tier === 'tag') {
    if (haversineM(input.at, loc) > TAG_RADIUS_M)
      throw new ApiError(
        400,
        'CHECKIN_TOO_FAR',
        `You need to be within ${TAG_RADIUS_M} m of ${place.name}`,
      );
  } else if (!input.dwellVerified) {
    if (input.accuracy > GPS_ACCURACY_M)
      throw new ApiError(
        400,
        'CHECKIN_LOW_ACCURACY',
        'GPS accuracy too low; try again outside or scan the venue tag',
      );
    if (session?.status !== 'active')
      throw new ApiError(409, 'SESSION_NOT_ACTIVE', 'GPS check-ins need an active session');
    const trace = await sessionTrace(
      tiger,
      session._id,
      new Date(input.time.getTime() - 3 * 3600_000),
      input.time,
    );
    const dwell = checkDwell(trace, loc, input.time);
    if (!dwell.ok) {
      throw new ApiError(
        400,
        dwell.reason,
        dwell.reason === 'CHECKIN_TOO_FAR'
          ? `You are not at ${place.name} yet`
          : 'Stay 5 minutes to check in, or scan the venue tag',
      );
    }
  }

  const cooldownFrom = new Date(input.time.getTime() - CHECKIN_COOLDOWN_H * 3600_000);
  const prior = await tiger.query<{ recent: number; ever: number }>(
    `select count(*) filter (where time > $3)::int as recent, count(*)::int as ever from checkins where user_id = $1 and place_id = $2`,
    [input.userId, place._id, cooldownFrom],
  );
  if ((prior.rows[0]?.recent ?? 0) > 0)
    throw new ApiError(
      429,
      'CHECKIN_RATE_LIMITED',
      `Already checked in at ${place.name} in the last ${CHECKIN_COOLDOWN_H} hours`,
    );
  await hit(
    db,
    `checkin:${input.userId}`,
    CHECKINS_PER_HOUR,
    3600,
    clock.now(),
    'CHECKIN_RATE_LIMITED',
  );
  const firstVisit = (prior.rows[0]?.ever ?? 0) === 0;
  // The read above cannot stop two taps arriving together (an NFC read that fires twice): both would pass it and
  // both earn XP. Claiming the venue's cooldown is atomic, so exactly one of them goes on.
  await claimCooldown(ctx, input.userId, place._id, input.time, place.name);

  const id = newId();
  const planId = session?.planId;
  await tiger
    .query(
      `insert into checkins (time, id, user_id, place_id, tier, plan_id, session_id, lat, lng, accuracy, attested, tag_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        input.time,
        id,
        input.userId,
        place._id,
        input.tier,
        planId ?? null,
        session?._id ?? null,
        input.at.lat,
        input.at.lng,
        input.accuracy,
        input.attested,
        input.tagId ?? null,
      ],
    )
    .catch(async (e) => {
      // No check-in was written, so the venue is not on cooldown after all.
      await db
        .collection('checkin_cooldowns')
        .deleteOne({ _id: `${input.userId}:${place._id}` as never });
      throw e;
    });
  const xp: XpRow[] = [
    input.tier === 'tag'
      ? { kind: 'checkin_tag', xp: XP.checkinTag, refId: id, label: xpLabel('checkin_tag') }
      : { kind: 'checkin_gps', xp: XP.checkinGps, refId: id, label: xpLabel('checkin_gps') },
  ];
  if (firstVisit)
    xp.push({ kind: 'first_visit', xp: XP.firstVisit, refId: id, label: xpLabel('first_visit') });
  await awardXp(tiger, input.userId, user.campus, input.time, xp);

  if (firstVisit) await places(db).updateOne({ _id: place._id }, { $inc: { been: 1 } });
  let planStop: CheckinResult['planStop'] = null;
  if (planId) {
    const plan = await plans(db).findOne({ _id: planId });
    const idx = plan?.stops.findIndex((s) => s.placeId === place._id && !s.done) ?? -1;
    if (plan && idx >= 0) {
      await plans(db).updateOne(
        { _id: planId, 'stops.id': plan.stops[idx]!.id },
        { $set: { 'stops.$.done': true, 'stops.$.checkinId': id } },
      );
      planStop = { planId, stopId: plan.stops[idx]!.id, index: idx + 1 };
    }
  }

  const hangouts: CheckinResult['hangouts'] = [];
  for (const hook of checkinHooks)
    hangouts.push(
      ...(await hook(ctx, {
        id,
        userId: input.userId,
        placeId: place._id,
        tier: input.tier,
        time: input.time,
        tagId: input.tagId,
        planId: planId ?? undefined,
      })),
    );

  return {
    checkin: {
      id,
      placeId: place._id,
      tier: input.tier,
      time: input.time.toISOString(),
      attested: input.attested,
      sessionId: session?._id ?? null,
      planId: planId ?? null,
    },
    place: toPlace(place as PlaceDoc, { pref: user.prefVector, from: input.at }),
    firstVisit,
    xp: {
      total: xp.reduce((s, r) => s + r.xp, 0),
      items: xp.map(({ kind, xp: v, label }) => ({ kind, xp: v, label })),
    },
    planStop,
    hangouts,
  };
}

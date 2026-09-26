import { ApiError, fromGeoJSONPoint } from '@itp/shared';
import type { RecapSchema, SessionSchema } from '@itp/shared/api';
import type { Db } from 'mongodb';
import type pg from 'pg';
import type { z } from 'zod';
import type { TracePoint } from '../domain/plausibility.ts';
import type { PlacesById, PlanDoc } from './plans.ts';

export const GEOFENCE_M = 100;

export interface SessionDoc {
  _id: string;
  userId: string;
  planId?: string;
  kind: 'plan' | 'headout';
  status: 'active' | 'ending' | 'ended';
  startedAt: Date;
  endedAt?: Date;
  lastPoint?: TracePoint;
  pointsAccepted: number;
  pointsRejected: number;
  steps?: number;
  recap?: z.infer<typeof RecapSchema>;
}

export const sessions = (db: Db) => db.collection<SessionDoc>('sessions');

export function toSession(s: SessionDoc): z.infer<typeof SessionSchema> {
  return {
    id: s._id,
    kind: s.kind,
    planId: s.planId ?? null,
    status: s.status,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    pointsAccepted: s.pointsAccepted,
  };
}

export async function getOwnSession(db: Db, id: string, userId: string): Promise<SessionDoc> {
  const s = await sessions(db).findOne({ _id: id });
  if (!s || s.userId !== userId) throw new ApiError(404, 'NOT_FOUND', 'No such session');
  return s;
}

export const activeSession = (db: Db, userId: string) =>
  sessions(db).findOne({ userId, status: 'active' });

export function geofences(plan: PlanDoc, byId: PlacesById) {
  return plan.stops.flatMap((s) => {
    const p = s.placeId ? byId.get(s.placeId) : undefined;
    return p
      ? [
          {
            stopId: s.id,
            placeId: p._id,
            name: p.name,
            center: fromGeoJSONPoint(p.loc),
            radiusM: GEOFENCE_M,
          },
        ]
      : [];
  });
}

export async function insertPoints(
  tiger: pg.Pool,
  userId: string,
  sessionId: string,
  pts: TracePoint[],
) {
  if (!pts.length) return;
  await tiger.query(
    `insert into location_points (time, user_id, session_id, lat, lng, accuracy, speed)
     select t, $1, $2, lat, lng, acc, spd from unnest($3::timestamptz[], $4::float8[], $5::float8[], $6::real[], $7::real[]) as u(t, lat, lng, acc, spd)`,
    [
      userId,
      sessionId,
      pts.map((p) => p.time),
      pts.map((p) => p.lat),
      pts.map((p) => p.lng),
      pts.map((p) => p.accuracy),
      pts.map((p) => p.speed ?? null),
    ],
  );
}

export async function sessionTrace(
  tiger: pg.Pool,
  sessionId: string,
  from?: Date,
  to?: Date,
): Promise<TracePoint[]> {
  const { rows } = await tiger.query<{
    time: Date;
    lat: number;
    lng: number;
    accuracy: number;
    speed: number | null;
  }>(
    `select time, lat, lng, accuracy, speed from location_points
     where session_id = $1 and ($2::timestamptz is null or time >= $2) and ($3::timestamptz is null or time <= $3)
     order by time`,
    [sessionId, from ?? null, to ?? null],
  );
  return rows.map((r) => ({
    time: r.time,
    lat: r.lat,
    lng: r.lng,
    accuracy: r.accuracy,
    speed: r.speed ?? undefined,
  }));
}

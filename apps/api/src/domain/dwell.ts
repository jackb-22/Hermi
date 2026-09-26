import { type LatLng, haversineM } from '@itp/shared';
import type { TracePoint } from './plausibility.ts';

export const GEOFENCE_M = 100;
export const DWELL_MIN = 5;
export const GPS_ACCURACY_M = 50;
/** The dwell must be current: its last fix no older than this. */
const RECENT_MS = 10 * 60_000;

export type DwellResult = { ok: true; since: Date; until: Date } | { ok: false; reason: 'CHECKIN_NO_DWELL' | 'CHECKIN_TOO_FAR' };

/**
 * GPS tier: 5 minutes inside the stop's 100 m geofence with fixes of 50 m accuracy or better,
 * and a plausible trace leading in (at least one earlier fix outside the fence).
 */
export function checkDwell(trace: TracePoint[], place: LatLng, now: Date): DwellResult {
  const good = trace.filter((p) => p.accuracy <= GPS_ACCURACY_M && p.time <= now);
  // Latest contiguous run of fixes inside the fence.
  let end = good.length - 1;
  while (end >= 0 && haversineM(good[end]!, place) > GEOFENCE_M) end--;
  if (end < 0) return { ok: false, reason: 'CHECKIN_TOO_FAR' };
  if (now.getTime() - good[end]!.time.getTime() > RECENT_MS) return { ok: false, reason: 'CHECKIN_TOO_FAR' };
  let start = end;
  while (start > 0 && haversineM(good[start - 1]!, place) <= GEOFENCE_M) start--;
  const since = good[start]!.time;
  const until = good[end]!.time;
  const leadIn = start > 0;
  if (!leadIn || until.getTime() - since.getTime() < DWELL_MIN * 60_000) return { ok: false, reason: 'CHECKIN_NO_DWELL' };
  return { ok: true, since, until };
}

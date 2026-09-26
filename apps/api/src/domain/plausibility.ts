import { type LatLng, speedKmh } from '@itp/shared';

export const MAX_ACCURACY_M = 100;
export const MAX_SPEED_KMH = 200;
const FUTURE_SLACK_MS = 2 * 60_000;

export interface TracePoint extends LatLng {
  time: Date;
  accuracy: number;
  speed?: number;
}

export type RejectReason = 'accuracy' | 'jump' | 'order' | 'future';

/**
 * Cheapest anti-spoofing layer: drop fixes worse than 100 m, jumps above 200 km/h from the last accepted
 * point, out-of-order and future timestamps. Returns accepted points and a count per reason.
 */
export function filterTrace(points: TracePoint[], prev: TracePoint | undefined, now: Date) {
  const accepted: TracePoint[] = [];
  const rejected: Record<RejectReason, number> = { accuracy: 0, jump: 0, order: 0, future: 0 };
  let last = prev;
  for (const p of [...points].sort((a, b) => a.time.getTime() - b.time.getTime())) {
    if (p.time.getTime() > now.getTime() + FUTURE_SLACK_MS) rejected.future++;
    else if (p.accuracy > MAX_ACCURACY_M) rejected.accuracy++;
    else if (last && p.time <= last.time) rejected.order++;
    else if (last && speedKmh(last, p) > MAX_SPEED_KMH) rejected.jump++;
    else {
      accepted.push(p);
      last = p;
    }
  }
  return { accepted, rejected, last };
}

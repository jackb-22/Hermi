import { type LatLng, type Tile, haversineM, tileKey, tilesAlongPath } from '@itp/shared';
import type { TracePoint } from './plausibility.ts';

export type MoveMode = 'walk' | 'bike' | 'vehicle' | 'subway' | 'still';

/** Segment speed: under 7 km/h walking, 7–30 km/h sustained cycling, faster is a vehicle; a GPS gap between stations is the subway. */
export function classifyPair(a: TracePoint, b: TracePoint): MoveMode {
  const s = (b.time.getTime() - a.time.getTime()) / 1000;
  const m = haversineM(a, b);
  if (s > 180 && m > 400) return 'subway';
  const kmh = s > 0 ? (m / s) * 3.6 : 0;
  if (kmh < 0.5) return 'still';
  if (kmh < 7) return 'walk';
  if (kmh <= 30) return 'bike';
  return 'vehicle';
}

export interface Segment {
  mode: MoveMode;
  start: Date;
  end: Date;
  meters: number;
  points: TracePoint[];
}

const SMOOTH_S = 45;

/** Groups consecutive same-mode pairs; blips shorter than 45 s take their neighbours' mode. */
export function segmentTrace(trace: TracePoint[]): Segment[] {
  if (trace.length < 2) return [];
  const pairs = trace.slice(1).map((b, i) => ({ a: trace[i]!, b, mode: classifyPair(trace[i]!, b) }));
  for (let i = 1; i < pairs.length - 1; i++) {
    const p = pairs[i]!;
    const dur = (p.b.time.getTime() - p.a.time.getTime()) / 1000;
    if (dur < SMOOTH_S && pairs[i - 1]!.mode === pairs[i + 1]!.mode && p.mode !== 'subway') p.mode = pairs[i - 1]!.mode;
  }
  const segs: Segment[] = [];
  for (const p of pairs) {
    const mode = p.mode === 'still' ? 'walk' : p.mode; // idling on foot is still "on foot" for the route line
    const last = segs.at(-1);
    if (last && last.mode === mode) {
      last.end = p.b.time;
      last.meters += haversineM(p.a, p.b);
      last.points.push(p.b);
    } else segs.push({ mode, start: p.a.time, end: p.b.time, meters: haversineM(p.a, p.b), points: [p.a, p.b] });
  }
  return segs;
}

export const onFoot = (m: MoveMode) => m === 'walk' || m === 'bike';

/** Tiles color only on foot or bike, never by car or subway; interpolated so gaps between fixes still color. */
export function tilesFromSegments(segs: Segment[]): Tile[] {
  const seen = new Map<string, Tile>();
  for (const s of segs) if (onFoot(s.mode)) for (const t of tilesAlongPath(s.points)) seen.set(tileKey(t), t);
  return [...seen.values()];
}

/** Anti-farming cap: new tiles per session limited by what the trace's on-foot distance allows. */
export const tileCap = (footMeters: number) => Math.ceil(footMeters / 40) + 4;

export interface Stay {
  center: LatLng;
  start: Date;
  end: Date;
}

/** Head out: 8 minutes or more within 75 m becomes a visit. */
export function detectStays(trace: TracePoint[], minMin = 8, radiusM = 75): Stay[] {
  const stays: Stay[] = [];
  let i = 0;
  while (i < trace.length) {
    let j = i;
    let lat = trace[i]!.lat;
    let lng = trace[i]!.lng;
    while (j + 1 < trace.length) {
      const n = j - i + 1;
      const c = { lat: lat / n, lng: lng / n };
      if (haversineM(c, trace[j + 1]!) > radiusM) break;
      j++;
      lat += trace[j]!.lat;
      lng += trace[j]!.lng;
    }
    const n = j - i + 1;
    if (trace[j]!.time.getTime() - trace[i]!.time.getTime() >= minMin * 60_000) {
      stays.push({ center: { lat: lat / n, lng: lng / n }, start: trace[i]!.time, end: trace[j]!.time });
      i = j + 1;
    } else i++;
  }
  return stays;
}

/** Route line for the recap replay: every fix is too many, keep at most `max` evenly spaced. */
export function thinRoute(trace: LatLng[], max = 400): LatLng[] {
  if (trace.length <= max) return trace.map(({ lat, lng }) => ({ lat, lng }));
  const step = (trace.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, k) => {
    const p = trace[Math.round(k * step)]!;
    return { lat: p.lat, lng: p.lng };
  });
}

import { type LatLng, haversineM, lerp } from '@itp/shared';

/** Points every `stepS` seconds walking a polyline at `kmh`, optionally dwelling at listed vertices. */
export function walk(path: LatLng[], start: Date, o: { kmh?: number; stepS?: number; dwellMin?: Record<number, number>; accuracy?: number } = {}) {
  const kmh = o.kmh ?? 4.8;
  const stepS = o.stepS ?? 15;
  const mps = kmh / 3.6;
  const out: { lat: number; lng: number; accuracy: number; time: string }[] = [];
  let t = start.getTime();
  const push = (p: LatLng) => out.push({ lat: p.lat, lng: p.lng, accuracy: o.accuracy ?? 10, time: new Date(t).toISOString() });
  for (let i = 0; i < path.length; i++) {
    const dwell = o.dwellMin?.[i] ?? 0;
    for (let s = 0; s < dwell * 60; s += stepS) {
      push(path[i]!);
      t += stepS * 1000;
    }
    if (i === path.length - 1) {
      push(path[i]!);
      break;
    }
    const d = haversineM(path[i]!, path[i + 1]!);
    const n = Math.max(1, Math.ceil(d / (mps * stepS)));
    for (let k = 0; k < n; k++) {
      push(lerp(path[i]!, path[i + 1]!, k / n));
      t += (d / n / mps) * 1000;
    }
  }
  return out;
}

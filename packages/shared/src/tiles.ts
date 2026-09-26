import { haversineM, type LatLng, lerp } from './geo.ts';

/** Zoom-18 web-mercator tiles: ~116 m squares in Manhattan, about one block. */
export const TILE_ZOOM = 18;
const N = 2 ** TILE_ZOOM;

export interface Tile {
  x: number;
  y: number;
}

export function latLngToTile(p: LatLng): Tile {
  const x = Math.floor(((p.lng + 180) / 360) * N);
  const latR = (p.lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * N);
  return { x, y };
}

/** North-west corner of a tile. */
export function tileToLatLng(t: Tile): LatLng {
  const lng = (t.x / N) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * t.y) / N;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

export const tileKey = (t: Tile) => `${t.x}:${t.y}`;

/** Every tile a straight segment passes through, sampled finely enough that gaps between GPS fixes still color. */
export function tilesAlongSegment(a: LatLng, b: LatLng, stepM = 20): Tile[] {
  const steps = Math.max(1, Math.ceil(haversineM(a, b) / stepM));
  const seen = new Map<string, Tile>();
  for (let i = 0; i <= steps; i++) {
    const t = latLngToTile(lerp(a, b, i / steps));
    seen.set(tileKey(t), t);
  }
  return [...seen.values()];
}

export function tilesAlongPath(points: LatLng[], stepM = 20): Tile[] {
  if (points.length === 1) return [latLngToTile(points[0]!)];
  const seen = new Map<string, Tile>();
  for (let i = 1; i < points.length; i++) {
    for (const t of tilesAlongSegment(points[i - 1]!, points[i]!, stepM)) seen.set(tileKey(t), t);
  }
  return [...seen.values()];
}

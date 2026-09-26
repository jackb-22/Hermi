export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6_371_008.8; // mean earth radius, meters
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const withinM = (a: LatLng, b: LatLng, meters: number) => haversineM(a, b) <= meters;

/** km/h between two timestamped points; Infinity when time does not advance but position does. */
export function speedKmh(a: LatLng & { time: Date }, b: LatLng & { time: Date }): number {
  const s = (b.time.getTime() - a.time.getTime()) / 1000;
  const m = haversineM(a, b);
  if (s <= 0) return m === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (m / s) * 3.6;
}

/** Linear interpolation, fine at city scale. */
export const lerp = (a: LatLng, b: LatLng, t: number): LatLng => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lng: a.lng + (b.lng - a.lng) * t,
});

export const toGeoJSONPoint = (p: LatLng) => ({ type: 'Point' as const, coordinates: [p.lng, p.lat] as [number, number] });
export const fromGeoJSONPoint = (g: { coordinates: number[] }): LatLng => ({ lng: g.coordinates[0]!, lat: g.coordinates[1]! });

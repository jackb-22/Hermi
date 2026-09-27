import type { LatLng } from '@itp/shared';

const RAD = Math.PI / 180;
const J2000 = 2451545;
const toJulian = (d: Date) => d.getTime() / 86_400_000 + 2440587.5;
const fromJulian = (j: number) => new Date((j - 2440587.5) * 86_400_000);

/**
 * Sunrise and sunset for the local day containing `at` (the sunrise equation; about a minute of error).
 * Used for "nature before sunset" in ghost pins, so no weather provider is needed for it.
 */
export function sunTimes(at: Date, loc: LatLng): { sunrise: Date; sunset: Date } {
  // Solar noon nearest to local noon of this day.
  const n = Math.round(toJulian(at) - J2000 - 0.0009 + loc.lng / 360);
  const jStar = n + 0.0009 - loc.lng / 360;
  const m = (357.5291 + 0.98560028 * jStar) % 360;
  const c =
    1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = J2000 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW =
    (Math.sin(-0.833 * RAD) - Math.sin(loc.lat * RAD) * sinDec) /
    (Math.cos(loc.lat * RAD) * cosDec);
  const w = Math.acos(Math.min(1, Math.max(-1, cosW))) / RAD;
  return { sunrise: fromJulian(transit - w / 360), sunset: fromJulian(transit + w / 360) };
}

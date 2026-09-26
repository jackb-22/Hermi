import { fromGeoJSONPoint, haversineM, type LatLng } from '@itp/shared';
import type { PlaceSchema } from '@itp/shared/api';
import type { Db } from 'mongodb';
import type { z } from 'zod';
import type { PlaceDoc } from '../db/placeTypes.ts';
import { tasteMatch } from '../domain/taste.ts';

export const places = (db: Db) => db.collection<PlaceDoc>('places');
export const WALK_M_PER_MIN = 80;

export function toPlace(
  p: PlaceDoc,
  opts: { from?: LatLng; pref?: number[]; distanceM?: number } = {},
): z.infer<typeof PlaceSchema> {
  const loc = fromGeoJSONPoint(p.loc);
  const distanceM = opts.distanceM ?? (opts.from ? haversineM(opts.from, loc) : undefined);
  return {
    id: p._id,
    name: p.name,
    category: p.category,
    tags: p.tags,
    loc,
    address: p.address ?? null,
    been: p.been,
    wouldGoAgainPct: p.wouldGoAgain.total
      ? Math.round((100 * p.wouldGoAgain.yes) / p.wouldGoAgain.total)
      : null,
    distanceM: distanceM === undefined ? undefined : Math.round(distanceM),
    walkMin:
      distanceM === undefined ? undefined : Math.max(1, Math.round(distanceM / WALK_M_PER_MIN)),
    tasteMatch: opts.pref ? Math.round(tasteMatch(opts.pref, p.tags) * 1000) / 1000 : undefined,
  };
}

/** Popularity + taste + proximity; used to pick top places per category and nearby candidates. */
export function placeRank(p: PlaceDoc, pref?: number[], distanceM?: number): number {
  const popularity = 1 + Math.log1p(p.been) + p.confidence;
  const taste = 1 + tasteMatch(pref, p.tags);
  const proximity = distanceM === undefined ? 1 : Math.exp(-distanceM / 600);
  return popularity * taste * proximity;
}

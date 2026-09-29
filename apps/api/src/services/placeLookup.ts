import { fromGeoJSONPoint, haversineM, type LatLng, type PinType } from '@itp/shared';
import type { Filter } from 'mongodb';
import type { AppContext } from '../context.ts';
import type { PlaceDoc } from '../db/placeTypes.ts';
import type { UserDoc } from '../db/types.ts';
import { violatesDislikes } from '../domain/taste.ts';
import { placeRank, places } from './places.ts';
import { genericOf } from './textExtract.ts';

/** New York City; a text never plans a stop outside it. */
const NYC: [[number, number], [number, number]] = [
  [-74.26, 40.49],
  [-73.7, 40.92],
];
/** Columbia's gate: where a plan with nothing else to go on starts. */
export const DEFAULT_ANCHOR: LatLng = { lat: 40.8075, lng: -73.9626 };
const GENERIC_RADIUS_M = 1200;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** What New Yorkers call places, by the names our data uses. Keys are normalized (see norm). */
const ALIASES: Record<string, string> = {
  met: 'The Metropolitan Museum of Art',
  'met museum': 'The Metropolitan Museum of Art',
  moma: 'Museum of Modern Art',
  amnh: 'American Museum of Natural History',
  'natural history museum': 'American Museum of Natural History',
  'high line': 'High Line',
  toms: "Tom's Restaurant",
  lerner: 'Alfred Lerner Hall',
  'lerner hall': 'Alfred Lerner Hall',
  butler: 'Butler Library',
};

/** Lowercase, no accents, no apostrophes, no leading "the": how names are compared. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A regex for a normalized name that also matches the stored spelling: an apostrophe (either style) may sit
 * between any two letters, spacing is free, and a short name must be a whole word ("met" ≠ "Metropolis").
 */
export function namePattern(q: string, wholeWord = q.length <= 5): string {
  const body = q
    .split(' ')
    .map((w) => [...w].map(escapeRegex).join("['’]?"))
    .join('\\s+');
  return wholeWord ? `\\b${body}\\b` : body;
}

/**
 * A venue named in a text: exact name first, then names starting with it, then containing it (then every word),
 * closest to the previous stop breaking ties. Only real places in our data: nothing is invented.
 */
export async function findByName(
  ctx: AppContext,
  query: string,
  near: LatLng | null,
): Promise<PlaceDoc | null> {
  const typed = norm(query);
  const q = norm(ALIASES[typed] ?? query);
  if (q.length < 2) return null;
  const inNyc = { loc: { $geoWithin: { $box: NYC } } } as Filter<PlaceDoc>;
  const words = q.split(' ').filter((w) => w.length > 1);
  const tries: Filter<PlaceDoc>[] = [
    { name: { $regex: namePattern(q), $options: 'i' } },
    ...(words.length > 1
      ? [{ $and: words.map((w) => ({ name: { $regex: namePattern(w, true), $options: 'i' } })) }]
      : []),
  ];
  for (const t of tries) {
    const found = await places(ctx.db)
      .find({ ...inNyc, ...t })
      .limit(60)
      .toArray();
    if (!found.length) continue;
    const score = (p: PlaceDoc) => {
      const n = norm(p.name);
      const exact = n === q ? 3 : n.startsWith(q) ? 2 : 1;
      const d = near ? haversineM(near, fromGeoJSONPoint(p.loc)) : 0;
      return exact * 1e6 - Math.min(d, 999_999) + Math.log1p(p.been);
    };
    return found.sort((a, b) => score(b) - score(a))[0]!;
  }
  return null;
}

/** A kind of place ("coffee", "a park"): the best one near the previous stop, in the person's taste. */
export async function findByKind(
  ctx: AppContext,
  query: string,
  category: PinType | null,
  near: LatLng | null,
  user: UserDoc,
  exclude: string[],
): Promise<PlaceDoc | null> {
  const g = genericOf(query);
  const cat = category ?? g?.category;
  if (!cat) return null;
  const at = near ?? DEFAULT_ANCHOR;
  const q: Filter<PlaceDoc> = {
    category: cat,
    _id: { $nin: exclude },
    loc: {
      $nearSphere: {
        $geometry: { type: 'Point', coordinates: [at.lng, at.lat] },
        $maxDistance: GENERIC_RADIUS_M,
      },
    },
  };
  if (!user.is21) q.adultOnly = { $ne: true };
  const found = (await places(ctx.db).find(q).limit(60).toArray()).filter(
    (p) => !violatesDislikes(user.dislikes, p.category, p.tags),
  );
  // "coffee" means a place tagged coffee when there is one; popularity only ranks within that.
  const want = new Set(g?.tags ?? []);
  const tagged = found.filter((p) => p.tags.some((t) => want.has(t)));
  const pool = tagged.length ? tagged : found;
  const score = (p: PlaceDoc) =>
    placeRank(p, user.prefVector, haversineM(at, fromGeoJSONPoint(p.loc)));
  return pool.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/**
 * Resolves each stop in order, anchoring each search at the stop before it. A name we don't have is asked of
 * Google Maps (its answer's first source is the venue's proper name) and looked up once more.
 */
export async function resolveStops(
  ctx: AppContext,
  stops: { query: string; kind: 'named' | 'generic'; category: PinType | null }[],
  user: UserDoc,
): Promise<{ places: PlaceDoc[]; missing: string[] }> {
  const out: PlaceDoc[] = [];
  const missing: string[] = [];
  let near: LatLng | null = null;
  for (const s of stops) {
    let p =
      s.kind === 'named'
        ? await findByName(ctx, s.query, near)
        : await findByKind(
            ctx,
            s.query,
            s.category,
            near,
            user,
            out.map((x) => x._id),
          );
    if (!p && s.kind === 'named' && ctx.providers.llm.name !== 'fake') {
      try {
        const maps = await ctx.providers.llm.askMaps(
          `What is the exact name of the place people call "${s.query}" in New York City?`,
          near ?? DEFAULT_ANCHOR,
        );
        const proper = maps.sources[0]?.title;
        if (proper) p = await findByName(ctx, proper, near);
      } catch (e) {
        console.warn(`[text-plan] maps lookup failed: ${(e as Error).message}`);
      }
    }
    if (!p && s.kind === 'named' && genericOf(s.query))
      p = await findByKind(
        ctx,
        s.query,
        null,
        near,
        user,
        out.map((x) => x._id),
      );
    if (!p || out.some((x) => x._id === p!._id)) {
      if (!p) missing.push(s.query);
      continue;
    }
    out.push(p);
    near = fromGeoJSONPoint(p.loc);
  }
  return { places: out, missing };
}

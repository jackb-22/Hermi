import {
  fromGeoJSONPoint,
  haversineM,
  type LatLng,
  latLngToTile,
  PIN_TYPES,
  type PinType,
  tileKey,
} from '@itp/shared';
import type { GhostsResponse } from '@itp/shared/api';
import type { Db, Filter } from 'mongodb';
import type { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { PlaceDoc } from '../db/placeTypes.ts';
import type { UserDoc } from '../db/types.ts';
import {
  fallbackLabel,
  GHOST_RADIUS_M,
  GHOSTS_RERANKED,
  GHOSTS_SHOWN,
  type GhostFactors,
  ghostScore,
  novelty,
  prefScore,
  type TransitionCounts,
  timeFit,
  transition,
  venueQuality,
} from '../domain/ghosts.ts';
import { sunTimes } from '../domain/sun.ts';
import { tasteMatch, violatesDislikes } from '../domain/taste.ts';
import type { DayForecast } from '../providers/weather.ts';
import { places, toPlace, WALK_M_PER_MIN } from './places.ts';

export interface GhostRequest {
  user: UserDoc;
  anchor: LatLng;
  anchorPlaceId?: string;
  anchorStopId?: string;
  /** Category of the last pin, for P(c | prev). */
  prev?: PinType;
  /** When you leave the anchor. */
  at: Date;
  exclude: string[];
  /** "Cafe (food)" per stop so far, for the model's context. */
  planSoFar: string[];
}

const nyDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const nyTime = (d: Date) =>
  d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<null>((r) => {
        timer = setTimeout(() => r(null), ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Observed consecutive-category counts from completed plans; cached per database for ten minutes. */
const transitionCache = new Map<string, { at: number; counts: TransitionCounts }>();
export async function transitionCounts(db: Db, now = Date.now()): Promise<TransitionCounts> {
  const hit = transitionCache.get(db.databaseName);
  if (hit && now - hit.at < 600_000) return hit.counts;
  const done = await db
    .collection<{
      status: string;
      completedAt?: Date;
      stops: { placeId?: string; slot?: { category: PinType } }[];
    }>('plans')
    .find({ status: 'completed' }, { projection: { 'stops.placeId': 1, 'stops.slot.category': 1 } })
    .sort({ completedAt: -1 })
    .limit(500)
    .toArray();
  const ids = [
    ...new Set(done.flatMap((p) => p.stops.flatMap((s) => (s.placeId ? [s.placeId] : [])))),
  ];
  const cat = new Map(
    (
      await places(db)
        .find({ _id: { $in: ids } }, { projection: { category: 1 } })
        .toArray()
    ).map((p) => [p._id, p.category]),
  );
  const counts: TransitionCounts = {};
  for (const p of done) {
    const cats = p.stops.map((s) => (s.placeId ? cat.get(s.placeId) : s.slot?.category));
    for (let i = 1; i < cats.length; i++) {
      const [a, b] = [cats[i - 1], cats[i]];
      if (!a || !b) continue;
      const row = counts[a] ?? {};
      counts[a] = row;
      row[b] = (row[b] ?? 0) + 1;
    }
  }
  transitionCache.set(db.databaseName, { at: now, counts });
  return counts;
}

/** Share of your check-ins and saved places per category: the "saves and check-ins" half of pref(c). */
async function categoryShare(ctx: AppContext, userId: string): Promise<Map<PinType, number>> {
  const [visits, saves] = await Promise.all([
    ctx.tiger.query<{ place_id: string; n: number }>(
      'select place_id, count(*)::int as n from checkins where user_id = $1 group by place_id order by n desc limit 300',
      [userId],
    ),
    ctx.db
      .collection<{ userId: string; type: string; refId: string }>('saves')
      .find({ userId, type: 'place' }, { projection: { refId: 1 } })
      .limit(300)
      .toArray(),
  ]);
  const weight = new Map<string, number>();
  for (const r of visits.rows) weight.set(r.place_id, r.n);
  for (const s of saves) weight.set(s.refId, (weight.get(s.refId) ?? 0) + 1);
  if (!weight.size) return new Map();
  const docs = await places(ctx.db)
    .find({ _id: { $in: [...weight.keys()] } }, { projection: { category: 1 } })
    .toArray();
  const byCat = new Map<PinType, number>();
  let total = 0;
  for (const d of docs) {
    const w = weight.get(d._id) ?? 0;
    byCat.set(d.category, (byCat.get(d.category) ?? 0) + w);
    total += w;
  }
  return new Map([...byCat].map(([c, w]) => [c, total ? w / total : 0]));
}

/** Tiles you have colored around the anchor (a 15-minute walk is about 11 tiles each way). */
async function visitedTiles(db: Db, userId: string, anchor: LatLng): Promise<Set<string>> {
  const t = latLngToTile(anchor);
  const r = 14;
  const rows = await db
    .collection<{ userId: string; x: number; y: number }>('user_tiles')
    .find(
      { userId, x: { $gte: t.x - r, $lte: t.x + r }, y: { $gte: t.y - r, $lte: t.y + r } },
      { projection: { _id: 0, x: 1, y: 1 } },
    )
    .toArray();
  return new Set(rows.map(tileKey));
}

/**
 * Ghost pins: code produces the candidates (best venue per category within a 15-minute walk, ranked by
 * score(c) = pref · time · P(c | prev) · (1 + novelty)); the model only re-ranks the top five and labels them,
 * so it cannot invent a place.
 */
export async function suggestGhosts(
  ctx: AppContext,
  req: GhostRequest,
): Promise<z.infer<typeof GhostsResponse>> {
  const { db, providers } = ctx;
  const { user, anchor, at } = req;
  const near = {
    $nearSphere: {
      $geometry: { type: 'Point', coordinates: [anchor.lng, anchor.lat] },
      $maxDistance: GHOST_RADIUS_M,
    },
  };
  const exclude = [...new Set([...req.exclude, ...(req.anchorPlaceId ? [req.anchorPlaceId] : [])])];

  const [byCategory, share, counts, visited, forecast] = await Promise.all([
    Promise.all(
      PIN_TYPES.map((category) => {
        const q: Filter<PlaceDoc> = { category, loc: near, _id: { $nin: exclude } };
        if (!user.is21) q.adultOnly = { $ne: true };
        return places(db).find(q).limit(40).toArray();
      }),
    ),
    categoryShare(ctx, user._id),
    transitionCounts(db),
    visitedTiles(db, user._id, anchor),
    withTimeout(providers.weather.daily(anchor), 2500),
  ]);

  const { sunset } = sunTimes(at, anchor);
  const today: DayForecast | undefined = forecast?.find((d) => d.date === nyDate(at));
  const rainy = (today?.precipChance ?? 0) >= 0.6;

  type Scored = {
    place: PlaceDoc;
    distanceM: number;
    walkMin: number;
    arrive: Date;
    factors: GhostFactors;
    score: number;
  };
  const best: Scored[] = [];
  for (const list of byCategory) {
    let top: (Scored & { pick: number }) | undefined;
    for (const p of list) {
      if (violatesDislikes(user.dislikes, p.category, p.tags)) continue;
      const loc = fromGeoJSONPoint(p.loc);
      const distanceM = haversineM(anchor, loc);
      const walkMin = Math.max(1, Math.round(distanceM / WALK_M_PER_MIN));
      const arrive = new Date(at.getTime() + walkMin * 60_000);
      const factors: GhostFactors = {
        pref: prefScore(tasteMatch(user.prefVector, p.tags), share.get(p.category) ?? 0),
        time: timeFit(p.category, p.tags, arrive, sunset, rainy),
        transition: transition(req.prev, p.category, counts),
        novelty: novelty(latLngToTile(loc), visited),
      };
      const score = ghostScore(factors);
      const pick = score * venueQuality({ ...p, distanceM });
      if (!top || pick > top.pick)
        top = { place: p, distanceM, walkMin, arrive, factors, score, pick };
    }
    if (top) best.push(top);
  }
  best.sort((a, b) => b.score - a.score);
  const shortlist = best.slice(0, GHOSTS_RERANKED);

  const weatherLine = today
    ? `${Math.round(today.highF)}°F high, ${Math.round(today.precipChance * 100)}% chance of rain`
    : 'weather unknown';
  const context = [
    `Leaving at ${nyTime(at)}; sunset ${nyTime(sunset)}; ${weatherLine}.`,
    req.planSoFar.length ? `Plan so far: ${req.planSoFar.join(' → ')}.` : 'This is the first stop.',
  ].join(' ');
  const ranked = shortlist.length
    ? await providers.llm.rerankGhosts(
        shortlist.map((s) => ({
          id: s.place._id,
          name: s.place.name,
          category: s.place.category,
          tags: s.place.tags,
          walkMin: s.walkMin,
          fallbackLabel: fallbackLabel({ ...s.place, at: s.arrive, sunset }),
        })),
        context,
      )
    : [];
  const byId = new Map(shortlist.map((s) => [s.place._id, s]));
  const round = (x: number) => Math.round(x * 1000) / 1000;

  return {
    items: ranked.slice(0, GHOSTS_SHOWN).flatMap(({ id, label }) => {
      const s = byId.get(id);
      if (!s) return [];
      return [
        {
          place: toPlace(s.place, { distanceM: s.distanceM, pref: user.prefVector }),
          category: s.place.category,
          label,
          walkMin: s.walkMin,
          distanceM: Math.round(s.distanceM),
          arriveAt: s.arrive.toISOString(),
          score: round(s.score),
          factors: {
            pref: round(s.factors.pref),
            time: round(s.factors.time),
            transition: round(s.factors.transition),
            novelty: round(s.factors.novelty),
          },
        },
      ];
    }),
    anchor: { loc: anchor, placeId: req.anchorPlaceId ?? null, stopId: req.anchorStopId ?? null },
    at: at.toISOString(),
    sunsetAt: sunset.toISOString(),
    weather: today ? { highF: today.highF, precipChance: today.precipChance } : null,
    rankedBy: providers.llm.name === 'fake' ? 'code' : 'gemini',
    fadeAfterSec: 10,
  };
}

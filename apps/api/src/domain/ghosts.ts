import { PIN_TYPES, type PinType, type Tag, type Tile, tileKey } from '@itp/shared';

/** A ghost sits on the best venue of its category within a 15-minute walk (80 m/min). */
export const GHOST_RADIUS_M = 1200;
export const GHOSTS_SHOWN = 3;
export const GHOSTS_RERANKED = 5;

// Built once: constructing a formatter costs ~20x formatting with one, and scoring calls this per candidate.
const NY_HM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** Local wall-clock hour in New York as a fraction, e.g. 19.5 for 7:30 PM. */
export function nyHour(d: Date): number {
  const parts = NY_HM.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') + get('minute') / 60;
}

const between = (h: number, a: number, b: number) => (a <= b ? h >= a && h < b : h >= a || h < b);

/**
 * time(c, t): a hand-written table. Coffee mornings, drinks after 6 pm, nature before sunset (golden hour
 * is the peak), museums in the day, music at night. Rain halves anything outdoors.
 */
export function timeFit(
  category: PinType,
  tags: readonly Tag[],
  at: Date,
  sunset: Date,
  rainy = false,
): number {
  const h = nyHour(at);
  const has = (t: Tag) => tags.includes(t);
  let f: number;
  switch (category) {
    case 'food': {
      const morning = has('coffee') || has('bakery') || has('brunch');
      if (between(h, 7, 11)) f = morning ? 1.1 : 0.7;
      else if (between(h, 11, 14.5)) f = 1;
      else if (between(h, 17.5, 21.5)) f = morning ? 0.4 : 1;
      else if (between(h, 21.5, 3)) f = has('late_night_food') || has('pizza') ? 1 : 0.35;
      else if (between(h, 3, 7)) f = 0.1;
      else f = morning ? 0.8 : 0.6;
      break;
    }
    case 'drinks':
      if (has('club')) f = between(h, 22, 3) ? 1.2 : between(h, 18, 22) ? 0.5 : 0.05;
      else f = between(h, 18, 2) ? 1 : between(h, 16, 18) ? 0.6 : between(h, 12, 16) ? 0.25 : 0.05;
      break;
    case 'nature': {
      const s = nyHour(sunset);
      if (h < 6) f = 0.1;
      else if (h >= s) f = 0.15;
      else if (h >= s - 1.5) f = has('waterfront') || has('park') ? 1.4 : 1.25;
      else f = 1;
      break;
    }
    case 'culture':
      if (has('theater')) f = between(h, 18.5, 23) ? 1 : 0.3;
      else if (has('street_art')) f = between(h, 8, 20) ? 1 : 0.4;
      else f = between(h, 10, 17) ? 1 : between(h, 17, 20) ? 0.5 : 0.1;
      break;
    case 'shopping':
      f = between(h, 11, 19) ? 1 : between(h, 10, 11) || between(h, 19, 21) ? 0.6 : 0.1;
      break;
    case 'sports':
      f = between(h, 7, 21) ? 0.8 : 0.2;
      break;
    case 'music':
      f = between(h, 19, 1) ? 1 : between(h, 17, 19) ? 0.5 : 0.15;
      break;
  }
  if (rainy) {
    if (category === 'nature' || has('outdoor') || has('beach') || has('waterfront')) f *= 0.5;
    else if (has('indoor')) f *= 1.1;
  }
  return f;
}

/**
 * Hand-made prior for P(next category | previous category); rows sum to 1.
 * Dinner then drinks then music; a walk then food; rarely the same category twice.
 */
export const TRANSITION_PRIOR: Record<PinType, Record<PinType, number>> = {
  food: {
    food: 0.03,
    shopping: 0.2,
    nature: 0.2,
    culture: 0.2,
    drinks: 0.2,
    sports: 0.07,
    music: 0.1,
  },
  shopping: {
    food: 0.3,
    shopping: 0.15,
    nature: 0.15,
    culture: 0.15,
    drinks: 0.15,
    sports: 0.03,
    music: 0.07,
  },
  nature: {
    food: 0.3,
    shopping: 0.1,
    nature: 0.08,
    culture: 0.17,
    drinks: 0.2,
    sports: 0.08,
    music: 0.07,
  },
  culture: {
    food: 0.3,
    shopping: 0.12,
    nature: 0.2,
    culture: 0.08,
    drinks: 0.18,
    sports: 0.02,
    music: 0.1,
  },
  drinks: {
    food: 0.25,
    shopping: 0.02,
    nature: 0.05,
    culture: 0.03,
    drinks: 0.25,
    sports: 0.02,
    music: 0.38,
  },
  sports: {
    food: 0.35,
    shopping: 0.05,
    nature: 0.15,
    culture: 0.05,
    drinks: 0.3,
    sports: 0.05,
    music: 0.05,
  },
  music: {
    food: 0.3,
    shopping: 0.02,
    nature: 0.05,
    culture: 0.03,
    drinks: 0.5,
    sports: 0.02,
    music: 0.08,
  },
};

/** Pseudo-count weight of the prior against observed transitions from completed plans. */
export const PRIOR_WEIGHT = 20;

export type TransitionCounts = Partial<Record<PinType, Partial<Record<PinType, number>>>>;

/**
 * P(c | prev): the prior, updated by consecutive stops in completed plans. Scaled by 7 so a neutral
 * transition is 1 and the product with the other factors stays readable. No previous pin: neutral.
 */
export function transition(
  prev: PinType | undefined,
  c: PinType,
  counts: TransitionCounts = {},
): number {
  if (!prev) return 1;
  const row = counts[prev] ?? {};
  const total = PIN_TYPES.reduce((a, k) => a + (row[k] ?? 0), 0);
  const p = (PRIOR_WEIGHT * TRANSITION_PRIOR[prev][c] + (row[c] ?? 0)) / (PRIOR_WEIGHT + total);
  return p * PIN_TYPES.length;
}

/** novelty(c): share of the 3×3 block of tiles around the venue you have never colored (0..1). */
export function novelty(t: Tile, visited: ReadonlySet<string>): number {
  let fresh = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      if (!visited.has(tileKey({ x: t.x + dx, y: t.y + dy }))) fresh++;
  return fresh / 9;
}

/**
 * pref(c): taste match of the venue's tags (from the deck), times how much of your saves and check-ins
 * fall in its category. Never zero, so a new user still gets suggestions.
 */
export function prefScore(taste: number, categoryShare: number): number {
  return Math.max(0.05, (1 + taste) / 2) * (1 + 0.5 * categoryShare);
}

/** Picks the venue inside a category; not part of score(c), which ranks the categories. */
export function venueQuality(p: {
  been: number;
  confidence: number;
  wouldGoAgain: { yes: number; total: number };
  distanceM: number;
}): number {
  const again = p.wouldGoAgain.total >= 3 ? p.wouldGoAgain.yes / p.wouldGoAgain.total - 0.5 : 0;
  return (
    (1 + 0.25 * Math.log1p(p.been) + 0.5 * p.confidence + again) * Math.exp(-p.distanceM / 2400)
  );
}

export interface GhostFactors {
  pref: number;
  time: number;
  transition: number;
  novelty: number;
}

/** score(c) = pref(c) · time(c, t) · P(c | c_prev) · (1 + novelty(c)) */
export const ghostScore = (f: GhostFactors) => f.pref * f.time * f.transition * (1 + f.novelty);

/** Deterministic label (six words or fewer) used when the model is unavailable. */
export function fallbackLabel(o: {
  name: string;
  category: PinType;
  tags: readonly Tag[];
  at: Date;
  sunset: Date;
}): string {
  const short = o.name.split(/\s+/).slice(0, 3).join(' ');
  const h = nyHour(o.at);
  const s = nyHour(o.sunset);
  if (o.category === 'nature' && h < s && h >= s - 1.5) return `Sunset at ${short}`;
  if (o.tags.includes('coffee') && h < 12) return `Coffee at ${short}`;
  const verb: Record<PinType, string> = {
    food: h >= 17 ? 'Dinner at' : 'A bite at',
    shopping: 'Browse',
    nature: 'Stroll through',
    culture: 'Wander into',
    drinks: 'Drinks at',
    sports: 'Play at',
    music: 'Live music at',
  };
  return `${verb[o.category]} ${short}`;
}

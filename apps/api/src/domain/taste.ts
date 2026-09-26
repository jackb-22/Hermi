import { type PinType, TAG_DIMS, type Tag, tagIndex } from '@itp/shared';

export function norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

export function cosine(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * (b[i] ?? 0);
  return dot / (na * nb);
}

export function tagVector(tags: readonly Tag[]): number[] {
  const v = new Array<number>(TAG_DIMS).fill(0);
  for (const t of tags) v[tagIndex(t)] = 1;
  return v;
}

/** Cosine between a user's preference vector and a place's tags; 0 when either is empty. */
export function tasteMatch(pref: number[] | undefined, tags: readonly Tag[]): number {
  if (!pref || tags.length === 0) return 0;
  return cosine(pref, tagVector(tags));
}

export interface Dislikes {
  categories: PinType[];
  tags: Tag[];
}

/** Dislikes are hard filters in recommendations and matching. */
export function violatesDislikes(
  d: Dislikes | undefined,
  category: PinType,
  tags: readonly Tag[],
): boolean {
  if (!d) return false;
  return d.categories.includes(category) || tags.some((t) => d.tags.includes(t));
}

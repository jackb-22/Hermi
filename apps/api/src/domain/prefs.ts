import { type PinType, TAGS, TAG_DIMS, TASTE_DECK, type Tag, tagIndex } from '@itp/shared';
import { norm } from './taste.ts';

/** Vibe tags are too broad to act as hard filters: disliking one outdoor card must not ban all outdoor places. */
const SOFT_TAGS: ReadonlySet<Tag> = new Set(['indoor', 'outdoor', 'cheap', 'splurge']);

export interface Swipe {
  cardId: string;
  liked: boolean;
}

export interface Prefs {
  prefVector: number[];
  likedTags: Tag[];
  dislikes: { categories: PinType[]; tags: Tag[] };
}

/**
 * Taste deck → preference vector (+1/−1 per tag, L2-normalized) and hard-filter dislikes.
 * A tag is disliked when its net score is negative; a category when every card of it that was shown got swiped left.
 */
export function buildPrefs(swipes: Swipe[], is21: boolean): Prefs {
  const cards = new Map(TASTE_DECK.map((c) => [c.id, c]));
  const raw = new Array<number>(TAG_DIMS).fill(0);
  const catSeen = new Map<PinType, { liked: number; total: number }>();
  for (const s of swipes) {
    const card = cards.get(s.cardId);
    if (!card || (card.requires21 && !is21)) continue;
    for (const t of card.tags) raw[tagIndex(t)]! += s.liked ? 1 : -1;
    const c = catSeen.get(card.category) ?? { liked: 0, total: 0 };
    c.total++;
    if (s.liked) c.liked++;
    catSeen.set(card.category, c);
  }
  const n = norm(raw);
  const prefVector = n ? raw.map((x) => x / n) : raw;
  const byTag = (pred: (x: number) => boolean) =>
    raw.flatMap((x, i) => (pred(x) ? [TAGS[i]!] : []));
  return {
    prefVector,
    likedTags: byTag((x) => x > 0),
    dislikes: {
      categories: [...catSeen].filter(([, c]) => c.total >= 1 && c.liked === 0).map(([k]) => k),
      tags: byTag((x) => x < 0).filter((t) => !SOFT_TAGS.has(t)),
    },
  };
}

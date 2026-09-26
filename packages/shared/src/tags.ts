export const PIN_TYPES = ['food', 'shopping', 'nature', 'culture', 'drinks', 'sports', 'music'] as const;
export type PinType = (typeof PIN_TYPES)[number];

/**
 * Tag vocabulary: one dimension per tag in prefVector and place tag vectors.
 * Order is part of the contract (vector index numDimensions = TAGS.length); append only.
 */
export const TAGS = [
  // food
  'coffee', 'bakery', 'brunch', 'pizza', 'ramen', 'tacos', 'late_night_food', 'food_market', 'dessert', 'fine_dining',
  // shopping
  'thrift', 'vintage', 'bookstore', 'record_store', 'fashion', 'flea_market',
  // nature
  'park', 'garden', 'waterfront', 'beach', 'trail', 'picnic',
  // culture
  'museum', 'gallery', 'library', 'history', 'street_art', 'theater',
  // drinks
  'rooftop_bar', 'cocktails', 'brewery', 'wine_bar', 'dive_bar', 'club',
  // sports
  'basketball', 'climbing', 'bowling', 'stadium', 'running', 'cycling',
  // music
  'live_jazz', 'concert', 'karaoke', 'open_mic',
  // vibe
  'outdoor', 'indoor', 'cheap', 'splurge',
] as const;
export type Tag = (typeof TAGS)[number];
export const TAG_DIMS = TAGS.length; // 48
export const tagIndex = (t: Tag) => TAGS.indexOf(t);

export const CATEGORY_DEFAULT_TAGS: Record<PinType, Tag[]> = {
  food: ['coffee', 'brunch', 'pizza', 'food_market', 'indoor'],
  shopping: ['thrift', 'bookstore', 'record_store', 'indoor'],
  nature: ['park', 'garden', 'waterfront', 'outdoor'],
  culture: ['museum', 'gallery', 'library', 'indoor'],
  drinks: ['cocktails', 'brewery', 'wine_bar', 'rooftop_bar'],
  sports: ['basketball', 'climbing', 'bowling', 'outdoor'],
  music: ['live_jazz', 'concert', 'karaoke'],
};

/** Default stay length per category (minutes), used until the AI upgrades it. */
export const DEFAULT_STAY_MIN: Record<PinType, number> = {
  food: 60,
  shopping: 40,
  nature: 45,
  culture: 90,
  drinks: 75,
  sports: 90,
  music: 120,
};

export interface TasteCard {
  id: string;
  title: string;
  category: PinType;
  tags: Tag[];
  /** Only shown / applied for users who confirm 21+. */
  requires21?: boolean;
}

export const TASTE_DECK: TasteCard[] = [
  { id: 'live_jazz', title: 'Live jazz', category: 'music', tags: ['live_jazz', 'concert', 'indoor'] },
  { id: 'rooftop_bars', title: 'Rooftop bars', category: 'drinks', tags: ['rooftop_bar', 'cocktails', 'outdoor'], requires21: true },
  { id: 'thrift_stores', title: 'Thrift stores', category: 'shopping', tags: ['thrift', 'vintage', 'cheap'] },
  { id: 'galleries', title: 'Galleries', category: 'culture', tags: ['gallery', 'street_art'] },
  { id: 'pickup_basketball', title: 'Pickup basketball', category: 'sports', tags: ['basketball', 'outdoor', 'cheap'] },
  { id: 'late_night_food', title: 'Late-night food', category: 'food', tags: ['late_night_food', 'pizza', 'tacos', 'cheap'] },
  { id: 'botanical_gardens', title: 'Botanical gardens', category: 'nature', tags: ['garden', 'park', 'outdoor'] },
  { id: 'karaoke', title: 'Karaoke', category: 'music', tags: ['karaoke', 'indoor'] },
  { id: 'coffee_mornings', title: 'Coffee mornings', category: 'food', tags: ['coffee', 'bakery', 'brunch'] },
  { id: 'bookstores', title: 'Bookstores', category: 'shopping', tags: ['bookstore', 'library', 'indoor'] },
  { id: 'waterfront_walks', title: 'Waterfront walks', category: 'nature', tags: ['waterfront', 'running', 'outdoor'] },
  { id: 'museums', title: 'Museums', category: 'culture', tags: ['museum', 'history', 'indoor'] },
  { id: 'climbing_gyms', title: 'Climbing gyms', category: 'sports', tags: ['climbing', 'indoor'] },
  { id: 'food_markets', title: 'Food markets', category: 'food', tags: ['food_market', 'flea_market', 'outdoor'] },
  { id: 'record_stores', title: 'Record stores', category: 'shopping', tags: ['record_store', 'vintage'] },
  { id: 'open_mics', title: 'Open mics', category: 'music', tags: ['open_mic', 'theater', 'cheap'] },
];

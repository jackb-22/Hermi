import type { PinType, Tag } from '@itp/shared';

interface Mapped {
  category: PinType;
  tags: Tag[];
  /** Bars and clubs: hidden from users who have not confirmed 21+. */
  adultOnly?: boolean;
}

const m = (category: PinType, tags: Tag[], adultOnly = false): Mapped => ({ category, tags, adultOnly });

/** Overture taxonomy.primary → one of the seven pin types, plus tags from the shared vocabulary. */
const BY_PRIMARY: Record<string, Mapped> = {
  // food
  coffee_shop: m('food', ['coffee', 'indoor']),
  coffee_roastery: m('food', ['coffee', 'indoor']),
  cafe: m('food', ['coffee', 'brunch', 'indoor']),
  bakery: m('food', ['bakery', 'coffee']),
  bagel_shop: m('food', ['bakery', 'brunch', 'cheap']),
  donut_shop: m('food', ['bakery', 'dessert', 'cheap']),
  diner: m('food', ['brunch', 'late_night_food', 'cheap']),
  breakfast_and_brunch_restaurant: m('food', ['brunch']),
  pizza_restaurant: m('food', ['pizza', 'late_night_food', 'cheap']),
  ramen_restaurant: m('food', ['ramen']),
  taco_restaurant: m('food', ['tacos', 'cheap']),
  mexican_restaurant: m('food', ['tacos']),
  fast_food_restaurant: m('food', ['late_night_food', 'cheap']),
  delicatessen: m('food', ['late_night_food', 'cheap']),
  sandwich_shop: m('food', ['cheap']),
  ice_cream_shop: m('food', ['dessert']),
  dessert_shop: m('food', ['dessert']),
  chocolatier: m('food', ['dessert', 'splurge']),
  cupcake_shop: m('food', ['dessert']),
  frozen_yogurt_shop: m('food', ['dessert', 'cheap']),
  farmers_market: m('food', ['food_market', 'outdoor']),
  night_market: m('food', ['food_market', 'late_night_food', 'outdoor']),
  food_court: m('food', ['food_market', 'cheap']),
  specialty_foods_store: m('food', ['food_market']),
  french_restaurant: m('food', ['fine_dining', 'splurge']),
  steakhouse: m('food', ['fine_dining', 'splurge']),
  // shopping
  clothing_store: m('shopping', ['fashion', 'indoor']),
  womens_clothing_store: m('shopping', ['fashion']),
  mens_clothing_store: m('shopping', ['fashion']),
  fashion_boutique: m('shopping', ['fashion']),
  designer_clothing: m('shopping', ['fashion', 'splurge']),
  shoe_store: m('shopping', ['fashion']),
  second_hand_store: m('shopping', ['thrift', 'vintage', 'cheap']),
  second_hand_clothing_store: m('shopping', ['thrift', 'vintage', 'fashion', 'cheap']),
  antique_store: m('shopping', ['vintage']),
  flea_market: m('shopping', ['flea_market', 'thrift', 'outdoor']),
  bookstore: m('shopping', ['bookstore', 'indoor']),
  used_bookstore: m('shopping', ['bookstore', 'thrift', 'cheap']),
  academic_bookstore: m('shopping', ['bookstore']),
  comic_books_store: m('shopping', ['bookstore']),
  vinyl_record_store: m('shopping', ['record_store', 'vintage']),
  music_and_dvd_store: m('shopping', ['record_store']),
  // nature
  park: m('nature', ['park', 'outdoor', 'picnic']),
  state_park: m('nature', ['park', 'trail', 'outdoor']),
  botanical_garden: m('nature', ['garden', 'outdoor']),
  community_garden: m('nature', ['garden', 'outdoor']),
  beach: m('nature', ['beach', 'waterfront', 'outdoor']),
  hiking_trail: m('nature', ['trail', 'outdoor']),
  pier: m('nature', ['waterfront', 'outdoor']),
  // culture
  museum: m('culture', ['museum', 'indoor']),
  art_museum: m('culture', ['museum', 'gallery', 'indoor']),
  history_museum: m('culture', ['museum', 'history', 'indoor']),
  design_museum: m('culture', ['museum', 'indoor']),
  contemporary_art_museum: m('culture', ['museum', 'gallery', 'indoor']),
  childrens_museum: m('culture', ['museum', 'indoor']),
  art_gallery: m('culture', ['gallery', 'indoor']),
  library: m('culture', ['library', 'indoor', 'cheap']),
  historic_site: m('culture', ['history', 'outdoor']),
  theatre_venue: m('culture', ['theater', 'indoor']),
  comedy_club: m('culture', ['theater', 'open_mic', 'indoor']),
  movie_theater: m('culture', ['theater', 'indoor']),
  // drinks (adult)
  bar: m('drinks', ['cocktails'], true),
  cocktail_bar: m('drinks', ['cocktails'], true),
  speakeasy: m('drinks', ['cocktails', 'splurge'], true),
  hotel_bar: m('drinks', ['cocktails', 'splurge'], true),
  lounge: m('drinks', ['cocktails'], true),
  wine_bar: m('drinks', ['wine_bar'], true),
  winery: m('drinks', ['wine_bar'], true),
  pub: m('drinks', ['brewery', 'dive_bar'], true),
  irish_pub: m('drinks', ['brewery', 'dive_bar'], true),
  sports_bar: m('drinks', ['brewery'], true),
  beer_bar: m('drinks', ['brewery'], true),
  gastropub: m('drinks', ['brewery'], true),
  brewery: m('drinks', ['brewery'], true),
  beer_garden: m('drinks', ['brewery', 'outdoor'], true),
  dive_bar: m('drinks', ['dive_bar', 'cheap'], true),
  dance_club: m('drinks', ['club'], true),
  nightlife_venue: m('drinks', ['club'], true),
  rooftop_bar: m('drinks', ['rooftop_bar', 'cocktails', 'outdoor'], true),
  // drinks (all ages: what under-21 users see under the Drinks pin)
  bubble_tea: m('drinks', ['cheap']),
  juice_bar: m('drinks', ['cheap']),
  tea_room: m('drinks', ['indoor']),
  // sports
  basketball_court: m('sports', ['basketball', 'outdoor', 'cheap']),
  tennis_court: m('sports', ['outdoor']),
  rock_climbing_spot: m('sports', ['climbing', 'indoor']),
  rock_climbing_gym: m('sports', ['climbing', 'indoor']),
  bowling_alley: m('sports', ['bowling', 'indoor']),
  stadium_arena: m('sports', ['stadium']),
  stadium: m('sports', ['stadium']),
  baseball_stadium: m('sports', ['stadium', 'outdoor']),
  football_stadium: m('sports', ['stadium', 'outdoor']),
  basketball_stadium: m('sports', ['stadium', 'basketball']),
  track_stadium: m('sports', ['stadium', 'running', 'outdoor']),
  pool_billiards: m('sports', ['indoor']),
  pool_hall: m('sports', ['indoor']),
  skate_park: m('sports', ['outdoor']),
  ice_skating_rink: m('sports', ['indoor']),
  // music
  music_venue: m('music', ['concert', 'indoor']),
  jazz_and_blues_venue: m('music', ['live_jazz', 'concert', 'indoor']),
  karaoke_venue: m('music', ['karaoke', 'indoor']),
  opera_and_ballet: m('music', ['concert', 'splurge']),
};

/** Fallbacks by Overture basic_category when the taxonomy primary is not listed. */
const BY_BASIC: Record<string, Mapped> = {
  restaurant: m('food', ['indoor']),
  casual_eatery: m('food', ['cheap']),
  cafe: m('food', ['coffee']),
  coffee_shop: m('food', ['coffee']),
  bar: m('drinks', ['cocktails'], true),
  museum: m('culture', ['museum', 'indoor']),
  music_venue: m('music', ['concert']),
};

export function mapOvertureCategory(primary?: string | null, basic?: string | null): Mapped | null {
  if (primary && BY_PRIMARY[primary]) return BY_PRIMARY[primary]!;
  if (primary?.endsWith('_restaurant')) return m('food', ['indoor']);
  if (primary?.endsWith('_museum')) return m('culture', ['museum', 'indoor']);
  if (basic && BY_BASIC[basic]) return BY_BASIC[basic]!;
  return null;
}

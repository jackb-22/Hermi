/** XP table from the plan. Presence is the only currency: posting, reviewing and saving earn 0. */
export const XP = {
  checkinGps: 10,
  checkinTag: 15,
  firstVisit: 10,
  newTile: 2,
  perKmOnFootOrBike: 5,
  completedPlan: 20,
  fullParty: 25,
  firstPlanWithSomeoneNew: 20,
} as const;

export const XP_KINDS = [
  'checkin_gps',
  'checkin_tag',
  'first_visit',
  'tiles',
  'distance',
  'completed_plan',
  'full_party',
  'new_person',
] as const;
export type XpKind = (typeof XP_KINDS)[number];

export const SCORE_WINDOW_DAYS = 30;
/** One check-in per user per venue per this many hours. */
export const CHECKIN_COOLDOWN_H = 6;
export const COMPLETED_PLAN_MIN_STOPS = 2;

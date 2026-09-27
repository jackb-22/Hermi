import {
  COMPLETED_PLAN_MIN_STOPS,
  DEFAULT_STAY_MIN,
  haversineM,
  type LatLng,
  type PinType,
  XP,
} from '@itp/shared';

export const MODES = ['walk', 'transit', 'bike', 'car'] as const;
export type Mode = (typeof MODES)[number];

/** Straight lines understate city routes. */
const DETOUR = 1.3;
const SPEED_M_PER_MIN: Record<Mode, number> = { walk: 80, bike: 250, transit: 400, car: 350 };
const OVERHEAD_MIN: Record<Mode, number> = { walk: 0, bike: 2, transit: 6, car: 4 };

export const STAY_MIN = 5;
export const STAY_MAX = 240;
export const clampStay = (m: number) => Math.min(STAY_MAX, Math.max(STAY_MIN, Math.round(m)));

/** Offline leg estimate used until a real ETA arrives: the plan is never unscheduled. */
export function estimateLegMin(a: LatLng, b: LatLng, mode: Mode): number {
  const m = haversineM(a, b) * DETOUR;
  if (m < 1) return 0;
  return Math.max(1, Math.round(OVERHEAD_MIN[mode] + m / SPEED_M_PER_MIN[mode]));
}

export const defaultStay = (category: PinType) => DEFAULT_STAY_MIN[category];

export interface SchedStop {
  id: string;
  loc: LatLng;
  category: PinType;
  name: string;
  stayMin: number;
  /** Mode and minutes of the leg arriving at this stop; ignored for the first stop. */
  legMode: Mode;
  legMin: number;
  hours?: { day: number; open: string; close: string }[];
  isSlot: boolean;
}

export interface Timed {
  arriveAt: Date;
  departAt: Date;
}

/** Arrival and departure times from start time, stays and legs. Pure arithmetic: the model never computes times. */
export function assemble(startAt: Date, stops: SchedStop[]): Timed[] {
  const out: Timed[] = [];
  let t = startAt.getTime();
  stops.forEach((s, i) => {
    if (i > 0) t += s.legMin * 60_000;
    const arriveAt = new Date(t);
    t += s.stayMin * 60_000;
    out.push({ arriveAt, departAt: new Date(t) });
  });
  return out;
}

export type IssueCode =
  | 'CLOSES_BEFORE_STAY_ENDS'
  | 'OPENS_AFTER_ARRIVAL'
  | 'ENDS_AFTER_END_TIME'
  | 'UNFILLED_SLOT';
export interface Issue {
  stopId: string;
  code: IssueCode;
  message: string;
}

const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Local wall-clock minutes and weekday in New York for comparing against opening hours. */
function localMinutes(d: Date): { day: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, min: Number(get('hour')) * 60 + Number(get('minute')) };
}

const DAY_MIN = 24 * 60;
const WEEK_MIN = 7 * DAY_MIN;

/**
 * Whether a stay fits inside the opening hours, in minutes of the week. A period whose close is not after its
 * open runs past midnight (a bar open 18:00–02:00; 00:00–00:00 is open all day), and Saturday-night periods
 * carry into Sunday morning.
 */
function stayFits(hours: NonNullable<SchedStop['hours']>, day: number, min: number, stay: number) {
  const a = day * DAY_MIN + min;
  return hours.some((h) => {
    const open = h.day * DAY_MIN + hm(h.open);
    const close = h.day * DAY_MIN + hm(h.close) + (hm(h.close) <= hm(h.open) ? DAY_MIN : 0);
    return [a, a + WEEK_MIN].some((s) => open <= s && s + stay <= close);
  });
}

/** Every arrival must leave at least the stay before closing, and the plan must end before the user's end time. */
export function validate(stops: SchedStop[], times: Timed[], endBy?: Date): Issue[] {
  const issues: Issue[] = [];
  stops.forEach((s, i) => {
    const t = times[i]!;
    if (s.isSlot)
      issues.push({ stopId: s.id, code: 'UNFILLED_SLOT', message: `Pick a ${s.category} spot` });
    if (s.hours?.length) {
      const { day, min } = localMinutes(t.arriveAt);
      if (!stayFits(s.hours, day, min, s.stayMin)) {
        const openNow = stayFits(s.hours, day, min, 0);
        const later = s.hours
          .filter((h) => h.day === day && hm(h.open) > min)
          .sort((x, y) => hm(x.open) - hm(y.open))[0];
        issues.push(
          !openNow && later
            ? {
                stopId: s.id,
                code: 'OPENS_AFTER_ARRIVAL',
                message: `${s.name} opens at ${later.open}`,
              }
            : {
                stopId: s.id,
                code: 'CLOSES_BEFORE_STAY_ENDS',
                message:
                  openNow || s.hours.some((h) => h.day === day)
                    ? `${s.name} closes before your stay ends`
                    : `${s.name} is closed that day`,
              },
        );
      }
    }
  });
  const last = times.at(-1);
  if (endBy && last && last.departAt > endBy) {
    issues.push({
      stopId: stops.at(-1)!.id,
      code: 'ENDS_AFTER_END_TIME',
      message: 'Plan runs past your end time',
    });
  }
  return issues;
}

export interface Totals {
  km: number;
  footKm: number;
  legMin: number;
  xpPreview: number;
  endsAt: Date | null;
}

/** "+140 XP · 4.2 km on foot": check-ins at every stop, completion bonus, and distance on foot or bike. */
export function totals(stops: SchedStop[], times: Timed[]): Totals {
  let m = 0;
  let foot = 0;
  let legMin = 0;
  for (let i = 1; i < stops.length; i++) {
    const d = haversineM(stops[i - 1]!.loc, stops[i]!.loc) * DETOUR;
    m += d;
    if (stops[i]!.legMode === 'walk' || stops[i]!.legMode === 'bike') foot += d;
    legMin += stops[i]!.legMin;
  }
  const footKm = foot / 1000;
  const xpPreview =
    stops.length * XP.checkinGps +
    (stops.length >= COMPLETED_PLAN_MIN_STOPS ? XP.completedPlan : 0) +
    Math.round(footKm * XP.perKmOnFootOrBike);
  return {
    km: Math.round(m / 100) / 10,
    footKm: Math.round(footKm * 10) / 10,
    legMin,
    xpPreview,
    endsAt: times.at(-1)?.departAt ?? null,
  };
}

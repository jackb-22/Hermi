import type { PinType, Tag } from '@itp/shared';
import type { DayForecast } from '../providers/weather.ts';

const OUTDOOR_TAGS: ReadonlySet<Tag> = new Set([
  'outdoor',
  'park',
  'garden',
  'waterfront',
  'beach',
  'trail',
  'picnic',
  'running',
  'cycling',
  'street_art',
  'flea_market',
  'rooftop_bar',
]);

export const isOutdoor = (category: PinType, tags: readonly Tag[]) =>
  category === 'nature' || tags.some((t) => OUTDOOR_TAGS.has(t));

/** Share of the plan's stops that are outdoors (0..1). */
export function outdoorShare(stops: { category: PinType; tags: readonly Tag[] }[]): number {
  if (!stops.length) return 0;
  return stops.filter((s) => isOutdoor(s.category, s.tags)).length / stops.length;
}

/**
 * Best weather day: each day scored by the plan's outdoor share against rain chance, wind and distance from
 * 65–75 °F. An all-indoor plan still cares a little (you walk between stops). Ties go to the earliest day.
 */
export function scoreDay(d: DayForecast, share: number): number {
  const weight = 0.3 + 0.7 * share;
  const tempOff = d.highF < 65 ? 65 - d.highF : d.highF > 75 ? d.highF - 75 : 0;
  const penalty =
    0.6 * d.precipChance + 0.2 * Math.min(1, d.windMph / 25) + 0.2 * Math.min(1, tempOff / 20);
  return Math.round((1 - weight * penalty) * 1000) / 1000;
}

export function bestDay(
  days: DayForecast[],
  share: number,
  fromDate: string,
): { day: DayForecast; score: number } | null {
  let best: { day: DayForecast; score: number } | null = null;
  for (const day of days) {
    if (day.date < fromDate) continue;
    const score = scoreDay(day, share);
    if (!best || score > best.score) best = { day, score };
  }
  return best;
}

/** The UTC instant of a New York wall-clock time on a date (DST-safe). */
export function nyLocalToUtc(date: string, hour: number, minute: number): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  const offsetMin = (at: number) => {
    const tz = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'shortOffset',
    })
      .formatToParts(new Date(at))
      .find((p) => p.type === 'timeZoneName')!.value; // "GMT-4"
    const [, sign, hh, mm] = /GMT([+-])(\d+)(?::(\d+))?/.exec(tz) ?? [];
    return sign ? (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm ?? 0)) : 0;
  };
  // Two passes settle the offset on either side of a DST switch.
  let t = naive - offsetMin(naive) * 60_000;
  t = naive - offsetMin(t) * 60_000;
  return new Date(t);
}

/** New York local date and time of an instant: { date: 'YYYY-MM-DD', hour, minute }. */
export function nyLocal(at: Date): { date: string; hour: number; minute: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    hour: Number(g('hour')),
    minute: Number(g('minute')),
  };
}

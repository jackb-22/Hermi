/** Streak weeks run Monday to Sunday in the app's home timezone. */
export const HOME_TZ = 'America/New_York';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Local calendar date as YYYY-MM-DD. */
export const localDayKey = (d: Date, tz = HOME_TZ): string => fmt(tz).format(d);

const epochDays = (dayKey: string) => Math.floor(Date.parse(`${dayKey}T00:00:00Z`) / 86_400_000);

/** Monotonic week number (Monday-based) of the local date; consecutive weeks differ by exactly 1. */
export function weekIndex(d: Date, tz = HOME_TZ): number {
  // 1970-01-01 was a Thursday: shifting by 3 puts Mondays on multiples of 7.
  return Math.floor((epochDays(localDayKey(d, tz)) + 3) / 7);
}

/** Monday of the local week, YYYY-MM-DD; human-readable form of weekIndex. */
export function weekKey(d: Date, tz = HOME_TZ): string {
  const monday = weekIndex(d, tz) * 7 - 3;
  return new Date(monday * 86_400_000).toISOString().slice(0, 10);
}

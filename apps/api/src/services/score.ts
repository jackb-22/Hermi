import { SCORE_WINDOW_DAYS } from '@itp/shared';
import type pg from 'pg';

const DAY = 86_400_000;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Score(u, t) = Σ XP over the last 30 days, read from the xp_daily rollup (real-time aggregation on). */
export async function scoreAt(
  tiger: pg.Pool,
  userIds: string[],
  at: Date,
): Promise<Map<string, number>> {
  const { rows } = await tiger.query<{ user_id: string; xp: number }>(
    `select user_id, sum(xp)::int as xp from xp_daily where user_id = any($1) and day > $2 and day <= $3 group by user_id`,
    [userIds, new Date(at.getTime() - SCORE_WINDOW_DAYS * DAY), at],
  );
  return new Map(rows.map((r) => [r.user_id, r.xp]));
}

export async function campusScores(tiger: pg.Pool, campus: string, at: Date) {
  const { rows } = await tiger.query<{ user_id: string; xp: number }>(
    `select user_id, sum(xp)::int as xp from xp_daily where campus = $1 and day > $2 and day <= $3 group by user_id order by xp desc`,
    [campus, new Date(at.getTime() - SCORE_WINDOW_DAYS * DAY), at],
  );
  return rows;
}

export async function daily(tiger: pg.Pool, userId: string, at: Date) {
  const { rows } = await tiger.query<{ day: Date; xp: number }>(
    `select day, sum(xp)::int as xp from xp_daily where user_id = $1 and day > $2 and day <= $3 group by day`,
    [userId, new Date(at.getTime() - SCORE_WINDOW_DAYS * DAY), at],
  );
  const byDay = new Map(rows.map((r) => [utcDay(r.day), r.xp]));
  // xp_daily buckets are UTC days; index 0 is the oldest day still in the window.
  const today = Date.parse(`${utcDay(at)}T00:00:00Z`);
  return Array.from({ length: SCORE_WINDOW_DAYS }, (_, i) => {
    const day = utcDay(new Date(today - (SCORE_WINDOW_DAYS - 1 - i) * DAY));
    return { day, xp: byDay.get(day) ?? 0 };
  });
}

/** 1-based dense-ish rank (ties share the better rank) of `me` in a score list. */
export function rankOf(scores: { id: string; score: number }[], me: string) {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const mine = sorted.find((s) => s.id === me)?.score ?? 0;
  return { rank: sorted.filter((s) => s.score > mine).length + 1, of: sorted.length };
}

/** "−40 expiring Sunday": the 7 oldest bars leave the window within a week; `by` is when the 7th one does. */
export function expiring(spark: { day: string; xp: number }[]) {
  const xp = spark.slice(0, 7).reduce((a, b) => a + b.xp, 0);
  const by = utcDay(new Date(Date.parse(`${spark[6]!.day}T00:00:00Z`) + SCORE_WINDOW_DAYS * DAY));
  return { xp, by };
}

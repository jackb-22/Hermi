import { localDayKey, weekIndex } from '@itp/shared';

export interface StreakState {
  hangouts: number;
  streakWeeks: number;
  lastHangoutWeek: number;
  lastHangoutDay?: string;
}

export type HangoutOutcome = 'counted' | 'already_today';

/**
 * One hangout per pair per day counts. Same week as the last hangout: streak unchanged;
 * the week right after: +1; anything older: restarts at 1. Weeks run Monday–Sunday, New York time.
 */
export function applyHangout(
  s: StreakState,
  at: Date,
): { state: StreakState; outcome: HangoutOutcome } {
  const day = localDayKey(at);
  if (s.lastHangoutDay === day) return { state: s, outcome: 'already_today' };
  const week = weekIndex(at);
  const streakWeeks =
    week === s.lastHangoutWeek
      ? s.streakWeeks
      : week === s.lastHangoutWeek + 1
        ? s.streakWeeks + 1
        : 1;
  return {
    state: { hangouts: s.hangouts + 1, streakWeeks, lastHangoutWeek: week, lastHangoutDay: day },
    outcome: 'counted',
  };
}

export function newStreak(at: Date): StreakState {
  return {
    hangouts: 1,
    streakWeeks: 1,
    lastHangoutWeek: weekIndex(at),
    lastHangoutDay: localDayKey(at),
  };
}

/** Displayed streak: live if the last hangout was this week or last week, else 0; the flame is lit once this week is logged. No nightly job needed. */
export function displayStreak(
  s: StreakState,
  now: Date,
): { weeks: number; lit: boolean; endsThisWeek: boolean } {
  const w = weekIndex(now);
  const live = s.lastHangoutWeek >= w - 1;
  return {
    weeks: live ? s.streakWeeks : 0,
    lit: s.lastHangoutWeek === w,
    endsThisWeek: live && s.lastHangoutWeek === w - 1,
  };
}

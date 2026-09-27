import { weekIndex, weekKey } from '@itp/shared';
import type { AppContext } from '../context.ts';
import type { UserDoc } from '../db/types.ts';
import { displayStreak } from '../domain/streak.ts';
import { nyLocal, nyLocalToUtc } from '../domain/weatherDay.ts';
import { enqueue, type JobDoc } from '../jobs/queue.ts';
import type { PushMessage } from '../providers/push.ts';
import { notify } from './notify.ts';
import { computeScore } from './score.ts';
import { sessions } from './sessions.ts';
import { friendships } from './social.ts';
import { users } from './users.ts';

const DAY = 86_400_000;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The next Friday 3 PM in New York strictly after `now`. */
export function nextFridayAfternoon(now: Date): Date {
  const today = nyLocal(now).date;
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  let at = nyLocalToUtc(addDays(today, (5 - dow + 7) % 7), 15, 0);
  if (at <= now) at = nyLocalToUtc(addDays(today, ((5 - dow + 7) % 7) + 7), 15, 0);
  return at;
}

/** 10 AM New York on the day after `at`. */
export const nextMorning = (at: Date) => nyLocalToUtc(addDays(nyLocal(at).date, 1), 10, 0);

/** Keeps exactly one weekly nudge queued (called when a worker starts, and by each run for the next week). */
export async function scheduleWeeklyNudge(ctx: AppContext) {
  const runAt = nextFridayAfternoon(ctx.clock.now());
  await enqueue(ctx, 'weekly_nudge', {}, { runAt, dedupeKey: `weekly_nudge:${weekKey(runAt)}` });
}

/**
 * The one weekly notification: the streak closest to lapsing ("Your 8-week streak with Maya ends Sunday"; tapping
 * opens a new plan with Maya invited), else the XP about to leave the 30-day window. Nothing to say, no push.
 */
export async function nudgeFor(ctx: AppContext, u: UserDoc): Promise<PushMessage | null> {
  const now = ctx.clock.now();
  const pairs = await friendships(ctx.db)
    .find({ $or: [{ a: u._id }, { b: u._id }] })
    .toArray();
  const lapsing = pairs
    .map((f) => ({ friendId: f.a === u._id ? f.b : f.a, s: displayStreak(f, now) }))
    .filter((x) => x.s.endsThisWeek && x.s.weeks > 0)
    .sort((a, b) => b.s.weeks - a.s.weeks);
  for (const l of lapsing) {
    const friend = await users(ctx.db).findOne({ _id: l.friendId, deletedAt: { $exists: false } });
    if (!friend) continue;
    const name =
      friend.name?.split(' ')[0] ?? (friend.username ? `@${friend.username}` : 'your friend');
    return {
      title: `Your ${l.s.weeks}-week streak with ${name} ends Sunday`,
      body: 'Make a plan to keep it going.',
      data: { kind: 'streak_nudge', friendId: friend._id },
    };
  }
  const score = await computeScore(ctx, u);
  if (score.expiring.xp > 0) {
    const day = new Date(`${score.expiring.by}T12:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    });
    return {
      title: `${score.expiring.xp} XP expires ${day}. Plans?`,
      body: 'Go somewhere new before it leaves your score.',
      data: { kind: 'xp_expiring' },
    };
  }
  return null;
}

/** Job: Friday afternoon, at most one nudge per person per week; then queue next Friday's run. */
export async function weeklyNudge(
  ctx: AppContext,
  payload: { userId?: string; force?: boolean },
  _job?: JobDoc,
) {
  const now = ctx.clock.now();
  const week = weekIndex(now);
  const list = await users(ctx.db)
    .find({
      ...(payload.userId ? { _id: payload.userId } : {}),
      pushTokens: { $exists: true, $ne: [] },
      deletedAt: { $exists: false },
    })
    .toArray();
  for (const u of list) {
    if (!payload.force && u.lastNudgeWeek === week) continue;
    const msg = await nudgeFor(ctx, u);
    if (!msg) continue;
    await notify(ctx, [u._id], msg);
    await users(ctx.db).updateOne({ _id: u._id }, { $set: { lastNudgeWeek: week } });
  }
  // The scheduled run queues next Friday's; a forced dev run does not.
  if (!payload.userId && !payload.force) await scheduleWeeklyNudge(ctx);
}

/** Job: the morning after a session, one push if any checked-in stop is still unreviewed. */
export async function reviewReminder(
  ctx: AppContext,
  payload: { sessionId: string },
  _job?: JobDoc,
) {
  const s = await sessions(ctx.db).findOne({ _id: payload.sessionId });
  const open = s?.recap?.stops.filter((st) => !st.reviewed) ?? [];
  if (!s || !open.length) return;
  const first = open[0]!.placeName;
  await notify(ctx, [s.userId], {
    title:
      open.length === 1 ? `How was ${first}?` : `How were ${first} and ${open.length - 1} more?`,
    body: 'Would you go again? One tap.',
    data: { kind: 'review_reminder', sessionId: s._id },
  });
}

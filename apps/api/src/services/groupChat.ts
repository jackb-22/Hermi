import { newId } from '@itp/shared';
import type { AppContext } from '../context.ts';
import type { InboundMessage } from '../providers/messenger.ts';
import type { CheckinHook } from './checkins.ts';
import { places } from './places.ts';
import { loadPlaces, type PlanDoc, plans, toSchedStops } from './plans.ts';
import { users } from './users.ts';

const TOKEN_RE = /\/p\/([A-Za-z0-9_-]{8,})/;
const IN_RE = /^\s*(i'?m\s+in|in|count me in|yes|i'?ll come)\b/i;

const nyTime = (d: Date, withDay = false) =>
  d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    ...(withDay ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  });

const outbox = (ctx: AppContext) =>
  ctx.db.collection<{ _id: string; spaceId: string; text: string; at: Date }>('photon_outbox');

export const shareUrl = (ctx: AppContext, plan: Pick<PlanDoc, 'shareToken'>) =>
  `${ctx.config.PUBLIC_BASE_URL.replace(/\/$/, '')}/p/${plan.shareToken}`;

/** Sends now if the thread is reachable, else queues the line until the thread next speaks. */
async function say(ctx: AppContext, spaceId: string, text: string) {
  const sent = await ctx.providers.messenger.send(spaceId, text).catch(() => false);
  if (!sent) await outbox(ctx).insertOne({ _id: newId(), spaceId, text, at: ctx.clock.now() });
}

async function flush(ctx: AppContext, spaceId: string) {
  const queued = await outbox(ctx).find({ spaceId }).sort({ at: 1 }).toArray();
  for (const q of queued) {
    if (!(await ctx.providers.messenger.send(spaceId, q.text).catch(() => false))) return;
    await outbox(ctx).deleteOne({ _id: q._id });
  }
}

/** Posts into the plan's bound thread, if it has one. */
export async function postToPlanThread(ctx: AppContext, plan: PlanDoc | null, text: string) {
  if (plan?.imessageThreadId && ctx.providers.messenger.enabled)
    await say(ctx, plan.imessageThreadId, text);
}

export async function planCard(ctx: AppContext, plan: PlanDoc): Promise<string> {
  const byId = await loadPlaces(
    ctx.db,
    plan.stops.map((s) => s.placeId),
  );
  const sched = toSchedStops(plan.stops, byId);
  const lines = plan.stops.map((s, i) => `${i + 1}. ${sched[i]!.name} · ${nyTime(s.arriveAt)}`);
  return [
    `📍 ${plan.name}`,
    `${nyTime(plan.startAt, true)} · ${plan.mode}`,
    ...lines,
    `Who's in? Reply "in". Stops, times and check-ins: ${shareUrl(ctx, plan)}`,
  ].join('\n');
}

/**
 * The agent's inbox. A message carrying a plan link binds that thread to the plan and gets the plan card back;
 * "in" in a bound thread counts heads. Anything queued for the thread goes out first.
 */
export async function handleGroupMessage(ctx: AppContext, m: InboundMessage) {
  await flush(ctx, m.spaceId);
  const token = TOKEN_RE.exec(m.text)?.[1];
  if (token) {
    const plan = await plans(ctx.db).findOne({ shareToken: token, status: { $ne: 'cancelled' } });
    if (!plan) {
      await say(ctx, m.spaceId, "I couldn't find that plan. Is the link from the app?");
      return;
    }
    // One plan per thread at a time: the newest link wins.
    await plans(ctx.db).updateMany(
      { imessageThreadId: m.spaceId, _id: { $ne: plan._id } },
      { $unset: { imessageThreadId: '' } },
    );
    await plans(ctx.db).updateOne({ _id: plan._id }, { $set: { imessageThreadId: m.spaceId } });
    await say(ctx, m.spaceId, await planCard(ctx, plan));
    return;
  }
  const plan = await plans(ctx.db).findOne({ imessageThreadId: m.spaceId });
  if (plan && m.senderId && IN_RE.test(m.text)) {
    const r = await plans(ctx.db).findOneAndUpdate(
      { _id: plan._id },
      { $addToSet: { imessageRsvps: m.senderId } },
      { returnDocument: 'after' },
    );
    const n = r?.imessageRsvps?.length ?? 1;
    await say(
      ctx,
      m.spaceId,
      `${n} in so far. Open the link to join in the app, then tap tags at the first stop to become friends: ${shareUrl(ctx, plan)}`,
    );
  }
}

/** "Maya checked in at Hungarian Pastry Shop": one line per check-in on a plan with a bound thread. */
export const groupChatCheckin: CheckinHook = async (ctx, c) => {
  if (!c.planId || !ctx.providers.messenger.enabled) return [];
  const plan = await plans(ctx.db).findOne({ _id: c.planId });
  if (!plan?.imessageThreadId) return [];
  const [u, place] = await Promise.all([
    users(ctx.db).findOne({ _id: c.userId }),
    places(ctx.db).findOne({ _id: c.placeId }),
  ]);
  const who = u?.name ?? (u?.username ? `@${u.username}` : 'Someone');
  await postToPlanThread(
    ctx,
    plan,
    `✅ ${who} checked in at ${place?.name ?? 'a stop'}${c.tier === 'tag' ? ' (tag tap)' : ''}`,
  );
  return [];
};

/** The last line: the plan is done, with its recap link. */
export async function groupChatRecap(ctx: AppContext, plan: PlanDoc) {
  const done = plan.stops.filter((s) => s.done).length;
  await postToPlanThread(
    ctx,
    plan,
    `🏁 ${plan.name} is done: ${done} of ${plan.stops.length} stops checked in. Recap: ${shareUrl(ctx, plan)}`,
  );
}

/** Runs the agent's inbox (worker process, or the API in inline-worker dev). */
export function startGroupChat(ctx: AppContext) {
  if (!ctx.providers.messenger.enabled) return;
  void ctx.providers.messenger
    .start((m) => handleGroupMessage(ctx, m))
    .catch((e) => console.warn(`[photon] could not start: ${(e as Error).message}`));
}

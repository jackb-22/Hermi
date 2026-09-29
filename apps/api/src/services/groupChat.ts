import { newId } from '@itp/shared';
import type { AppContext } from '../context.ts';
import { enqueue } from '../jobs/queue.ts';
import type { InboundMessage } from '../providers/messenger.ts';
import type { CheckinHook } from './checkins.ts';
import { linkByCode, normalizeHandle, userByHandle } from './imessage.ts';
import { places } from './places.ts';
import { loadPlaces, type PlanDoc, plans, toSchedStops } from './plans.ts';
import { hit } from './rateLimit.ts';
import { extractPlan, type TextLine } from './textExtract.ts';
import { planFromText, undoTextPlan } from './textPlan.ts';
import { users } from './users.ts';

const TOKEN_RE = /\/p\/([A-Za-z0-9_-]{8,})/;
const IN_RE = /^\s*(i'?m\s+in|in|count me in|yes|i'?ll come)\b/i;
const LINK_RE = /^\s*link\s+([A-Za-z0-9]{6})\s*$/i;
const UNDO_RE = /^\s*undo\s*[.!]?\s*$/i;
/** In a group, Hermi acts only when named ("hermi, plan this"); in a DM, on any text. */
const HERMI_RE = /\bhermi\b/i;
/** A group's recent lines, read when Hermi is asked to plan from the chat. */
const GROUP_WINDOW_MS = 12 * 3600_000;
const GROUP_LINES = 40;
const lines = (ctx: AppContext) =>
  ctx.db.collection<{ _id: string; spaceId: string; sender: string; text: string; at: Date }>(
    'photon_lines',
  );
const threads = (ctx: AppContext) =>
  ctx.db.collection<{ _id: string; lastPlanAt: Date }>('photon_threads');

const HELP =
  'Text me a plan and I\'ll put it in Hermi with travel times, like: "Sat 2pm: Hungarian Pastry Shop, then Riverside Park with ben". In a group chat, say "hermi plan this".';
const UNKNOWN =
  "I don't know this number yet. In Hermi go to Profile → ⚙︎ → Text Hermi, then text me the code it shows.";

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

/**
 * Sends now if the thread is reachable, else queues the line until the thread next speaks. Only the process running
 * the agent's stream (the worker) can reach threads, so others (the API writes check-ins) hand the line to it
 * through the job queue.
 */
async function say(ctx: AppContext, spaceId: string, text: string, handOff = true) {
  if (handOff && !ctx.providers.messenger.listening) {
    await enqueue(ctx, 'group_say', { spaceId, text });
    return;
  }
  const sent = await ctx.providers.messenger.send(spaceId, text).catch(() => false);
  if (!sent) await outbox(ctx).insertOne({ _id: newId(), spaceId, text, at: ctx.clock.now() });
}

/** Job: a line another process wrote for a plan's thread, posted by the worker. */
export const groupSay = (ctx: AppContext, p: { spaceId: string; text: string }) =>
  say(ctx, p.spaceId, p.text, false);

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
  // Deliveries are at-least-once: act on each message once.
  if (m.messageId) {
    const first = await ctx.db
      .collection<{ _id: string; at: Date }>('photon_seen')
      .insertOne({ _id: m.messageId, at: ctx.clock.now() })
      .then(() => true)
      .catch((e) => {
        if ((e as { code?: number }).code === 11000) return false;
        throw e;
      });
    if (!first) return;
  }
  await flush(ctx, m.spaceId);
  const link = LINK_RE.exec(m.text)?.[1];
  if (link && m.senderId) {
    const r = await linkByCode(ctx, m.senderId, link);
    await say(
      ctx,
      m.spaceId,
      r.ok
        ? `Linked to @${r.user.username ?? r.user.name ?? 'you'} ✅ Text me a plan anytime, like: "Sat 2pm: Hungarian Pastry Shop, then Riverside Park with ben".`
        : r.reason === 'expired'
          ? 'That code has expired or was already used. Get a new one in Hermi: Profile → ⚙︎ → Text Hermi.'
          : "I can't link this kind of address.",
    );
    return;
  }
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
  if (m.group && m.senderId)
    await lines(ctx).insertOne({
      _id: newId(),
      spaceId: m.spaceId,
      sender: m.senderId,
      text: m.text,
      at: ctx.clock.now(),
    });
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
    return;
  }
  await textPlan(ctx, m);
}

/** A plan by text: a DM, or "hermi …" in a group (read with the group's recent lines); "undo" puts it back. */
async function textPlan(ctx: AppContext, m: InboundMessage) {
  if (!m.senderId || !m.text.trim()) return;
  if (m.group && !HERMI_RE.test(m.text)) return;
  const host = await userByHandle(ctx, m.senderId);
  if (!host) {
    await say(ctx, m.spaceId, UNKNOWN);
    return;
  }
  try {
    await hit(ctx.db, `photon:${host._id}`, 20, 3600, ctx.clock.now());
  } catch {
    await say(ctx, m.spaceId, "That's a lot of plans for one hour. Give me a bit.");
    return;
  }
  if (UNDO_RE.test(m.text.replace(HERMI_RE, ''))) {
    await say(ctx, m.spaceId, await undoTextPlan(ctx, host));
    return;
  }
  const now = ctx.clock.now();
  let transcript: TextLine[] = [{ sender: m.senderId, text: m.text }];
  let groupHandles: string[] = [];
  if (m.group) {
    const since = (await threads(ctx).findOne({ _id: m.spaceId }))?.lastPlanAt;
    const from = new Date(Math.max(now.getTime() - GROUP_WINDOW_MS, since?.getTime() ?? 0));
    const recent = await lines(ctx)
      .find({ spaceId: m.spaceId, at: { $gt: from } })
      .sort({ at: -1 })
      .limit(GROUP_LINES)
      .toArray();
    if (recent.length)
      transcript = recent.reverse().map((l) => ({ sender: l.sender, text: l.text }));
    const members = await ctx.providers.messenger.members(m.spaceId);
    groupHandles = members.flatMap((h) => normalizeHandle(h) ?? []);
  }
  const tp = await extractPlan(ctx, transcript, now);
  if (tp.intent === 'none' || !tp.stops.length) {
    await say(
      ctx,
      m.spaceId,
      m.group
        ? "I didn't find a plan in this chat yet. Name a place or two, then ask me again."
        : HELP,
    );
    return;
  }
  const { reply, plan } = await planFromText(ctx, host, tp, { groupHandles });
  if (plan && m.group) {
    await threads(ctx).updateOne(
      { _id: m.spaceId },
      { $set: { lastPlanAt: now } },
      { upsert: true },
    );
    // The group now follows this plan: "in" replies, check-ins and the recap land here.
    await plans(ctx.db).updateMany(
      { imessageThreadId: m.spaceId, _id: { $ne: plan._id } },
      { $unset: { imessageThreadId: '' } },
    );
    await plans(ctx.db).updateOne({ _id: plan._id }, { $set: { imessageThreadId: m.spaceId } });
  }
  await say(ctx, m.spaceId, reply);
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

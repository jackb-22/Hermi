import { randomBytes } from 'node:crypto';
import { newId } from '@itp/shared';
import type { AppContext } from '../context.ts';
import type { UserDoc } from '../db/types.ts';
import { nyLocal, nyLocalToUtc } from '../domain/weatherDay.ts';
import { shareUrl } from './groupChat.ts';
import { resolveStops } from './placeLookup.ts';
import { inviteFriends, savePlan } from './planSharing.ts';
import {
  loadPlaces,
  nextQuarterHour,
  normalizeStops,
  type PlanDoc,
  plans,
  recompute,
  saveAndView,
  type TextUndo,
  toSchedStops,
} from './plans.ts';
import { applyGhostChange, schedulePlan } from './scheduler.ts';
import { friendIds } from './social.ts';
import { MODE_LABEL, planSpacing } from './spacing.ts';
import type { TextPlan } from './textExtract.ts';
import { users } from './users.ts';

const clock = (d: Date, withDay = false) =>
  d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    ...(withDay ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  });

/** The start the text asked for: its day and time in New York, never in the past. */
export function startFrom(tp: Pick<TextPlan, 'date' | 'time'>, current: Date, now: Date): Date {
  const hm = tp.time?.split(':').map(Number) as [number, number] | undefined;
  const today = nyLocal(now).date;
  let at: Date | null = null;
  if (tp.date) at = nyLocalToUtc(tp.date, hm?.[0] ?? 13, hm?.[1] ?? 0);
  else if (hm) {
    at = nyLocalToUtc(today, hm[0], hm[1]);
    if (at.getTime() < now.getTime()) at = new Date(at.getTime() + 86_400_000);
  } else if (current.getTime() > now.getTime()) at = current;
  return at && at.getTime() >= now.getTime() ? at : nextQuarterHour(now);
}

/** The sender's draft the app shows as My Plan (newest non-empty draft), or a new one. */
async function targetDraft(
  ctx: AppContext,
  host: UserDoc,
): Promise<{ plan: PlanDoc; existed: boolean }> {
  const drafts = await plans(ctx.db)
    .find({ hostId: host._id, status: 'draft' })
    .sort({ startAt: -1 })
    .toArray();
  const found = drafts.find((p) => p.stops.length) ?? drafts[0];
  if (found) return { plan: found, existed: true };
  const now = ctx.clock.now();
  return {
    existed: false,
    plan: {
      _id: newId(),
      hostId: host._id,
      name: 'New plan',
      nameIsDefault: true,
      startAt: nextQuarterHour(now),
      mode: 'walk',
      visibility: 'just_me',
      status: 'draft',
      stops: [],
      members: [],
      ghostChanges: [],
      shareToken: randomBytes(9).toString('base64url'),
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** Friends named in the text ("ben", "@jenny", "Maya Chen"), and friends who are in the group chat. */
async function whoToInvite(
  ctx: AppContext,
  host: UserDoc,
  names: string[],
  groupHandles: string[],
) {
  const friends = await users(ctx.db)
    .find({ _id: { $in: await friendIds(ctx.db, host._id) }, deletedAt: { $exists: false } })
    .toArray();
  const ids = new Set<string>();
  const missing: string[] = [];
  for (const raw of names) {
    const n = raw.trim().replace(/^@/, '').toLowerCase();
    const f =
      friends.find((u) => u.username?.toLowerCase() === n) ??
      friends.find((u) => u.name?.toLowerCase() === n) ??
      friends.find((u) => u.name?.toLowerCase().split(/\s+/)[0] === n);
    if (f) ids.add(f._id);
    else missing.push(raw.replace(/^@/, ''));
  }
  for (const f of friends)
    if (f.imessageHandles?.some((h) => groupHandles.includes(h))) ids.add(f._id);
  ids.delete(host._id);
  return {
    ids: [...ids],
    missing,
    names: friends.filter((f) => ids.has(f._id)).map((f) => f.name ?? `@${f.username}`),
  };
}

/**
 * A plan from texts becomes the sender's My Plan: the places in order, at the time asked, spaced with real travel
 * times (and AI stay lengths where none were set), then saved with the friends it names (or who are in the group)
 * invited. The old draft is kept for "undo". Returns the reply to text back.
 */
export async function planFromText(
  ctx: AppContext,
  host: UserDoc,
  tp: TextPlan,
  opts: { groupHandles?: string[] } = {},
): Promise<{ reply: string; plan?: PlanDoc }> {
  const now = ctx.clock.now();
  const found = await resolveStops(ctx, tp.stops, host);
  if (!found.places.length)
    return {
      reply: `I couldn't find ${tp.stops.map((s) => `"${s.query}"`).join(', ') || 'those places'} in New York. Try the venue's name, like "Hungarian Pastry Shop".`,
    };

  const { plan, existed } = await targetDraft(ctx, host);
  const undo: TextUndo = {
    at: now,
    existed,
    stops: plan.stops,
    startAt: plan.startAt,
    name: plan.name,
    nameIsDefault: plan.nameIsDefault,
    mode: plan.mode,
    status: plan.status,
    visibility: plan.visibility,
    members: plan.members,
  };
  const mode = tp.mode ?? plan.mode;
  const byId = await loadPlaces(
    ctx.db,
    found.places.map((p) => p._id),
  );
  plan.stops = normalizeStops(
    found.places.map((p) => ({ placeId: p._id })),
    existed ? plan.stops : [],
    mode,
    byId,
    now,
  );
  plan.mode = mode;
  plan.startAt = startFrom(tp, plan.startAt, now);
  plan.name = 'New plan';
  plan.nameIsDefault = true;
  plan.textUndo = undo;

  // Stays (AI where not set), opening hours and legs, then the leg modes "Space it out" would pick.
  await schedulePlan(ctx, plan);
  const spacing = await planSpacing(
    ctx,
    plan,
    await loadPlaces(
      ctx.db,
      plan.stops.map((s) => s.placeId),
    ),
  );
  for (const c of spacing.changes) await applyGhostChange(ctx, plan, c);
  plan.ghostChanges = [];
  await saveAndView(ctx, plan, host._id);

  const invite = await whoToInvite(ctx, host, tp.people, opts.groupHandles ?? []);
  let saved = plan;
  if (invite.ids.length) {
    if (plan.status === 'draft')
      await savePlan(ctx, plan, host._id, { visibility: 'invite', inviteeIds: invite.ids });
    else await inviteFriends(ctx, plan, host._id, invite.ids);
    saved = (await plans(ctx.db).findOne({ _id: plan._id }))!;
  }
  return { reply: await planText(ctx, saved, invite, found.missing), plan: saved };
}

async function planText(
  ctx: AppContext,
  plan: PlanDoc,
  invite: { names: string[]; missing: string[] },
  missingPlaces: string[],
) {
  const byId = await loadPlaces(
    ctx.db,
    plan.stops.map((s) => s.placeId),
  );
  recompute(plan, byId);
  const sched = toSchedStops(plan.stops, byId);
  const lines = [`📍 ${plan.name} · ${clock(plan.startAt, true)}`];
  plan.stops.forEach((s, i) => {
    if (i > 0)
      lines.push(
        `   ↓ ${MODE_LABEL[s.legMode].toLowerCase()} ${s.legMin} min${s.legSource === 'estimate' ? ' (est.)' : ''}`,
      );
    lines.push(`${i + 1}. ${sched[i]!.name} · ${clock(s.arriveAt)} (${s.stayMin} min)`);
  });
  const last = plan.stops.at(-1);
  if (last) lines.push(`Ends ${clock(last.departAt)}.`);
  if (invite.names.length)
    lines.push(`Invited ${invite.names.join(', ')}: they'll see it in Hermi.`);
  if (missingPlaces.length) lines.push(`Couldn't find: ${missingPlaces.join(', ')}.`);
  if (invite.missing.length)
    lines.push(
      `Not your Hermi friends yet: ${invite.missing.join(', ')}. Send them the link to join.`,
    );
  lines.push(`It's your plan in Hermi now: ${shareUrl(ctx, plan)}`);
  lines.push('Reply "undo" to put your old plan back.');
  return lines.join('\n');
}

/** "undo": the last plan a text changed goes back to how it was (a plan the text created is cancelled). */
export async function undoTextPlan(ctx: AppContext, host: UserDoc): Promise<string> {
  const plan = await plans(ctx.db)
    .find({ hostId: host._id, textUndo: { $exists: true } })
    .sort({ 'textUndo.at': -1 })
    .limit(1)
    .next();
  if (!plan?.textUndo) return 'Nothing to undo.';
  const u = plan.textUndo;
  await plans(ctx.db).updateOne(
    { _id: plan._id },
    {
      $set: u.existed
        ? {
            stops: u.stops,
            startAt: u.startAt,
            name: u.name,
            nameIsDefault: u.nameIsDefault,
            mode: u.mode,
            status: u.status,
            visibility: u.visibility,
            members: u.members,
            updatedAt: ctx.clock.now(),
          }
        : { status: 'cancelled', updatedAt: ctx.clock.now() },
      $unset: { textUndo: '' },
    },
  );
  if (u.status === 'draft')
    await ctx.db.collection('saves').deleteOne({ userId: host._id, type: 'plan', refId: plan._id });
  return u.existed ? 'Done: your plan is back to how it was.' : 'Done: I removed that plan.';
}

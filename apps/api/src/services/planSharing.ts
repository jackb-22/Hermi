import { ApiError, newId } from '@itp/shared';
import type { AppContext } from '../context.ts';
import { assertNameAllowed, checkName, safeDisplayName } from '../domain/nameFilter.ts';
import { notify } from './notify.ts';
import {
  defaultName,
  enqueueMatch,
  loadPlaces,
  type MemberStatus,
  type PlanDoc,
  plans,
  type Visibility,
} from './plans.ts';
import { friendIds } from './social.ts';
import { getUser } from './users.ts';

const memberStatus = (p: PlanDoc, userId: string) =>
  p.members.find((m) => m.userId === userId)?.status;

export async function setMember(
  ctx: AppContext,
  planId: string,
  userId: string,
  status: MemberStatus,
) {
  const now = ctx.clock.now();
  const r = await plans(ctx.db).updateOne(
    { _id: planId, 'members.userId': userId },
    { $set: { 'members.$.status': status, 'members.$.at': now, updatedAt: now } },
  );
  if (!r.matchedCount)
    await plans(ctx.db).updateOne(
      { _id: planId },
      { $push: { members: { userId, status, at: now } }, $set: { updatedAt: now } },
    );
}

/** Invites go to friends only; everyone else joins by link or through Find someone. */
export async function assertFriends(ctx: AppContext, hostId: string, ids: string[]) {
  const friends = new Set(await friendIds(ctx.db, hostId));
  const bad = ids.filter((id) => !friends.has(id));
  if (bad.length)
    throw new ApiError(
      400,
      'BAD_REQUEST',
      'You can only invite friends; everyone else joins by link or through Find someone',
      { notFriends: bad },
    );
}

async function pushInvites(
  ctx: AppContext,
  plan: PlanDoc,
  hostId: string,
  ids: string[],
  title: string,
) {
  if (!ids.length) return;
  const host = await getUser(ctx.db, hostId);
  await notify(ctx, ids, {
    title: `${safeDisplayName(host, { none: 'A friend' })} invited you`,
    body: title,
    data: { kind: 'plan_invite', planId: plan._id },
  });
}

/**
 * The AI's name for the plan, unless it fails the name filter (it can echo a place name): then the name a new plan
 * gets, so the model can never put a bad name on the public /p/ page.
 */
export async function suggestPlanName(ctx: AppContext, plan: PlanDoc) {
  const byId = await loadPlaces(
    ctx.db,
    plan.stops.map((s) => s.placeId),
  );
  const suggested = await ctx.providers.llm.planName(
    plan.stops.flatMap((s) =>
      s.placeId && byId.get(s.placeId) ? [byId.get(s.placeId)!.name] : [],
    ),
  );
  if (checkName(suggested, 'planName').ok) return suggested;
  const fallback = defaultName(plan.stops, byId);
  return checkName(fallback, 'planName').ok ? fallback : 'New plan';
}

/**
 * Save: the draft becomes planned with a visibility, invitees get a push and see Join / Can't, and the host's
 * Saved gets it. Shared by POST /plans/:id/save and Photon.
 */
export async function savePlan(
  ctx: AppContext,
  plan: PlanDoc,
  hostId: string,
  body: { name?: string; visibility: Visibility; inviteeIds: string[] },
) {
  if (body.name !== undefined && body.name !== plan.name) assertNameAllowed(body.name, 'planName');
  await assertFriends(ctx, hostId, body.inviteeIds);
  if (body.visibility === 'find') {
    const me = await getUser(ctx.db, hostId);
    if (!me.verifiedAt)
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Find someone is for verified students; verify your school email first',
      );
  }
  const name = body.name ?? (plan.nameIsDefault ? await suggestPlanName(ctx, plan) : plan.name);
  await plans(ctx.db).updateOne(
    { _id: plan._id },
    {
      $set: {
        name,
        nameIsDefault: false,
        visibility: body.visibility,
        status: plan.status === 'draft' ? 'planned' : plan.status,
        updatedAt: ctx.clock.now(),
      },
    },
  );
  for (const id of body.inviteeIds)
    if (!memberStatus(plan, id)) await setMember(ctx, plan._id, id, 'invited');
  // Find someone: match verified students now and push the ones who fit ("!" on their map).
  if (body.visibility === 'find') await enqueueMatch(ctx, plan._id);
  await ctx.db
    .collection('saves')
    .updateOne(
      { userId: hostId, type: 'plan', refId: plan._id },
      { $setOnInsert: { _id: newId() as never, createdAt: ctx.clock.now() } },
      { upsert: true },
    );
  await pushInvites(ctx, plan, hostId, body.inviteeIds, name);
  return name;
}

/** More friends on a saved plan; those already on it are left alone. Returns who was newly invited. */
export async function inviteFriends(ctx: AppContext, plan: PlanDoc, hostId: string, ids: string[]) {
  await assertFriends(ctx, hostId, ids);
  const fresh = ids.filter((id) => !memberStatus(plan, id));
  for (const id of fresh) await setMember(ctx, plan._id, id, 'invited');
  await pushInvites(ctx, plan, hostId, fresh, plan.name);
  return fresh;
}

import { newId } from '@itp/shared';
import type { Db } from 'mongodb';
import type { AppContext } from '../context.ts';
import type { UserDoc } from '../db/types.ts';
import { enqueue, type JobDoc } from '../jobs/queue.ts';
import { users } from './users.ts';

export interface MemoryDoc {
  _id: string;
  userId: string;
  text: string;
  source: 'review' | 'ghost_skip' | 'ask';
  at: Date;
  syncedAt?: Date;
}

export const memories = (db: Db) => db.collection<MemoryDoc>('ai_memories');

export const PLANNER_SYSTEM = `You are the planner in a city app for New York students. You edit one outing plan through tools.
Never invent places: get place ids from search_places. Make the smallest set of changes that answers the request.
Every change is shown to the user as a suggestion to accept, so do not ask for confirmation. Respect what you remember
about this person (dislikes, times they avoid). Finish with one short sentence saying what you changed and why.`;

/**
 * Behaviour the planner should learn from ("Would go again: No", a skipped ghost pin). Kept locally, so the
 * Gemini fallback can read it, and written to the user's Backboard assistant by a job when Backboard is on.
 */
export async function remember(
  ctx: AppContext,
  userId: string,
  text: string,
  source: MemoryDoc['source'],
) {
  const doc: MemoryDoc = { _id: newId(), userId, text, source, at: ctx.clock.now() };
  await memories(ctx.db).insertOne(doc);
  if (ctx.providers.backboard.enabled) await enqueue(ctx, 'remember', { memoryId: doc._id });
}

export async function recentMemories(db: Db, userId: string, n = 12): Promise<string[]> {
  const docs = await memories(db).find({ userId }).sort({ at: -1 }).limit(n).toArray();
  return docs.map((d) => d.text);
}

/** One Backboard assistant per user; created on first use and kept on the user. */
export async function ensureAssistant(ctx: AppContext, user: UserDoc): Promise<string> {
  if (user.backboardAssistantId) return user.backboardAssistantId;
  const id = await ctx.providers.backboard.createAssistant(
    `itp-planner-${user._id}`,
    PLANNER_SYSTEM,
  );
  const won = await users(ctx.db).findOneAndUpdate(
    { _id: user._id, backboardAssistantId: { $exists: false } },
    { $set: { backboardAssistantId: id } },
    { returnDocument: 'after' },
  );
  // Lost a race with another request: use the assistant that got stored.
  return (
    won?.backboardAssistantId ??
    (await users(ctx.db).findOne({ _id: user._id }))!.backboardAssistantId!
  );
}

/** Job: push one memory to the user's Backboard assistant. */
export async function syncMemory(ctx: AppContext, payload: { memoryId: string }, _job?: JobDoc) {
  const m = await memories(ctx.db).findOne({ _id: payload.memoryId });
  if (!m || m.syncedAt) return;
  const user = await users(ctx.db).findOne({ _id: m.userId });
  if (!user || user.deletedAt) return;
  const assistantId = await ensureAssistant(ctx, user);
  await ctx.providers.backboard.addMemory(assistantId, m.text, { source: m.source });
  await memories(ctx.db).updateOne({ _id: m._id }, { $set: { syncedAt: ctx.clock.now() } });
}

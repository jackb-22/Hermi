import { newId } from '@itp/shared';
import type { Db } from 'mongodb';
import type { AppContext } from '../context.ts';

export interface MemoryDoc {
  _id: string;
  userId: string;
  text: string;
  source: 'review' | 'ghost_skip' | 'ask';
  at: Date;
}

export const memories = (db: Db) => db.collection<MemoryDoc>('ai_memories');

export const PLANNER_SYSTEM = `You are Hermi's planner in a city app for New York students. You only help with this one outing plan,
and you change it only through your tools. Never invent places: get place ids from search_places. Make the smallest set
of changes that answers the request. Every change is shown to the user as a suggestion to accept, so do not ask for
confirmation. Questions about the plan's places (hours, what they are like) are fine: use place_details or ask_maps and
answer without changing anything. You cannot invite, message, share or save anything, and you do not know about other
plans; say so briefly if asked. If a request has nothing to do with this outing, say in one sentence that you can only
help with the plan. Respect what you remember about this person (dislikes, times they avoid). Reply in at most two
short sentences: what you changed and why, or the answer.`;

/** Behaviour the planner should learn from ("Would go again: No", a skipped ghost pin); read into its prompt. */
export async function remember(
  ctx: AppContext,
  userId: string,
  text: string,
  source: MemoryDoc['source'],
) {
  const doc: MemoryDoc = { _id: newId(), userId, text, source, at: ctx.clock.now() };
  await memories(ctx.db).insertOne(doc);
}

export async function recentMemories(db: Db, userId: string, n = 12): Promise<string[]> {
  const docs = await memories(db).find({ userId }).sort({ at: -1 }).limit(n).toArray();
  return docs.map((d) => d.text);
}

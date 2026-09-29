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

export const PLANNER_SYSTEM = `You are the planner in a city app for New York students. You edit one outing plan through tools.
Never invent places: get place ids from search_places. Make the smallest set of changes that answers the request.
Every change is shown to the user as a suggestion to accept, so do not ask for confirmation. Respect what you remember
about this person (dislikes, times they avoid). Finish with one short sentence saying what you changed and why.`;

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

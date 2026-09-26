import type { Db } from 'mongodb';

export interface FriendshipDoc {
  _id: string; // "a:b" with a < b
  a: string;
  b: string;
  since: Date;
  hangouts: number;
  streakWeeks: number;
  lastHangoutWeek: number;
  lastHangoutDay?: string;
}

export const pairKey = (x: string, y: string) => (x < y ? `${x}:${y}` : `${y}:${x}`);

export async function friendIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .collection<FriendshipDoc>('friendships')
    .find({ $or: [{ a: userId }, { b: userId }] }, { projection: { a: 1, b: 1 } })
    .toArray();
  return rows.map((f) => (f.a === userId ? f.b : f.a));
}

export async function blockedIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .collection<{ blocker: string; blocked: string }>('blocks')
    .find({ $or: [{ blocker: userId }, { blocked: userId }] })
    .toArray();
  return rows.map((b) => (b.blocker === userId ? b.blocked : b.blocker));
}

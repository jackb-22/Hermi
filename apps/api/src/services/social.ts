import { haversineM, type LatLng, newId } from '@itp/shared';
import type { StreakSchema, UserCardSchema } from '@itp/shared/api';
import type { Db } from 'mongodb';
import type { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { UserDoc } from '../db/types.ts';
import { applyHangout, displayStreak, newStreak, type StreakState } from '../domain/streak.ts';
import { publicUrl } from './users.ts';

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

export const friendships = (db: Db) => db.collection<FriendshipDoc>('friendships');

export function toUserCard(u: UserDoc, c: AppContext['config']): z.infer<typeof UserCardSchema> {
  return {
    id: u._id,
    name: u.name ?? null,
    username: u.username ?? null,
    spriteUrl: publicUrl(c, u.spriteKey),
    photoUrl: publicUrl(c, u.photoKey),
    verified: !!u.verifiedAt,
    campus: u.campus ?? null,
  };
}

export function toStreak(f: FriendshipDoc, now: Date): z.infer<typeof StreakSchema> {
  return { ...displayStreak(f, now), hangouts: f.hangouts, since: f.since.toISOString() };
}

export type HangoutSource = 'tap' | 'venue';

/**
 * Tapping tags (or checking in at the same venue tag within 30 min) is the only social gesture.
 * Not friends yet: creates the friendship with streak 1. Friends: logs a hangout that moves the streak once per week.
 */
export async function logHangout(
  ctx: AppContext,
  x: string,
  y: string,
  at: Date,
  source: HangoutSource,
  placeId?: string,
) {
  const { db, tiger } = ctx;
  const [a, b] = x < y ? [x, y] : [y, x];
  const _id = `${a}:${b}`;
  const existing = await friendships(db).findOne({ _id });
  let doc: FriendshipDoc;
  let status: 'friends' | 'hangout' | 'already_today';
  if (!existing) {
    if (source !== 'tap') return null; // only a tag tap makes friends
    doc = { _id, a, b, since: at, ...newStreak(at) };
    await friendships(db)
      .insertOne(doc)
      .catch(async (e) => {
        if ((e as { code?: number }).code !== 11000) throw e;
      });
    status = 'friends';
  } else {
    const { state, outcome } = applyHangout(existing as StreakState, at);
    doc = { ...existing, ...state };
    if (outcome === 'already_today')
      return { status: 'already_today' as const, friendship: existing };
    // Compare-and-set on the previous day so two concurrent taps cannot both count.
    const r = await friendships(db).updateOne(
      { _id, lastHangoutDay: existing.lastHangoutDay },
      { $set: state },
    );
    if (!r.modifiedCount) return { status: 'already_today' as const, friendship: existing };
    status = 'hangout';
  }
  await tiger.query(
    'insert into hangouts (time, pair_key, source, place_id) values ($1, $2, $3, $4)',
    [at, _id, source, placeId ?? null],
  );
  return { status, friendship: doc };
}

export const TAP_WINDOW_MS = 120_000;
export const TAP_RADIUS_M = 50;

/** Finds the reciprocal personal-tag read: the tag's owner read the reader's tag within 2 minutes and 50 m. */
export async function findReciprocal(
  ctx: AppContext,
  o: {
    readerId: string;
    ownerId: string;
    readerTagId: string;
    at: LatLng;
    time: Date;
    requireAttested: boolean;
  },
) {
  const { rows } = await ctx.tiger.query<{
    lat: number;
    lng: number;
    attested: boolean;
    time: Date;
  }>(
    `select lat, lng, attested, time from tag_reads
     where user_id = $1 and tag_id = $2 and time between $3 and $4 order by time desc`,
    [
      o.ownerId,
      o.readerTagId,
      new Date(o.time.getTime() - TAP_WINDOW_MS),
      new Date(o.time.getTime() + TAP_WINDOW_MS),
    ],
  );
  return (
    rows.find((r) => haversineM(r, o.at) <= TAP_RADIUS_M && (!o.requireAttested || r.attested)) ??
    null
  );
}

export async function recordTagRead(
  ctx: AppContext,
  r: {
    userId: string;
    tagId: string;
    kind: 'venue' | 'personal';
    at: LatLng;
    accuracy: number;
    time: Date;
    attested: boolean;
  },
) {
  const id = newId();
  await ctx.tiger.query(
    'insert into tag_reads (time, id, user_id, tag_id, tag_kind, lat, lng, accuracy, attested) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [r.time, id, r.userId, r.tagId, r.kind, r.at.lat, r.at.lng, r.accuracy, r.attested],
  );
  return id;
}

export const CO_CHECKIN_MS = 30 * 60_000;

/** Check-in hook: friends who check in at the same venue tag within 30 minutes log a hangout, no extra tap. */
export async function venueHangouts(
  ctx: AppContext,
  c: { userId: string; placeId: string; tier: 'gps' | 'tag'; time: Date; tagId?: string },
) {
  if (c.tier !== 'tag' || !c.tagId) return [];
  const friends = await friendIds(ctx.db, c.userId);
  if (!friends.length) return [];
  const { rows } = await ctx.tiger.query<{ user_id: string }>(
    `select distinct user_id from checkins where tag_id = $1 and user_id = any($2) and time between $3 and $4`,
    [
      c.tagId,
      friends,
      new Date(c.time.getTime() - CO_CHECKIN_MS),
      new Date(c.time.getTime() + CO_CHECKIN_MS),
    ],
  );
  const out: { friendId: string; streakWeeks: number }[] = [];
  for (const r of rows) {
    const h = await logHangout(ctx, c.userId, r.user_id, c.time, 'venue', c.placeId);
    if (h && h.status !== 'already_today')
      out.push({ friendId: r.user_id, streakWeeks: displayStreak(h.friendship, c.time).weeks });
  }
  return out;
}

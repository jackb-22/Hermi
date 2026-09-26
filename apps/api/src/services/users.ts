import { ApiError, newId } from '@itp/shared';
import type { MeSchema } from '@itp/shared/api';
import type { Collection, Db } from 'mongodb';
import type { z } from 'zod';
import type { Config } from '../config.ts';
import type { UserDoc } from '../db/types.ts';

export const users = (db: Db): Collection<UserDoc> => db.collection<UserDoc>('users');

export function publicUrl(c: Config, key?: string): string | null {
  if (!key) return null;
  return `${(c.CDN_BASE_URL ?? `${c.PUBLIC_BASE_URL}/media`).replace(/\/$/, '')}/${key}`;
}

/** Current until the end of May of the grad year, then Alumni automatically. */
export function studentStatus(
  u: Pick<UserDoc, 'verifiedAt' | 'gradYear'>,
  now: Date,
): 'current' | 'alumni' | null {
  if (!u.verifiedAt || !u.gradYear) return null;
  return now < new Date(Date.UTC(u.gradYear, 5, 1, 4)) ? 'current' : 'alumni';
}

export function toMe(u: UserDoc, c: Config, now: Date): z.infer<typeof MeSchema> {
  return {
    id: u._id,
    name: u.name ?? null,
    username: u.username ?? null,
    photoUrl: publicUrl(c, u.photoKey),
    spriteUrl: publicUrl(c, u.spriteKey),
    verified: !!u.verifiedAt,
    campus: u.campus ?? null,
    gradYear: u.gradYear ?? null,
    studentStatus: studentStatus(u, now),
    is21: u.is21,
    ghostMode: u.ghostMode,
    openToPlans: u.openToPlans,
    tagId: u.tagId ?? null,
    tasteDone: u.tasteDone,
    createdAt: u.createdAt.toISOString(),
  };
}

export function newUser(now: Date, fields: Partial<UserDoc> = {}): UserDoc {
  return {
    _id: newId(),
    is21: false,
    openToPlans: false,
    ghostMode: false,
    tasteDone: false,
    createdAt: now,
    ...fields,
  };
}

export async function getUser(db: Db, id: string): Promise<UserDoc> {
  const u = await users(db).findOne({ _id: id, deletedAt: { $exists: false } });
  if (!u) throw new ApiError(401, 'UNAUTHORIZED', 'User no longer exists');
  return u;
}

export const isDupKey = (e: unknown) => (e as { code?: number })?.code === 11000;

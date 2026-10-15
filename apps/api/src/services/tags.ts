import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError, buildTagUrl, parseTagUrl, type TagKind, type TagRef } from '@itp/shared';
import type { Db } from 'mongodb';
import type { AppContext } from '../context.ts';
import { users } from './users.ts';

export interface TagDoc {
  _id: string;
  kind: TagKind;
  placeId?: string;
  ownerId?: string;
  secretHash: string;
  chip: string;
  /** "My code": the secret is codeSecret(JWT_SECRET, _id), so the URL can be rebuilt. Stickers have no such flag. */
  derived?: true;
  createdAt: Date;
}

export const tags = (db: Db) => db.collection<TagDoc>('tags');
export const hashSecret = (k: string) => createHash('sha256').update(k).digest('hex');
export const newSecret = () => randomBytes(12).toString('base64url');
/** Short, sticker-friendly id: 10 chars of Crockford-ish base32. */
export const newTagId = () => {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return Array.from(randomBytes(10), (b) => alphabet[b % 32]).join('');
};

/** Resolves a scanned tag, rejecting unknown tags and wrong secrets before any GPS check. */
export async function verifyTag(
  db: Db,
  input: { tagUrl?: string; tagId?: string; k?: string },
  expect?: TagKind,
): Promise<TagDoc> {
  const ref: TagRef | null = input.tagUrl
    ? parseTagUrl(input.tagUrl)
    : input.tagId && input.k
      ? { kind: expect ?? 'venue', id: input.tagId, k: input.k }
      : null;
  if (!ref) throw new ApiError(400, 'TAG_INVALID', 'Not a tag URL');
  const tag = await tags(db).findOne({ _id: ref.id });
  const a = Buffer.from(hashSecret(ref.k), 'hex');
  const b = Buffer.from(tag?.secretHash ?? '0'.repeat(64), 'hex');
  if (!tag || !timingSafeEqual(a, b))
    throw new ApiError(400, 'TAG_INVALID', 'Unknown tag or wrong secret');
  if (expect && tag.kind !== expect)
    throw new ApiError(400, 'TAG_INVALID', `Expected a ${expect} tag`);
  return tag;
}

/**
 * Secret of a "My code" tag: the first 12 bytes of HMAC-SHA256(key, tagId), base64url like newSecret(). The key is
 * derived from JWT_SECRET (HKDF, own info string), so it needs no env var and is never the key that signs tokens.
 * Rotating JWT_SECRET changes every code's secret; personalCode() re-hashes on the next call.
 */
export const codeSecret = (jwtSecret: string, tagId: string) =>
  createHmac('sha256', Buffer.from(hkdfSync('sha256', jwtSecret, '', 'hermi personal tag v1', 32)))
    .update(tagId)
    .digest()
    .subarray(0, 12)
    .toString('base64url');

export type PersonalCode =
  | { kind: 'code'; tagId: string; url: string }
  | { kind: 'sticker'; tagId: string; url: null };

/**
 * POST /me/code. Someone with no personal tag gets one minted (only the secret's hash is stored); a repeat call
 * rebuilds the same URL from the HMAC. A bound sticker is a different case: its secret exists only on the sticker, so
 * there is no URL to give back and the answer is `sticker`. Binding a sticker unbinds the code (POST /me/tag).
 */
export async function personalCode(
  ctx: Pick<AppContext, 'db' | 'config' | 'clock'>,
  userId: string,
): Promise<PersonalCode> {
  const { db, config } = ctx;
  const urlOf = (id: string) =>
    buildTagUrl(config.PUBLIC_BASE_URL, {
      kind: 'personal',
      id,
      k: codeSecret(config.JWT_SECRET, id),
    });
  // Two concurrent first calls both mint; the compare-and-set below lets one win and the other deletes its tag.
  for (let attempt = 0; attempt < 3; attempt++) {
    const me = await users(db).findOne({ _id: userId }, { projection: { tagId: 1 } });
    if (!me) throw new ApiError(404, 'NOT_FOUND', 'No such user');
    const current = me.tagId
      ? await tags(db).findOne({ _id: me.tagId, kind: 'personal', ownerId: userId })
      : null;
    if (current && !current.derived) return { kind: 'sticker', tagId: current._id, url: null };
    if (current) {
      const secretHash = hashSecret(codeSecret(config.JWT_SECRET, current._id));
      if (secretHash !== current.secretHash)
        await tags(db).updateOne({ _id: current._id }, { $set: { secretHash } });
      return { kind: 'code', tagId: current._id, url: urlOf(current._id) };
    }
    const id = newTagId();
    await tags(db).insertOne({
      _id: id,
      kind: 'personal',
      ownerId: userId,
      secretHash: hashSecret(codeSecret(config.JWT_SECRET, id)),
      chip: 'code',
      derived: true,
      createdAt: ctx.clock.now(),
    });
    const linked = await users(db).updateOne(
      { _id: userId, tagId: me.tagId ?? { $exists: false } },
      { $set: { tagId: id } },
    );
    if (linked.modifiedCount) return { kind: 'code', tagId: id, url: urlOf(id) };
    await tags(db).deleteOne({ _id: id });
  }
  throw new ApiError(409, 'CONFLICT', 'Your code changed while it was being made: try again');
}

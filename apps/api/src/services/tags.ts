import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError, type TagKind, type TagRef, parseTagUrl } from '@itp/shared';
import type { Db } from 'mongodb';

export interface TagDoc {
  _id: string;
  kind: TagKind;
  placeId?: string;
  ownerId?: string;
  secretHash: string;
  chip: string;
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
export async function verifyTag(db: Db, input: { tagUrl?: string; tagId?: string; k?: string }, expect?: TagKind): Promise<TagDoc> {
  const ref: TagRef | null = input.tagUrl ? parseTagUrl(input.tagUrl) : input.tagId && input.k ? { kind: expect ?? 'venue', id: input.tagId, k: input.k } : null;
  if (!ref) throw new ApiError(400, 'TAG_INVALID', 'Not a tag URL');
  const tag = await tags(db).findOne({ _id: ref.id });
  const a = Buffer.from(hashSecret(ref.k), 'hex');
  const b = Buffer.from(tag?.secretHash ?? '0'.repeat(64), 'hex');
  if (!tag || !timingSafeEqual(a, b)) throw new ApiError(400, 'TAG_INVALID', 'Unknown tag or wrong secret');
  if (expect && tag.kind !== expect) throw new ApiError(400, 'TAG_INVALID', `Expected a ${expect} tag`);
  return tag;
}

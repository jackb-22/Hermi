import { buildTagUrl } from '@itp/shared';
import type { Db } from 'mongodb';
import { hashSecret, tags } from '../../src/services/tags.ts';

export async function venueTag(
  db: Db,
  placeId: string,
  id = `V${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
) {
  const k = `secret-${id}`;
  await tags(db).insertOne({
    _id: id,
    kind: 'venue',
    placeId,
    secretHash: hashSecret(k),
    chip: 'NTAG215',
    createdAt: new Date(),
  });
  return { id, k, url: buildTagUrl('https://test.tech', { kind: 'venue', id, k }) };
}

export async function personalTag(
  db: Db,
  ownerId?: string,
  id = `P${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
) {
  const k = `secret-${id}`;
  await tags(db).insertOne({
    _id: id,
    kind: 'personal',
    ownerId,
    secretHash: hashSecret(k),
    chip: 'NTAG215',
    createdAt: new Date(),
  });
  return { id, k, url: buildTagUrl('https://test.tech', { kind: 'personal', id, k }) };
}

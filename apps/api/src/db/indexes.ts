import { TAG_DIMS } from '@itp/shared';
import type { Db, IndexDescription } from 'mongodb';

/** MongoDB holds things that exist. Index list follows the plan's Data model table plus implied additions. */
const INDEXES: Record<string, IndexDescription[]> = {
  users: [
    {
      key: { username: 1 },
      unique: true,
      partialFilterExpression: { username: { $type: 'string' } },
    },
    {
      key: { appleSub: 1 },
      unique: true,
      partialFilterExpression: { appleSub: { $type: 'string' } },
    },
    { key: { tagId: 1 }, sparse: true },
    { key: { campus: 1 } },
  ],
  places: [
    { key: { loc: '2dsphere' } },
    { key: { category: 1, loc: '2dsphere' } },
    { key: { overtureId: 1 }, unique: true, sparse: true },
  ],
  plans: [
    { key: { hostId: 1 } },
    { key: { 'members.userId': 1 } },
    { key: { visibility: 1, startAt: 1 } },
    { key: { shareToken: 1 }, sparse: true },
    { key: { status: 1, completedAt: -1 } },
  ],
  behavior_events: [{ key: { userId: 1, at: -1 } }],
  posts: [
    { key: { authorId: 1, createdAt: -1 } },
    { key: { loc: '2dsphere' } },
    { key: { placeId: 1, createdAt: -1 } },
  ],
  reviews: [{ key: { placeId: 1 } }, { key: { userId: 1, checkinId: 1 }, unique: true }],
  folders: [{ key: { ownerId: 1 } }],
  saves: [
    { key: { userId: 1, type: 1, refId: 1 }, unique: true },
    { key: { userId: 1, createdAt: -1 } },
  ],
  friendships: [{ key: { a: 1 } }, { key: { b: 1 } }],
  tags: [{ key: { ownerId: 1 } }, { key: { placeId: 1 } }],
  user_tiles: [{ key: { userId: 1, x: 1, y: 1 }, unique: true }],
  jobs: [
    { key: { status: 1, runAt: 1 } },
    {
      key: { dedupeKey: 1 },
      unique: true,
      partialFilterExpression: {
        status: { $in: ['pending', 'running'] },
        dedupeKey: { $type: 'string' },
      },
    },
  ],
  sessions: [{ key: { userId: 1, status: 1 } }],
  media: [{ key: { checkinId: 1 } }, { key: { sha256: 1 } }, { key: { userId: 1, createdAt: -1 } }],
  edu_codes: [{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }],
  feed_seen: [
    { key: { userId: 1, day: 1 }, unique: true },
    { key: { createdAt: 1 }, expireAfterSeconds: 3 * 86400 },
  ],
  blocks: [{ key: { blocker: 1, blocked: 1 }, unique: true }, { key: { blocked: 1 } }],
  attest_keys: [{ key: { userId: 1 } }],
  attest_challenges: [{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }],
  rate_limits: [{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }],
  reports: [{ key: { postId: 1 } }, { key: { reporterId: 1 } }],
};

export const PREF_VECTOR_INDEX = 'pref_vector';

export async function ensureMongoIndexes(db: Db, log: (m: string) => void = () => {}) {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );
  for (const [coll, specs] of Object.entries(INDEXES)) {
    // The API and the worker both run this on boot: the other one may create it first (NamespaceExists).
    if (!existing.has(coll))
      await db.createCollection(coll).catch((e) => {
        if ((e as { code?: number }).code !== 48) throw e;
      });
    await db.collection(coll).createIndexes(specs);
  }
  // Vector index for Find-someone matching: one dimension per tag, pre-filtered on campus and openToPlans.
  try {
    const users = db.collection('users');
    const have = await users.listSearchIndexes(PREF_VECTOR_INDEX).toArray();
    if (have.length === 0) {
      await users.createSearchIndex({
        name: PREF_VECTOR_INDEX,
        type: 'vectorSearch',
        definition: {
          fields: [
            { type: 'vector', path: 'prefVector', numDimensions: TAG_DIMS, similarity: 'cosine' },
            { type: 'filter', path: 'campus' },
            { type: 'filter', path: 'openToPlans' },
          ],
        },
      });
      log(`created search index ${PREF_VECTOR_INDEX}`);
    }
  } catch (err) {
    // Plain mongod (no Atlas search) must not block boot; matching degrades to a scan.
    log(`vector index unavailable: ${(err as Error).message}`);
  }
}

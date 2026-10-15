import { TAG_DIMS } from '@itp/shared';
import type { Db, IndexDescription } from 'mongodb';
import { isDupKey } from '../services/users.ts';

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
    // Push: registering a device token moves it off other accounts, and a dead token is pruned by value.
    { key: { pushTokens: 1 }, sparse: true },
    // A handle texts as one account only.
    {
      key: { imessageHandles: 1 },
      unique: true,
      partialFilterExpression: { imessageHandles: { $type: 'string' } },
    },
  ],
  places: [
    { key: { loc: '2dsphere' } },
    { key: { category: 1, loc: '2dsphere' } },
    // Map pins zoomed out: a category in rank order, filtered by the bbox on the index keys (see GET /places).
    { key: { category: 1, been: -1, confidence: -1, loc: '2dsphere' } },
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
  photon_seen: [{ key: { at: 1 }, expireAfterSeconds: 86400 }],
  photon_lines: [
    { key: { spaceId: 1, at: -1 } },
    { key: { at: 1 }, expireAfterSeconds: 2 * 86400 },
  ],
  imessage_links: [{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }, { key: { userId: 1 } }],
  checkin_cooldowns: [{ key: { until: 1 }, expireAfterSeconds: 0 }],
  reports: [{ key: { postId: 1 } }, { key: { reporterId: 1 } }],
};

export const PREF_VECTOR_INDEX = 'pref_vector';

/**
 * One school email, one account (POST /auth/edu/verify turns a clash into 409 EDU_EMAIL_TAKEN). Built apart
 * from INDEXES because older data may break it, and an index that cannot be built must not stop boot.
 */
async function ensureEduEmailIndex(db: Db, log: (m: string) => void) {
  const users = db.collection('users');
  // DELETE /me now clears the hash; accounts deleted earlier would still hold their address.
  await users.updateMany(
    { deletedAt: { $exists: true }, eduEmailHash: { $exists: true } },
    { $unset: { eduEmailHash: '' } },
  );
  try {
    await users.createIndex(
      { eduEmailHash: 1 },
      { unique: true, partialFilterExpression: { eduEmailHash: { $type: 'string' } } },
    );
  } catch (err) {
    if (!isDupKey(err)) throw err;
    // Live accounts that already share an address (from before the one-email rule). Do not guess which to
    // keep: sends still refuse a taken address, but until someone resolves these, two accounts racing to
    // verify the same one can both win.
    const [clashes] = await users
      .aggregate<{ n: number }>([
        { $match: { eduEmailHash: { $type: 'string' } } },
        { $group: { _id: '$eduEmailHash', n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $count: 'n' },
      ])
      .toArray();
    log(
      `WARNING: unique index users.eduEmailHash NOT built: ${clashes?.n ?? '?'} school emails are on several accounts; fix them, then restart`,
    );
  }
}

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
  await ensureEduEmailIndex(db, log);
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

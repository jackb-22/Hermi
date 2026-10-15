import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { ensureMongoIndexes } from '../src/db/indexes.ts';
import { isDupKey, newUser, users } from '../src/services/users.ts';
import { setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.teardown());

const INDEX = 'eduEmailHash_1';
const now = new Date('2026-10-14T12:00:00Z');
const u = (hash?: string, deleted = false) =>
  newUser(now, { ...(hash ? { eduEmailHash: hash } : {}), ...(deleted ? { deletedAt: now } : {}) });
const hasIndex = async () => (await users(t.ctx.db).indexes()).some((i) => i.name === INDEX);

test('the unique index is built, and only constrains accounts that have a hash', async () => {
  const idx = (await users(t.ctx.db).indexes()).find((i) => i.name === INDEX);
  expect(idx).toMatchObject({
    unique: true,
    partialFilterExpression: { eduEmailHash: { $type: 'string' } },
  });
  // Plenty of unverified accounts share "no hash".
  await users(t.ctx.db).insertMany([u(), u(), u()]);
  await users(t.ctx.db).insertOne(u('h-1'));
  const dup = await users(t.ctx.db)
    .insertOne(u('h-1'))
    .catch((e) => e);
  expect(isDupKey(dup)).toBe(true);
});

describe('boot with data from before the rule', () => {
  beforeEach(async () => {
    await users(t.ctx.db)
      .dropIndex(INDEX)
      .catch(() => {});
    await users(t.ctx.db).deleteMany({});
  });

  test('accounts deleted earlier give their hash back, so they cannot block the index', async () => {
    await users(t.ctx.db).insertMany([
      u('shared'),
      u('shared', true),
      u('shared', true),
      u('solo', true),
    ]);
    const log: string[] = [];
    await ensureMongoIndexes(t.ctx.db, (m) => log.push(m));
    expect(await hasIndex()).toBe(true);
    expect(log.filter((m) => /eduEmailHash/.test(m))).toEqual([]);
    const left = await users(t.ctx.db)
      .find({ eduEmailHash: { $exists: true } })
      .toArray();
    expect(left.map((x) => x.eduEmailHash)).toEqual(['shared']);
  });

  test('live accounts sharing an address do not stop boot: it logs a warning and leaves them alone', async () => {
    await users(t.ctx.db).insertMany([
      u('twice'),
      u('twice'),
      u('twice'),
      u('other'),
      u('other'),
      u('fine'),
    ]);
    const log: string[] = [];
    await expect(ensureMongoIndexes(t.ctx.db, (m) => log.push(m))).resolves.toBeUndefined();
    expect(await hasIndex()).toBe(false);
    const warn = log.find((m) => /eduEmailHash/.test(m));
    expect(warn).toMatch(/WARNING.*NOT built.*2 school emails/);
    expect(await users(t.ctx.db).countDocuments({ eduEmailHash: { $exists: true } })).toBe(6);

    // Once they are sorted out, the next boot builds it.
    await users(t.ctx.db).deleteMany({ eduEmailHash: { $in: ['twice', 'other'] } });
    await users(t.ctx.db).insertOne(u('twice'));
    await ensureMongoIndexes(t.ctx.db);
    expect(await hasIndex()).toBe(true);
  });
});

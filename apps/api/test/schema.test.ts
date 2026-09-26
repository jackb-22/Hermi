import { afterAll, beforeAll, expect, test } from 'vitest';
import { ensureSchema } from '../src/boot.ts';
import { PREF_VECTOR_INDEX } from '../src/db/indexes.ts';
import { setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.teardown());

test('schema bootstrap is idempotent', async () => {
  await ensureSchema(t.ctx);
  await ensureSchema(t.ctx);
});

test('hypertables and continuous aggregates exist in the test schema', async () => {
  const { rows } = await t.ctx.tiger.query(
    `select hypertable_name from timescaledb_information.hypertables where hypertable_schema = current_schema()`,
  );
  expect(rows.map((r) => r.hypertable_name).sort()).toEqual(
    [
      'checkins',
      'hangouts',
      'location_points',
      'movement_segments',
      'tag_reads',
      'xp_events',
    ].sort(),
  );
  const caggs = await t.ctx.tiger.query(
    `select view_name from timescaledb_information.continuous_aggregates where view_schema = current_schema()`,
  );
  expect(caggs.rows.map((r) => r.view_name).sort()).toEqual(['movement_daily', 'xp_daily']);
});

test('xp_daily is real-time: fresh events show without a refresh', async () => {
  await t.ctx.tiger.query(
    `insert into xp_events (time, user_id, campus, kind, xp) values (now(), 'u1', 'Columbia', 'checkin_tag', 15)`,
  );
  const { rows } = await t.ctx.tiger.query(
    `select sum(xp) as xp from xp_daily where user_id = 'u1'`,
  );
  expect(rows[0].xp).toBe(15);
});

test('mongo geo index and vector search index exist', async () => {
  const idx = await t.ctx.db.collection('places').indexes();
  expect(idx.some((i) => i.key.loc === '2dsphere')).toBe(true);
  const search = await t.ctx.db.collection('users').listSearchIndexes(PREF_VECTOR_INDEX).toArray();
  expect(search).toHaveLength(1);
});

import { MongoClient } from 'mongodb';
import pg from 'pg';
import { loadConfig } from '../src/config.ts';

/** Test databases and schemas carry their creation time (base 36 seconds): `itp_test_<time>_<rand>`, `t_<time>_<rand>`. */
export const testSuffix = (rand: string) => `${Math.floor(Date.now() / 1000).toString(36)}_${rand}`;
const STALE_S = 3600;

/**
 * Sweeps test databases left behind by interrupted runs (their teardown never ran). Each one carries an Atlas
 * vector index that mongot keeps syncing, so a pile of them slows every later run. Only stale ones go, so a
 * concurrent run keeps its own.
 */
export default async function setup() {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
  const now = Date.now() / 1000;
  const stale = (name: string, prefix: string) => {
    const m = new RegExp(`^${prefix}([0-9a-z]+)_[0-9a-f]+$`).exec(name);
    // Old-style names (no timestamp) predate this sweep and are always stale.
    if (!m) return new RegExp(`^${prefix}[0-9a-f]{8}$`).test(name);
    return now - Number.parseInt(m[1]!, 36) > STALE_S;
  };
  const mongo = new MongoClient(config.MONGO_URI);
  try {
    await mongo.connect();
    const { databases } = await mongo.db().admin().listDatabases({ nameOnly: true });
    for (const d of databases)
      if (stale(d.name, 'itp_test_')) await mongo.db(d.name).dropDatabase();
  } finally {
    await mongo.close();
  }
  const client = new pg.Client({ connectionString: config.TIGER_URL });
  try {
    await client.connect();
    const { rows } = await client.query<{ s: string }>(
      "select schema_name as s from information_schema.schemata where schema_name like 't\\_%'",
    );
    for (const r of rows) if (stale(r.s, 't_')) await client.query(`drop schema "${r.s}" cascade`);
  } finally {
    await client.end();
  }
}

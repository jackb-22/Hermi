import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const dir = fileURLToPath(new URL('./migrations/', import.meta.url));

/**
 * Applies numbered SQL files once each. Statements run one at a time and outside a transaction,
 * because continuous aggregates cannot be created inside one; so the SQL is written to be re-runnable
 * (a crash mid-file is finished by the next boot). The API and the worker both migrate on boot, so an
 * advisory lock per schema lets one of them do it while the other waits.
 */
export async function migrateTiger(pool: pg.Pool, log: (m: string) => void = () => {}) {
  const client = await pool.connect();
  const lock = "hashtext('itp_migrate:' || current_schema())";
  try {
    await client.query(`SELECT pg_advisory_lock(${lock})`);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      if (done.has(file)) continue;
      const sql = readFileSync(dir + file, 'utf8').replace(/^\s*--.*$/gm, '');
      for (const stmt of sql
        .split(/;\s*$/m)
        .map((s) => s.trim())
        .filter(Boolean)) {
        await client.query(stmt);
      }
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      log(`applied ${file}`);
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${lock})`).catch(() => {});
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { loadConfig } = await import('../config.ts');
  const { createContext, closeContext } = await import('../boot.ts');
  const { ensureMongoIndexes } = await import('./indexes.ts');
  const ctx = await createContext(loadConfig());
  await migrateTiger(ctx.tiger, console.log);
  await ensureMongoIndexes(ctx.db, console.log);
  await closeContext(ctx);
}

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const dir = fileURLToPath(new URL('./migrations/', import.meta.url));

/**
 * Applies numbered SQL files once each. Statements run one at a time and outside a transaction,
 * because continuous aggregates cannot be created inside one.
 */
export async function migrateTiger(pool: pg.Pool, log: (m: string) => void = () => {}) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(dir + file, 'utf8').replace(/^\s*--.*$/gm, '');
    for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    log(`applied ${file}`);
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

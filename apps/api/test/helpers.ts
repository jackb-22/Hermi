import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { closeContext, createContext } from '../src/boot.ts';
import { loadConfig } from '../src/config.ts';
import type { AppContext } from '../src/context.ts';

/** Isolated Mongo database + Postgres schema per test file, against the docker compose infra. */
export async function setupTestApp(overrides: Record<string, string> = {}) {
  const suffix = randomBytes(4).toString('hex');
  const schema = `t_${suffix}`;
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    MONGO_DB: `itp_test_${suffix}`,
    TIGER_SCHEMA: schema,
    FAKE_PROVIDERS: '1',
    ATTEST_MODE: 'off',
    RUN_WORKER: 'off',
    ...overrides,
  });
  const admin = new pg.Client({ connectionString: config.TIGER_URL });
  await admin.connect();
  await admin.query(`create schema ${schema}`);
  await admin.end();

  const ctx: AppContext = await createContext(config);
  const app: FastifyInstance = await buildApp(ctx);
  await app.ready();

  const teardown = async () => {
    await app.close();
    await ctx.db.dropDatabase().catch(() => {});
    await ctx.tiger.query(`drop schema ${schema} cascade`).catch(() => {});
    await closeContext(ctx);
  };
  return { app, ctx, teardown };
}

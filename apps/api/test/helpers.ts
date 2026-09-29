import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { closeContext, createContext, ensureSchema } from '../src/boot.ts';
import { loadConfig } from '../src/config.ts';
import type { AppContext } from '../src/context.ts';
import { testSuffix } from './globalSetup.ts';

/**
 * Keys that switch a provider from fake to real. A key exported in the shell (or loaded from .env) would make tests
 * call Gemini, Google Routes, Photon… for real, so they are dropped unless LIVE=1.
 */
const LIVE_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_MAPS_KEY',
  'APPLE_MAPS_KEY_ID',
  'APPLE_MAPS_PRIVATE_KEY',
  'WEATHERKIT_KEY_ID',
  'WEATHERKIT_PRIVATE_KEY',
  'BACKBOARD_API_KEY',
  'SPECTRUM_PROJECT_ID',
  'SPECTRUM_PROJECT_SECRET',
  'PHOTON_AGENT_ADDRESS',
  'REALITY_DEFENDER_KEY',
  'RESEND_API_KEY',
];

export function testEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.LIVE === '1') return { ...env };
  const out = { ...env };
  for (const k of LIVE_KEYS) delete out[k];
  return out;
}

/** Isolated Mongo database + Postgres schema per test file, against the docker compose infra. */
export async function setupTestApp(
  overrides: Record<string, string> = {},
  extend?: (app: FastifyInstance) => void,
) {
  const suffix = testSuffix(randomBytes(3).toString('hex'));
  const schema = `t_${suffix}`;
  const config = loadConfig({
    ...testEnv(),
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
  await ensureSchema(ctx);
  const app: FastifyInstance = await buildApp(ctx);
  extend?.(app);
  await app.ready();

  const teardown = async () => {
    await app.close();
    await ctx.db.dropDatabase().catch(() => {});
    await ctx.tiger.query(`drop schema ${schema} cascade`).catch(() => {});
    await closeContext(ctx);
  };
  return { app, ctx, teardown };
}

type App = Awaited<ReturnType<typeof setupTestApp>>['app'];

/** Signs in (creating if needed) a dev user; returns token, id and an auth header. */
export async function devLogin(app: App, username: string) {
  const res = await app.inject({ method: 'POST', url: '/v1/auth/dev', payload: { username } });
  if (res.statusCode !== 200) throw new Error(`dev login failed: ${res.body}`);
  const body = res.json();
  return {
    token: body.token as string,
    id: body.user.id as string,
    headers: { authorization: `Bearer ${body.token}` },
  };
}

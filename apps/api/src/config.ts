import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === '1' || v === 'true');
const optStr = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(16).default('dev-secret-change-me-please-32chars!!'),
  DEV_ROUTES: bool.default(false),
  ATTEST_MODE: z.enum(['off', 'log', 'enforce']).default('off'),
  FAKE_PROVIDERS: bool.default(true),
  RUN_WORKER: z.enum(['inline', 'off']).default('inline'),
  /** Apply Tiger migrations and Mongo indexes on boot (idempotent). */
  AUTO_MIGRATE: bool.default(true),

  MONGO_URI: z.string().default('mongodb://localhost:27017/?directConnection=true'),
  MONGO_DB: z.string().default('itp'),
  TIGER_URL: z.string().default('postgres://postgres:postgres@localhost:5432/itp'),
  /** Postgres schema to use; tests set a unique one per file. */
  TIGER_SCHEMA: z.string().default('public'),

  S3_ENDPOINT: optStr,
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('itp-media'),
  S3_KEY: optStr,
  S3_SECRET: optStr,
  S3_FORCE_PATH_STYLE: bool.default(false),
  CDN_BASE_URL: optStr,

  APPLE_TEAM_ID: optStr,
  APPLE_BUNDLE_ID: optStr,
  APPLE_MAPS_KEY_ID: optStr,
  APPLE_MAPS_PRIVATE_KEY: optStr,
  WEATHERKIT_KEY_ID: optStr,
  WEATHERKIT_PRIVATE_KEY: optStr,

  GEMINI_API_KEY: optStr,
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GOOGLE_MAPS_KEY: optStr,
  BACKBOARD_API_KEY: optStr,
  PHOTON_API_KEY: optStr,
  REALITY_DEFENDER_KEY: optStr,
  RESEND_API_KEY: optStr,
  EMAIL_FROM: optStr,
});

export type Config = z.infer<typeof Env> & { devRoutes: boolean };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const c = Env.parse(env);
  return { ...c, devRoutes: c.DEV_ROUTES || c.NODE_ENV !== 'production' };
}

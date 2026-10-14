import { describe, expect, test } from 'vitest';
import { assertBootable, DEV_JWT_SECRET, loadConfig, productionGaps } from '../src/config.ts';

const ready = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-real-secret-that-is-long-enough',
  FAKE_PROVIDERS: '0',
  PUBLIC_BASE_URL: 'https://api.hermi.world',
  APPLE_TEAM_ID: 'TEAM',
  APPLE_BUNDLE_ID: 'world.hermi.app',
  GEMINI_API_KEY: 'g',
  RESEND_API_KEY: 'r',
  EMAIL_FROM: 'Hermi <codes@hermi.world>',
  S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  S3_KEY: 'k',
  S3_SECRET: 's',
};

describe('production boot checks', () => {
  test('a complete production env boots', () => {
    expect(productionGaps(loadConfig(ready))).toEqual([]);
    expect(() => assertBootable(loadConfig(ready))).not.toThrow();
  });

  test('development and test are never blocked', () => {
    expect(productionGaps(loadConfig({}))).toEqual([]);
    expect(productionGaps(loadConfig({ NODE_ENV: 'test' }))).toEqual([]);
  });

  test('the built-in JWT secret, dev access, fakes and http links each stop boot', () => {
    const gaps = (extra: Record<string, string | undefined>) =>
      productionGaps(loadConfig({ ...ready, ...extra }));
    expect(gaps({ JWT_SECRET: undefined })).toEqual(['JWT_SECRET is the built-in development secret']);
    expect(gaps({ JWT_SECRET: DEV_JWT_SECRET })).toHaveLength(1);
    expect(gaps({ DEV_ROUTES: '1' })).toEqual(['DEV_ROUTES and DEV_TOKEN must be unset']);
    expect(gaps({ DEV_TOKEN: 'team-token' })).toEqual(['DEV_ROUTES and DEV_TOKEN must be unset']);
    expect(gaps({ FAKE_PROVIDERS: undefined })).toEqual(['FAKE_PROVIDERS must be 0']);
    expect(gaps({ PUBLIC_BASE_URL: undefined })).toEqual(['PUBLIC_BASE_URL must be https']);
  });

  test('missing keys are listed together, with a readable error', () => {
    const c = loadConfig({ ...ready, RESEND_API_KEY: '', S3_KEY: undefined });
    expect(productionGaps(c)).toEqual(['missing RESEND_API_KEY, S3_KEY']);
    expect(() => assertBootable(c)).toThrow(/Refusing to start in production:\n- missing RESEND_API_KEY, S3_KEY/);
  });
});

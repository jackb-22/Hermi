import { describe, expect, test } from 'vitest';
import { assertBootable, DEV_JWT_SECRET, loadConfig, productionGaps } from '../src/config.ts';

const ready = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-real-secret-that-is-long-enough',
  FAKE_PROVIDERS: '0',
  PUBLIC_BASE_URL: 'https://api.hermi.world',
  APPLE_TEAM_ID: 'TEAM',
  APPLE_BUNDLE_ID: 'world.hermi.app',
  APPLE_AUTH_KEY_ID: 'AUTHKEY123',
  APPLE_AUTH_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
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
    expect(gaps({ JWT_SECRET: undefined })).toEqual([
      'JWT_SECRET is the built-in development secret',
    ]);
    expect(gaps({ JWT_SECRET: DEV_JWT_SECRET })).toHaveLength(1);
    expect(gaps({ JWT_SECRET: '' })).toEqual(['JWT_SECRET is the built-in development secret']);
    expect(gaps({ DEV_ROUTES: '1' })).toEqual(['DEV_ROUTES and DEV_TOKEN must be unset']);
    expect(gaps({ DEV_TOKEN: 'team-token' })).toEqual(['DEV_ROUTES and DEV_TOKEN must be unset']);
    expect(gaps({ FAKE_PROVIDERS: undefined })).toEqual(['FAKE_PROVIDERS must be 0']);
    expect(gaps({ PUBLIC_BASE_URL: undefined })).toEqual(['PUBLIC_BASE_URL must be https']);
  });

  test('production cannot boot without the Sign in with Apple key', () => {
    const c = loadConfig({ ...ready, APPLE_AUTH_KEY_ID: undefined, APPLE_AUTH_PRIVATE_KEY: '' });
    expect(productionGaps(c)).toEqual(['missing APPLE_AUTH_KEY_ID, APPLE_AUTH_PRIVATE_KEY']);
  });

  test('missing keys are listed together, with a readable error', () => {
    const c = loadConfig({ ...ready, RESEND_API_KEY: '', S3_KEY: undefined });
    expect(productionGaps(c)).toEqual(['missing RESEND_API_KEY, S3_KEY']);
    expect(() => assertBootable(c)).toThrow(
      /Refusing to start in production:\n- missing RESEND_API_KEY, S3_KEY/,
    );
  });
});

describe('App Review sign-in (REVIEW_EMAIL, REVIEW_CODE)', () => {
  test('unset or blank leaves the path off, and production boots either way', () => {
    for (const env of [{}, { REVIEW_EMAIL: '', REVIEW_CODE: '' }, { REVIEW_EMAIL: '  ' }]) {
      const c = loadConfig({ ...ready, ...env });
      expect(c.REVIEW_EMAIL).toBeUndefined();
      expect(c.REVIEW_CODE).toBeUndefined();
      expect(productionGaps(c)).toEqual([]);
    }
  });

  test('both set: the address is trimmed and lowercased, the code trimmed', () => {
    const c = loadConfig({
      ...ready,
      REVIEW_EMAIL: ' App.Review@Hermi.World ',
      REVIEW_CODE: ' 048213 ',
    });
    expect(c.REVIEW_EMAIL).toBe('app.review@hermi.world');
    expect(c.REVIEW_CODE).toBe('048213');
    expect(productionGaps(c)).toEqual([]);
  });

  test.each(['12345', '1234567', 'abcdef', '12 456', '１２３４５６'])(
    'a code that is not exactly 6 digits is refused, without echoing it: %s',
    (code) => {
      let message = '';
      try {
        loadConfig({ ...ready, REVIEW_EMAIL: 'review@hermi.world', REVIEW_CODE: code });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/REVIEW_CODE must be exactly 6 digits/);
      expect(message).not.toContain(code);
    },
  );

  test('the address must be an email address', () => {
    expect(() => loadConfig({ REVIEW_EMAIL: 'not-an-email', REVIEW_CODE: '123456' })).toThrow(
      /REVIEW_EMAIL/,
    );
  });

  test('one without the other is refused, so a half-set path cannot go unnoticed', () => {
    for (const env of [{ REVIEW_EMAIL: 'review@hermi.world' }, { REVIEW_CODE: '123456' }]) {
      expect(() => loadConfig({ ...ready, ...env })).toThrow(
        /REVIEW_EMAIL and REVIEW_CODE must be set together/,
      );
    }
  });
});

describe('REVIEW_FRIEND_ID', () => {
  test('unset or blank is off; a value is trimmed; production boots either way', () => {
    for (const REVIEW_FRIEND_ID of [undefined, '', '   ']) {
      const c = loadConfig({ ...ready, REVIEW_FRIEND_ID });
      expect(c.REVIEW_FRIEND_ID).toBeUndefined();
      expect(productionGaps(c)).toEqual([]);
    }
    const c = loadConfig({
      ...ready,
      REVIEW_EMAIL: 'review@hermi.world',
      REVIEW_CODE: '123456',
      REVIEW_FRIEND_ID: ' abc123 ',
    });
    expect(c.REVIEW_FRIEND_ID).toBe('abc123');
    expect(productionGaps(c)).toEqual([]);
  });

  test('it is independent of the review address: alone it loads, and does nothing', () => {
    expect(loadConfig({ ...ready, REVIEW_FRIEND_ID: 'abc123' }).REVIEW_FRIEND_ID).toBe('abc123');
  });
});

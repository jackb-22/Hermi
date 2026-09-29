import { afterAll, beforeAll, expect, test } from 'vitest';
import { describeProviders } from '../src/providers/index.ts';
import { setupTestApp, testEnv } from './helpers.ts';

// A real key in the shell (or .env) must never reach the test app: tests stay on the fakes unless LIVE=1.
const saved = { ...process.env };
let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'AIza-not-a-real-key';
  process.env.GOOGLE_MAPS_KEY = 'AIza-not-a-real-key';
  process.env.SPECTRUM_PROJECT_ID = 'p';
  process.env.SPECTRUM_PROJECT_SECRET = 's';
  t = await setupTestApp();
});
afterAll(async () => {
  await t.teardown();
  process.env = saved;
});

test('provider keys in the environment are dropped for tests', () => {
  const p = describeProviders(t.ctx.providers) as Record<string, string>;
  expect(p.llm).toBe('fake');
  expect(p.messenger).not.toBe('photon');
  expect(p.eta).not.toMatch(/google/i);
});

test('LIVE=1 keeps them', () => {
  expect(testEnv({ LIVE: '1', GEMINI_API_KEY: 'k' }).GEMINI_API_KEY).toBe('k');
  expect(testEnv({ GEMINI_API_KEY: 'k' }).GEMINI_API_KEY).toBeUndefined();
});

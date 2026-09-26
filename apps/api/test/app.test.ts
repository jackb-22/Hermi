import { afterAll, beforeAll, expect, test } from 'vitest';
import { setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.teardown());

test('GET /health reports both databases', async () => {
  const res = await t.app.inject('/health');
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ ok: true, mongo: true, tiger: true });
});

test('unknown routes return the error envelope', async () => {
  const res = await t.app.inject('/v1/nope');
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
});

test('openapi document is served', async () => {
  const res = await t.app.inject('/openapi.json');
  expect(res.statusCode).toBe(200);
  expect(res.json().openapi).toMatch(/^3\./);
});

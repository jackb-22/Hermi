import { afterAll, beforeAll, expect, test } from 'vitest';
import { page } from '../src/routes/web.ts';
import { setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
  t = await setupTestApp({ APPLE_TEAM_ID: 'ABCDE12345', APPLE_BUNDLE_ID: 'tech.example.app' });
});
afterAll(() => t.teardown());

test('AASA lists the app and tag paths', async () => {
  const r = await t.app.inject('/.well-known/apple-app-site-association');
  expect(r.headers['content-type']).toMatch(/application\/json/);
  expect(r.json().applinks.details[0]).toEqual({
    appIDs: ['ABCDE12345.tech.example.app'],
    components: [{ '/': '/c/*' }, { '/': '/t/*' }, { '/': '/p/*' }],
  });
});

test('tag URLs render an install page in Safari', async () => {
  const r = await t.app.inject('/c/UNKNOWN?k=abc');
  expect(r.statusCode).toBe(200);
  expect(r.body).toContain('It only counts if you go');
});

// Every visitor's IP address would reach Google. The CSS falls back to monospace when Silkscreen is not installed.
test('pages load nothing from Google Fonts', async () => {
  const rendered = [page('Title', '<p>Body</p>'), (await t.app.inject('/c/UNKNOWN?k=abc')).body];
  for (const html of rendered) {
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
    expect(html).toContain('font-family:Silkscreen,monospace');
  }
});

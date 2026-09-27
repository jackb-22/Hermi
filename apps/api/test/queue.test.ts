import { afterAll, beforeAll, expect, test } from 'vitest';
import { claim, enqueue, Worker } from '../src/jobs/queue.ts';
import { setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.teardown());

const quiet = { info: () => {}, error: () => {} };

test('concurrent claims never hand the same job to two workers', async () => {
  for (let i = 0; i < 20; i++) await enqueue(t.ctx, 'count', { i });
  const claimed = await Promise.all(Array.from({ length: 40 }, () => claim(t.ctx, ['count'])));
  const ids = claimed.filter(Boolean).map((j) => j!._id);
  expect(ids).toHaveLength(20);
  expect(new Set(ids).size).toBe(20);
});

test('failures back off and die after maxAttempts; successes finish', async () => {
  let calls = 0;
  const w = new Worker(
    t.ctx,
    {
      flaky: async () => {
        calls++;
        throw new Error('boom');
      },
      fine: async () => {},
    },
    quiet,
  );
  const id = await enqueue(t.ctx, 'flaky', {}, { maxAttempts: 3 });
  const ok = await enqueue(t.ctx, 'fine', {});
  for (let i = 0; i < 3; i++) {
    await w.drain();
    t.ctx.clock.offsetMs += 10 * 60_000; // jump past the backoff
  }
  t.ctx.clock.offsetMs = 0;
  const jobs = t.ctx.db.collection('jobs');
  expect(calls).toBe(3);
  expect(await jobs.findOne({ _id: id } as never)).toMatchObject({
    status: 'dead',
    attempts: 3,
    lastError: expect.stringContaining('boom'),
  });
  expect(await jobs.findOne({ _id: ok } as never)).toMatchObject({ status: 'done' });
});

test('an expired lease is reclaimed', async () => {
  await enqueue(t.ctx, 'lease', {});
  const first = await claim(t.ctx, ['lease']);
  expect(await claim(t.ctx, ['lease'])).toBeNull();
  t.ctx.clock.offsetMs = 2 * 60_000;
  const again = await claim(t.ctx, ['lease']);
  t.ctx.clock.offsetMs = 0;
  expect(again?._id).toBe(first?._id);
  expect(again?.attempts).toBe(2);
});

test('dedupe key keeps one live job per key', async () => {
  const a = await enqueue(t.ctx, 'finalize', { s: 1 }, { dedupeKey: 'session:1' });
  const b = await enqueue(t.ctx, 'finalize', { s: 1 }, { dedupeKey: 'session:1' });
  expect(a).toBe(b);
  expect(await t.ctx.db.collection('jobs').countDocuments({ dedupeKey: 'session:1' })).toBe(1);
});

test('a slow job does not hold up the jobs behind it (a recap behind a clip transcode or a detector poll)', async () => {
  const done: Record<string, number> = {};
  const handlers = {
    slow: async () => {
      await new Promise((r) => setTimeout(r, 1500));
      done.slow = performance.now();
    },
    recap: async () => {
      done.recap = performance.now();
    },
  };
  const waitFor = async (id: string) => {
    const jobs = t.ctx.db.collection('jobs');
    while ((await jobs.findOne({ _id: id } as never))?.status !== 'done')
      await new Promise((r) => setTimeout(r, 20));
  };
  const timeToRecap = async (concurrency: number) => {
    const w = new Worker(t.ctx, handlers, quiet);
    await enqueue(t.ctx, 'slow', {});
    const start = performance.now();
    const recap = await enqueue(t.ctx, 'recap', {});
    w.start(50, concurrency);
    await waitFor(recap);
    const ms = done.recap! - start;
    await w.stop();
    return ms;
  };
  const serial = await timeToRecap(1);
  const parallel = await timeToRecap(4);
  console.log(
    `recap behind a 1.5 s job: ${Math.round(serial)} ms serial, ${Math.round(parallel)} ms with 4 loops`,
  );
  expect(serial).toBeGreaterThan(1500);
  expect(parallel).toBeLessThan(500);
});

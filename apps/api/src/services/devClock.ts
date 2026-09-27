import type { AppContext } from '../context.ts';

/**
 * The dev clock (POST /dev/clock) is per process, but the worker is its own process in production. The API saves
 * the offset here when it changes; the worker follows it, so jobs see the same shifted time as requests.
 */
const settings = (ctx: AppContext) =>
  ctx.db.collection<{ _id: string; offsetMs: number }>('dev_settings');

export async function saveDevClock(ctx: AppContext) {
  await settings(ctx).updateOne(
    { _id: 'clock' },
    { $set: { offsetMs: ctx.clock.offsetMs } },
    { upsert: true },
  );
}

/** Reads the saved offset into this process's clock (API boot, and each worker poll). */
export async function syncDevClock(ctx: AppContext) {
  if (!ctx.config.devRoutes) return;
  ctx.clock.offsetMs = (await settings(ctx).findOne({ _id: 'clock' }))?.offsetMs ?? 0;
}

/** Worker: follow the API's dev clock. Only the API writes it, so the two never fight. */
export function followDevClock(ctx: AppContext, everyMs = 2000) {
  if (!ctx.config.devRoutes) return;
  setInterval(() => {
    syncDevClock(ctx).catch(() => {});
  }, everyMs).unref();
}

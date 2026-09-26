import type { JobHandler } from './queue.ts';

/** Job type → handler. Each feature registers its jobs here. */
export const handlers: Record<string, JobHandler> = {};

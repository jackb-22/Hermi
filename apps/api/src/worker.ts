import { closeContext, createContext, ensureSchema } from './boot.ts';
import { handlers } from './jobs/handlers.ts';
import { Worker } from './jobs/queue.ts';

// Standalone worker component (App Platform "worker"): media, matching, notifications, session finalize.
const ctx = await createContext();
if (ctx.config.AUTO_MIGRATE) await ensureSchema(ctx, console.log);
const worker = new Worker(ctx, handlers);
worker.start();

const stop = async () => {
  await worker.stop();
  await closeContext(ctx);
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

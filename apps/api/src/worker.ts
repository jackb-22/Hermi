import { closeContext, createContext, ensureSchema } from './boot.ts';

// Standalone worker component. The job loop lands with the queue (B12); until then it only keeps the schema current.
const ctx = await createContext();
if (ctx.config.AUTO_MIGRATE) await ensureSchema(ctx, console.log);
console.log('[worker] up; no job handlers registered yet');

const stop = async () => {
  await closeContext(ctx);
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);

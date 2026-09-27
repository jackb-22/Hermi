import { buildApp } from './app.ts';
import { closeContext, createContext, ensureSchema } from './boot.ts';
import { handlers } from './jobs/handlers.ts';
import { Worker } from './jobs/queue.ts';
import { startGroupChat } from './services/groupChat.ts';
import { scheduleWeeklyNudge } from './services/nudges.ts';

const ctx = await createContext();
if (ctx.config.AUTO_MIGRATE) await ensureSchema(ctx, console.log);
const app = await buildApp(ctx);
// Dev convenience: one process runs API and worker. Production runs the worker as its own component.
const worker = ctx.config.RUN_WORKER === 'inline' ? new Worker(ctx, handlers) : null;
worker?.start();
if (worker) {
  startGroupChat(ctx);
  await scheduleWeeklyNudge(ctx);
}

const shutdown = async () => {
  await app.close();
  await worker?.stop();
  await ctx.providers.messenger.stop();
  await closeContext(ctx);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: ctx.config.PORT, host: ctx.config.HOST });

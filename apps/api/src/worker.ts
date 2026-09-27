import { closeContext, createContext, ensureSchema } from './boot.ts';
import { registerHooks } from './hooks.ts';
import { handlers } from './jobs/handlers.ts';
import { Worker } from './jobs/queue.ts';
import { startGroupChat } from './services/groupChat.ts';

// Standalone worker component (App Platform "worker"): media, matching, notifications, session finalize,
// and the plan group chats' iMessage agent (one long-lived Photon stream).
registerHooks();
const ctx = await createContext();
if (ctx.config.AUTO_MIGRATE) await ensureSchema(ctx, console.log);
const worker = new Worker(ctx, handlers);
worker.start();
startGroupChat(ctx);

const stop = async () => {
  await worker.stop();
  await ctx.providers.messenger.stop();
  await closeContext(ctx);
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

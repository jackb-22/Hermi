import { buildApp } from './app.ts';
import { closeContext, createContext } from './boot.ts';

const ctx = await createContext();
const app = await buildApp(ctx);

const shutdown = async () => {
  await app.close();
  await closeContext(ctx);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: ctx.config.PORT, host: ctx.config.HOST });

/**
 * Applies Tiger migrations and Mongo indexes, then exits. The API and worker also do this on boot (AUTO_MIGRATE).
 *
 *   pnpm --filter @itp/api migrate                                   # local .env
 *   pnpm --filter @itp/api exec tsx --env-file=../../.env.production scripts/migrate.ts
 */
import { closeContext, createContext, ensureSchema } from '../src/boot.ts';

const ctx = await createContext();
await ensureSchema(ctx, console.log);
await closeContext(ctx);
console.log('schema ready');

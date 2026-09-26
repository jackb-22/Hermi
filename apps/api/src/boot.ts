import { type Config, loadConfig } from './config.ts';
import { type AppContext, Clock } from './context.ts';
import { ensureMongoIndexes } from './db/indexes.ts';
import { migrateTiger } from './db/migrate.ts';
import { connectMongo } from './db/mongo.ts';
import { createTigerPool } from './db/tiger.ts';
import { createProviders } from './providers/index.ts';

export async function createContext(config: Config = loadConfig()): Promise<AppContext> {
  const { client, db } = await connectMongo(config.MONGO_URI, config.MONGO_DB);
  const tiger = createTigerPool(config.TIGER_URL, config.TIGER_SCHEMA);
  return {
    config,
    mongo: client,
    db,
    tiger,
    clock: new Clock(),
    providers: createProviders(config),
  };
}

export async function closeContext(ctx: AppContext) {
  await Promise.allSettled([ctx.mongo.close(), ctx.tiger.end()]);
}

export async function ensureSchema(ctx: AppContext, log: (m: string) => void = () => {}) {
  await migrateTiger(ctx.tiger, log);
  await ensureMongoIndexes(ctx.db, log);
}

import { loadConfig, type Config } from './config.ts';
import { Clock, type AppContext } from './context.ts';
import { connectMongo } from './db/mongo.ts';
import { createTigerPool } from './db/tiger.ts';

export async function createContext(config: Config = loadConfig()): Promise<AppContext> {
  const { client, db } = await connectMongo(config.MONGO_URI, config.MONGO_DB);
  const tiger = createTigerPool(config.TIGER_URL, config.TIGER_SCHEMA);
  return { config, mongo: client, db, tiger, clock: new Clock() };
}

export async function closeContext(ctx: AppContext) {
  await Promise.allSettled([ctx.mongo.close(), ctx.tiger.end()]);
}

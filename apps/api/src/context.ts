import type { Db, MongoClient } from 'mongodb';
import type pg from 'pg';
import type { Config } from './config.ts';

/** A clock the dev routes can shift, so streaks and score decay are testable without waiting. */
export class Clock {
  offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
}

export interface AppContext {
  config: Config;
  mongo: MongoClient;
  db: Db;
  tiger: pg.Pool;
  clock: Clock;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

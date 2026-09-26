import { newId } from '@itp/shared';
import type { Db } from 'mongodb';
import type { AppContext } from '../context.ts';

export interface JobDoc<P = unknown> {
  _id: string;
  type: string;
  payload: P;
  status: 'pending' | 'running' | 'done' | 'dead';
  runAt: Date;
  lockedUntil?: Date;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  /** At most one live job per key (e.g. one finalize per session). */
  dedupeKey?: string;
  createdAt: Date;
  doneAt?: Date;
}

export type JobHandler = (ctx: AppContext, payload: never, job: JobDoc) => Promise<void>;

const LEASE_MS = 60_000;
const jobs = (db: Db) => db.collection<JobDoc>('jobs');

export async function enqueue<P>(
  ctx: Pick<AppContext, 'db' | 'clock'>,
  type: string,
  payload: P,
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
): Promise<string> {
  const now = ctx.clock.now();
  const doc: JobDoc<P> = {
    _id: newId(),
    type,
    payload,
    status: 'pending',
    runAt: opts.runAt ?? now,
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? 5,
    dedupeKey: opts.dedupeKey,
    createdAt: now,
  };
  if (opts.dedupeKey) {
    const r = await jobs(ctx.db).findOneAndUpdate(
      { dedupeKey: opts.dedupeKey, status: { $in: ['pending', 'running'] } },
      { $setOnInsert: doc as JobDoc },
      { upsert: true, returnDocument: 'after' },
    );
    return r!._id;
  }
  await jobs(ctx.db).insertOne(doc as JobDoc);
  return doc._id;
}

/** Atomically claims the next due job (or one whose lease expired). */
export async function claim(ctx: Pick<AppContext, 'db' | 'clock'>, types: string[]): Promise<JobDoc | null> {
  const now = ctx.clock.now();
  return jobs(ctx.db).findOneAndUpdate(
    {
      type: { $in: types },
      $or: [{ status: 'pending', runAt: { $lte: now } }, { status: 'running', lockedUntil: { $lt: now } }],
    },
    { $set: { status: 'running', lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, returnDocument: 'after' },
  );
}

async function finish(ctx: AppContext, job: JobDoc, err?: unknown) {
  const now = ctx.clock.now();
  if (!err) {
    await jobs(ctx.db).updateOne({ _id: job._id }, { $set: { status: 'done', doneAt: now }, $unset: { lockedUntil: '' } });
    return;
  }
  const dead = job.attempts >= job.maxAttempts;
  const backoffMs = Math.min(5 * 60_000, 2 ** job.attempts * 2_000);
  await jobs(ctx.db).updateOne(
    { _id: job._id },
    {
      $set: { status: dead ? 'dead' : 'pending', runAt: new Date(now.getTime() + backoffMs), lastError: String((err as Error)?.stack ?? err).slice(0, 2000) },
      $unset: { lockedUntil: '' },
    },
  );
}

export class Worker {
  private stopped = false;
  private idle?: Promise<void>;
  constructor(
    private ctx: AppContext,
    private handlers: Record<string, JobHandler>,
    private log: { info: (m: string) => void; error: (o: object, m: string) => void } = { info: console.log, error: (o, m) => console.error(m, o) },
  ) {}

  /** Runs one due job if any; returns whether it did. */
  async runOnce(): Promise<boolean> {
    const job = await claim(this.ctx, Object.keys(this.handlers));
    if (!job) return false;
    try {
      await this.handlers[job.type]!(this.ctx, job.payload as never, job);
      await finish(this.ctx, job);
    } catch (err) {
      this.log.error({ err, jobId: job._id, type: job.type, attempt: job.attempts }, 'job failed');
      await finish(this.ctx, job, err);
    }
    return true;
  }

  /** Processes every job that is due now; used by tests and scripts. */
  async drain(max = 1000): Promise<number> {
    let n = 0;
    while (n < max && (await this.runOnce())) n++;
    return n;
  }

  start(pollMs = 500) {
    const loop = async () => {
      while (!this.stopped) {
        const did = await this.runOnce().catch((err) => {
          this.log.error({ err }, 'worker loop error');
          return false;
        });
        if (!did) await new Promise((r) => setTimeout(r, pollMs));
      }
    };
    this.idle = loop();
    this.log.info(`[worker] running ${Object.keys(this.handlers).join(', ') || '(no handlers)'}`);
  }

  async stop() {
    this.stopped = true;
    await this.idle;
  }
}

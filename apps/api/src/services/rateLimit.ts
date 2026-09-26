import { ApiError, type ErrorCode } from '@itp/shared';
import type { Db } from 'mongodb';

/** Fixed-window counter in Mongo; windows expire by TTL. Throws 429 once the limit is passed. */
export async function hit(
  db: Db,
  key: string,
  limit: number,
  windowS: number,
  now: Date,
  code: ErrorCode = 'RATE_LIMITED',
) {
  const window = Math.floor(now.getTime() / 1000 / windowS);
  const r = await db
    .collection<{ _id: string; n: number; expiresAt: Date }>('rate_limits')
    .findOneAndUpdate(
      { _id: `${key}:${window}` },
      {
        $inc: { n: 1 },
        $setOnInsert: { expiresAt: new Date((window + 1) * windowS * 1000 + 60_000) },
      },
      { upsert: true, returnDocument: 'after' },
    );
  if (r!.n > limit)
    throw new ApiError(429, code, `Too many requests; try again in a bit`, { limit, windowS });
}

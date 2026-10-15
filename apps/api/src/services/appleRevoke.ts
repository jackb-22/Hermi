import type { AppContext } from '../context.ts';
import { enqueue, type JobDoc } from '../jobs/queue.ts';
import { users } from './users.ts';

export const REVOKE_APPLE_JOB = 'revoke_apple_token';

/**
 * Apple requires Sign in with Apple to be revoked when an account is deleted. If the attempt inside DELETE /me
 * fails, the token stays on the soft-deleted user and this job retries it. The payload is the user id only: a dead
 * job is never pruned, so it must not hold the token.
 */
export const queueAppleRevoke = (ctx: Pick<AppContext, 'db' | 'clock'>, userId: string) =>
  enqueue(
    ctx,
    REVOKE_APPLE_JOB,
    { userId },
    { dedupeKey: `revoke-apple:${userId}`, maxAttempts: 8 },
  );

/** Job: revoke a deleted user's stored token with Apple, then drop it. A thrown error makes the queue retry. */
export async function revokeAppleToken(ctx: AppContext, payload: { userId: string }, job?: JobDoc) {
  const u = await users(ctx.db).findOne(
    { _id: payload.userId, deletedAt: { $exists: true }, appleRefreshToken: { $exists: true } },
    { projection: { appleRefreshToken: 1 } },
  );
  if (!u?.appleRefreshToken) return;
  try {
    await ctx.providers.appleIdentity.revoke(u.appleRefreshToken);
  } catch (e) {
    // Out of attempts: the token stays on the user and the job is dead, so a person has to follow up.
    if (job && job.attempts >= job.maxAttempts)
      console.error(
        `[apple] gave up revoking Sign in with Apple for deleted user ${u._id} after ${job.attempts} attempts: ${(e as Error).message}`,
      );
    throw e;
  }
  await users(ctx.db).updateOne({ _id: u._id }, { $unset: { appleRefreshToken: '' } });
}

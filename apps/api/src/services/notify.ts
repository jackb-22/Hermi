import type { AppContext } from '../context.ts';
import { enqueue } from '../jobs/queue.ts';
import type { PushMessage } from '../providers/push.ts';
import { users } from './users.ts';

/** Push is sent from the worker; callers just enqueue. */
export const notify = (ctx: AppContext, userIds: string[], msg: PushMessage) =>
  userIds.length ? enqueue(ctx, 'push', { userIds, msg }) : Promise.resolve('');

export async function sendPush(ctx: AppContext, payload: { userIds: string[]; msg: PushMessage }) {
  const docs = await users(ctx.db)
    .find(
      { _id: { $in: payload.userIds }, deletedAt: { $exists: false } },
      { projection: { pushTokens: 1 } },
    )
    .toArray();
  const tokens = docs.flatMap((u) => u.pushTokens ?? []);
  if (!tokens.length) return;
  const { invalid } = await ctx.providers.push.send(tokens, payload.msg);
  if (invalid.length)
    await users(ctx.db).updateMany(
      { pushTokens: { $in: invalid } },
      { $pull: { pushTokens: { $in: invalid } } },
    );
}

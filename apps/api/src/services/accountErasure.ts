import { createHmac } from 'node:crypto';
import type pg from 'pg';
import type { AppContext } from '../context.ts';
import { enqueue } from '../jobs/queue.ts';
import { normalizeHandle } from './imessage.ts';
import { media } from './media.ts';
import { defaultName, loadPlaces, plans } from './plans.ts';
import { enqueueReviewSummary, posts } from './posts.ts';
import { reports } from './reports.ts';
import { sessions } from './sessions.ts';
import { friendships } from './social.ts';
import { tags } from './tags.ts';
import { users } from './users.ts';

export const ERASE_ACCOUNT_JOB = 'erase_account';

/**
 * Requests in flight when the account was deleted (a presigned upload is good for 15 minutes, a session may be mid
 * finalize) can write after the first run. A second run this long after the delete sweeps them up.
 */
const SWEEP_AFTER_MS = 30 * 60_000;

/**
 * Queues the erase for a soft-deleted account. The payload is the user id only: a dead job is never pruned (finished
 * ones are, after 14 days), so it must not hold personal data. Eight attempts ride out a storage outage of several
 * minutes.
 */
export async function queueAccountErasure(
  ctx: Pick<AppContext, 'db' | 'clock'>,
  userId: string,
  opts: { sweep?: boolean } = { sweep: true },
) {
  const key = `erase-account:${userId}`;
  await enqueue(ctx, ERASE_ACCOUNT_JOB, { userId }, { dedupeKey: key, maxAttempts: 8 });
  if (opts.sweep)
    await enqueue(
      ctx,
      ERASE_ACCOUNT_JOB,
      { userId },
      {
        dedupeKey: `${key}:sweep`,
        maxAttempts: 8,
        runAt: new Date(ctx.clock.now().getTime() + SWEEP_AFTER_MS),
      },
    );
}

/**
 * Worker start-up: queues the erase for every deleted account that still holds more than its placeholder. That covers
 * accounts deleted before the erase existed, a delete whose job was never queued, and a job that ran out of attempts.
 * A real profile always has createdAt; the placeholder does not.
 */
export async function queueMissingErasures(ctx: AppContext): Promise<number> {
  const left = await users(ctx.db)
    .find(
      { deletedAt: { $exists: true }, createdAt: { $exists: true } },
      { projection: { _id: 1 } },
    )
    .toArray();
  for (const u of left) await queueAccountErasure(ctx, u._id, { sweep: false });
  return left.length;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Job: erases everything a deleted account owns, then cuts its user document down to the placeholder
 * `{ _id, deletedAt }` (plus `appleRefreshToken` while Apple's revocation is still pending, see appleRevoke.ts).
 *
 * What goes and what stays, in short:
 * - Everything the person made or that describes them goes: profile, posts, media bytes, plans they hosted,
 *   friendships, saves, memories, location and check-in rows.
 * - What other people made stays, minus the link to this person: their friends' own data, plans they joined
 *   (the member entry is removed), completed outings others took part in (anonymized), and counters.
 * - Reports stay for moderation: the ones filed by this person keep `reporterId`, and reports about them stay
 *   (closed when their target is gone).
 *
 * Safe to run again: every step is a delete, a pull or a set that finds nothing the second time, and the user
 * document is cut down last because it holds the keys the other steps look up (phone handles, photo keys). Only a
 * deleted account is touched, so a live user (or a bad id) is a no-op.
 */
export async function eraseAccount(ctx: AppContext, payload: { userId: string }): Promise<void> {
  const { db } = ctx;
  const u = await users(db).findOne({ _id: payload.userId, deletedAt: { $exists: true } });
  if (!u) return;
  const userId = u._id;
  const handles = u.imessageHandles ?? [];

  // Reports first: the post ids that close them are gone once the posts are.
  await settleReports(ctx, userId);
  await erasePosts(ctx, userId);
  await eraseMedia(ctx, u);
  await erasePlans(ctx, userId, handles);
  await friendships(db).deleteMany({ $or: [{ a: userId }, { b: userId }] });
  await eraseOwnRecords(ctx, userId);
  await eraseHandleEchoes(ctx, handles);
  await eraseJobTraces(ctx, userId);
  await eraseTiger(ctx.tiger, userId);

  await users(db).updateOne({ _id: userId, deletedAt: { $exists: true } }, [
    // An allow-list, so a field added to profiles later is erased too. A missing field stays missing.
    {
      $replaceWith: {
        _id: '$_id',
        deletedAt: '$deletedAt',
        appleRefreshToken: '$appleRefreshToken',
      },
    },
  ]);
}

/**
 * Reports stay on file whoever they involve (the team may still need them), reporterId included. A report about an
 * erased person or post has nothing left to act on, so it closes. The mark that hid a reported post from its reporter
 * is the reporter's own, so it goes.
 */
async function settleReports(ctx: AppContext, userId: string) {
  const { db } = ctx;
  const postIds = await posts(db).distinct('_id', { authorId: userId });
  await reports(db).updateMany(
    { status: 'open', $or: [{ userId }, { postId: { $in: postIds } }] },
    { $set: { status: 'actioned', reviewedAt: ctx.clock.now() } },
  );
  const reported = await reports(db).distinct('postId', { reporterId: userId });
  await posts(db).updateMany(
    { _id: { $in: reported.filter((id): id is string => !!id) } },
    { $pull: { hiddenFrom: userId } },
  );
}

async function erasePosts(ctx: AppContext, userId: string) {
  const { db } = ctx;
  // A place's review summary was written from reviews that may include this person's. The posts are already
  // 'removed' (DELETE /me), so the summary job leaves them out. Asked before the delete so a crash cannot lose it.
  const reviewed = await posts(db).distinct('placeId', {
    authorId: userId,
    type: 'review',
    placeId: { $exists: true },
  });
  for (const placeId of reviewed) await enqueueReviewSummary(ctx, placeId);
  await posts(db).deleteMany({ authorId: userId });
}

/** Every object a media doc points at: the private original, the feed rendition and poster, the signed copy. */
const mediaKeys = (m: {
  key: string;
  rendition?: { key: string; posterKey?: string };
  c2pa?: { manifestKey: string };
}) =>
  [m.key, m.rendition?.key, m.rendition?.posterKey, m.c2pa?.manifestKey].filter(
    (k): k is string => !!k,
  );

/**
 * Bytes first, then the docs that name them: if storage fails halfway, the retry still finds the keys. The folder
 * deletes also catch objects no doc names: an upload that landed after its doc went, and the originals of earlier
 * profile photos.
 */
async function eraseMedia(
  ctx: AppContext,
  u: { _id: string; photoKey?: string; photoReview?: { key: string; origKey: string } },
) {
  const { storage } = ctx.providers;
  for (;;) {
    const batch = await media(ctx.db).find({ userId: u._id }).limit(100).toArray();
    if (!batch.length) break;
    for (const m of batch) for (const key of mediaKeys(m)) await storage.delete(key);
    await media(ctx.db).deleteMany({ _id: { $in: batch.map((m) => m._id) } });
  }
  // Profile photos live under p/ (public, random key). Anything else in these fields is not ours to delete.
  for (const key of [u.photoKey, u.photoReview?.key])
    if (key?.startsWith('p/')) await storage.delete(key);
  await storage.deletePrefix(`orig/${u._id}/`);
  await storage.deletePrefix(`orig/profile/${u._id}/`);
}

/**
 * Plans they hosted: a plan nobody else took part in goes. A completed outing that others joined stays as their
 * history, with the host reduced to the placeholder id: the name (free text) becomes the default one, the share
 * link is replaced, and the text-planning leftovers go. An upcoming plan with joiners is deleted rather than handed
 * to one of them: a stranger who joined should not inherit the host's role. Plans they joined lose their entry.
 */
async function erasePlans(ctx: AppContext, userId: string, handles: string[]) {
  const { db, clock } = ctx;
  for (const plan of await plans(db).find({ hostId: userId }).toArray()) {
    const history =
      plan.status === 'completed' &&
      plan.members.some((m) => m.userId !== userId && m.status === 'joined');
    let name: string | null = null;
    if (history) {
      const byId = await loadPlaces(
        db,
        plan.stops.map((s) => s.placeId),
      );
      name = defaultName(plan.stops, byId);
      await plans(db).updateOne(
        { _id: plan._id },
        {
          $set: { name, nameIsDefault: true, ghostChanges: [] },
          $unset: {
            textUndo: '',
            imessageThreadId: '',
            imessageRsvps: '',
            matchCount: '',
            matchedAt: '',
            notifiedMatchIds: '',
            aiThreadId: '',
          },
        },
      );
      // Kills the link the host shared. Derived from a secret rather than drawn at random, so a re-run finds it
      // already set and changes nothing.
      const shareToken = createHmac('sha256', ctx.config.JWT_SECRET)
        .update(`erased-plan:${plan._id}`)
        .digest('base64url')
        .slice(0, 12);
      await plans(db).updateOne(
        { _id: plan._id, shareToken: { $ne: shareToken } },
        { $set: { shareToken, updatedAt: clock.now() } },
      );
    } else {
      await plans(db).deleteOne({ _id: plan._id });
    }
    // Other people's recaps quote the plan's name.
    await sessions(db).updateMany(
      { planId: plan._id, userId: { $ne: userId }, 'recap.planName': { $exists: true } },
      { $set: { 'recap.planName': name } },
    );
  }

  const col = plans(db);
  await col.updateMany({ 'members.userId': userId }, { $pull: { members: { userId } } });
  // The snapshot "undo" restores holds the member list as it was.
  await col.updateMany(
    { 'textUndo.members.userId': userId },
    { $pull: { 'textUndo.members': { userId } } as never },
  );
  await col.updateMany({ notifiedMatchIds: userId }, { $pull: { notifiedMatchIds: userId } });
  if (handles.length)
    await col.updateMany(
      { imessageRsvps: { $in: handles } },
      { $pull: { imessageRsvps: { $in: handles } } },
    );
}

/**
 * Collections where every row is the person's own, found by their id. Blocks they placed go; blocks others placed
 * against them stay (the other person's choice; they now name an empty placeholder). A personal NFC sticker is
 * released rather than deleted: it is physical stock and holds nothing but a secret hash once the owner is cleared.
 */
async function eraseOwnRecords(ctx: AppContext, userId: string) {
  const { db } = ctx;
  const own = (coll: string, field: string) => db.collection(coll).deleteMany({ [field]: userId });
  await Promise.all([
    own('saves', 'userId'),
    own('folders', 'ownerId'),
    own('sessions', 'userId'),
    own('reviews', 'userId'),
    own('ai_memories', 'userId'),
    own('behavior_events', 'userId'),
    own('user_tiles', 'userId'),
    own('feed_seen', 'userId'),
    own('attest_keys', 'userId'),
    own('attest_challenges', 'userId'),
    own('imessage_links', 'userId'),
    own('blocks', 'blocker'),
    db.collection('edu_codes').deleteMany({ _id: userId as never }),
    // Keyed "<userId>:<placeId>".
    db
      .collection('checkin_cooldowns')
      .deleteMany({ _id: { $regex: `^${escapeRe(userId)}:` } as never }),
    // Keyed "<limit name>:<userId>:<window>", expiring within hours on their own.
    db
      .collection('rate_limits')
      .deleteMany({ _id: { $regex: `^[a-z:]+:${escapeRe(userId)}:\\d+$` } as never }),
    tags(db).updateMany({ ownerId: userId }, { $unset: { ownerId: '' } }),
  ]);
}

/**
 * Their phone number or email also sits in places that outlive the account: lines they texted in a group (kept two
 * days) and the "in" replies on plans. Senders are stored as the messenger sent them, so compare normalized.
 */
async function eraseHandleEchoes(ctx: AppContext, handles: string[]) {
  if (!handles.length) return;
  const lines = ctx.db.collection<{ _id: string; sender: string }>('photon_lines');
  const doomed: string[] = [];
  for await (const l of lines.find({}, { projection: { sender: 1 } }))
    if (handles.includes(normalizeHandle(l.sender) ?? '')) doomed.push(l._id);
  if (doomed.length) await lines.deleteMany({ _id: { $in: doomed } });
}

/**
 * Jobs keep their payload after they run, and a dead one is never pruned (finished ones expire after 14 days, see
 * db/indexes.ts), so what names this person is taken out here:
 * - pushes (userIds[], and the ids the message carries): addressed to them alone, or about them, they go, whatever
 *   their status, so a queued "streak with Maya" is not delivered to her friend. On a push shared with others
 *   (a plan invite) only her id comes off, since the rest of the audience still gets it.
 * - a dead photo scan or an erase that ran out of attempts earlier holds only her id and a key that is now gone, so
 *   it goes. A dead Apple revocation stays: the placeholder still holds the token and that job is the only sign
 *   that a person has to follow up (appleRevoke.ts).
 * Other job types name a session, media, post, plan or place by its own id, which points at nothing once erased.
 * Names they typed that appear in pushes sent to others are not searched for; the 14 days bound those, except in a
 * dead push.
 */
async function eraseJobTraces(ctx: AppContext, userId: string) {
  const jobs = ctx.db.collection('jobs');
  await jobs.deleteMany({ type: 'push', 'payload.userIds': [userId] });
  await jobs.updateMany(
    { type: 'push', 'payload.userIds': userId },
    { $pull: { 'payload.userIds': userId } as never },
  );
  await jobs.deleteMany({
    type: 'push',
    $or: [{ 'payload.msg.data.userId': userId }, { 'payload.msg.data.friendId': userId }],
  });
  await jobs.deleteMany({
    type: { $in: ['scan_photo', ERASE_ACCOUNT_JOB] },
    status: 'dead',
    'payload.userId': userId,
  });
}

/**
 * Every Tiger table keyed by the person. A hangout row has no user column, only the pair "a:b"; it records that
 * these two met somewhere and when, and the friendship it served is gone, so rows from either side go.
 */
async function eraseTiger(tiger: pg.Pool, userId: string) {
  for (const table of [
    'location_points',
    'movement_segments',
    'checkins',
    'tag_reads',
    'xp_events',
  ])
    await tiger.query(`delete from ${table} where user_id = $1`, [userId]);
  await tiger.query(
    `delete from hangouts where split_part(pair_key, ':', 1) = $1 or split_part(pair_key, ':', 2) = $1`,
    [userId],
  );
  await purgeRollup(tiger, 'xp_daily', userId);
  await purgeRollup(tiger, 'movement_daily', userId);
}

/**
 * A continuous aggregate keeps the days it already materialized after their raw rows are deleted; its policy only
 * re-reads the last three days. So refresh exactly the days where the person still shows up (older ones would
 * otherwise keep their user id, campus and XP), then check, so a refresh that did nothing fails the job.
 */
async function purgeRollup(tiger: pg.Pool, view: 'xp_daily' | 'movement_daily', userId: string) {
  const span = () =>
    tiger.query<{ lo: Date | null; hi: Date | null }>(
      `select min(day) as lo, max(day) as hi from ${view} where user_id = $1`,
      [userId],
    );
  const { lo, hi } = (await span()).rows[0]!;
  if (!lo || !hi) return;
  // Day buckets are UTC days; the end of the window is exclusive.
  await tiger.query(
    `call refresh_continuous_aggregate('${view}', $1::timestamptz, $2::timestamptz)`,
    [lo, new Date(hi.getTime() + 86_400_000)],
  );
  if ((await span()).rows[0]!.lo) throw new Error(`${view} still holds rows for ${userId}`);
}

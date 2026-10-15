import { ApiError } from '@itp/shared';
import type { Db } from 'mongodb';
import type { AppContext } from '../context.ts';
import type { UserDoc } from '../db/types.ts';
import type { JobDoc } from '../jobs/queue.ts';
import { media } from './media.ts';
import { enqueueModeration, enqueueReviewSummary, goLive, type PostDoc, posts } from './posts.ts';
import { excerpt, type ReportDoc, reports } from './reports.ts';
import { users } from './users.ts';

/**
 * What the admin CLI (apps/api/scripts/admin.ts) does, as plain functions so tests can drive them. They act at once;
 * the script is what previews and asks for --yes. Failures are ApiErrors whose message the script prints.
 */

export interface ModerationState {
  /** none: no job (it was purged); queued: not yet run; retrying: failed and waiting; dead: out of attempts. */
  state: 'none' | 'queued' | 'running' | 'retrying' | 'dead';
  attempts: number;
  maxAttempts: number;
  nextTryAt?: Date;
  lastError?: string;
}

async function moderationStates(db: Db, postIds: string[]): Promise<Map<string, ModerationState>> {
  const jobs = await db
    .collection<JobDoc<{ postId: string }>>('jobs')
    .find({
      type: 'moderate_post',
      status: { $in: ['pending', 'running', 'dead'] },
      'payload.postId': { $in: postIds },
    })
    .sort({ createdAt: 1 })
    .toArray();
  // Oldest first, so after a retry-moderation the new job wins over the dead one it replaced.
  return new Map(
    jobs.map((j) => {
      const state: ModerationState['state'] =
        j.status === 'dead'
          ? 'dead'
          : j.status === 'running'
            ? 'running'
            : j.attempts > 0
              ? 'retrying'
              : 'queued';
      return [
        j.payload.postId,
        {
          state,
          attempts: j.attempts,
          maxAttempts: j.maxAttempts,
          nextTryAt: state === 'retrying' ? j.runAt : undefined,
          lastError: j.lastError?.split('\n')[0],
        },
      ];
    }),
  );
}

const NO_JOB: ModerationState = { state: 'none', attempts: 0, maxAttempts: 0 };

export interface PendingRow {
  id: string;
  type: PostDoc['type'];
  createdAt: Date;
  ageMs: number;
  author: { id: string; username: string | null };
  place: string;
  caption: string;
  moderation: ModerationState;
}

/** Pending posts, oldest first: waiting on the safety check, or stuck because it could not run. */
export async function listPending(ctx: AppContext, limit = 50): Promise<PendingRow[]> {
  const docs = await posts(ctx.db)
    .find({ status: 'pending' })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
  const [authors, states] = await Promise.all([
    users(ctx.db)
      .find({ _id: { $in: docs.map((p) => p.authorId) } }, { projection: { username: 1 } })
      .toArray(),
    moderationStates(
      ctx.db,
      docs.map((p) => p._id),
    ),
  ]);
  const username = new Map(authors.map((u) => [u._id, u.username ?? null]));
  const now = ctx.clock.now().getTime();
  return docs.map((p) => ({
    id: p._id,
    type: p.type,
    createdAt: p.createdAt,
    ageMs: now - p.createdAt.getTime(),
    author: { id: p.authorId, username: username.get(p.authorId) ?? null },
    place: p.stamp.placeName,
    caption: excerpt(p.text, 80),
    moderation: states.get(p._id) ?? NO_JOB,
  }));
}

export interface ReportGroup {
  kind: 'post' | 'user';
  id: string;
  /** Reports filed, and how many different people filed them. */
  count: number;
  reporters: number;
  reasons: string[];
  firstAt: Date;
  latestAt: Date;
  /** The target now: a post's status, place and author, or a user's handle. */
  post?: {
    status: PostDoc['status'];
    type: PostDoc['type'];
    place: string;
    caption: string;
    authorId: string;
  };
  user?: { username: string | null; banned: boolean; deleted: boolean };
}

/**
 * Open reports grouped by what was reported, longest-waiting first so the 24 h response window shows. Reports the
 * automatic check already looked at and left up ("reviewed") are listed only with includeReviewed.
 */
export async function listReports(
  ctx: AppContext,
  opts: { includeReviewed?: boolean } = {},
): Promise<ReportGroup[]> {
  const { db } = ctx;
  const status: ReportDoc['status'][] = opts.includeReviewed ? ['open', 'reviewed'] : ['open'];
  const docs = await reports(db)
    .find({ status: { $in: status } })
    .sort({ createdAt: 1 })
    .toArray();
  const groups = new Map<string, ReportGroup & { who: Set<string> }>();
  for (const r of docs) {
    const kind = r.postId ? 'post' : 'user';
    const id = (r.postId ?? r.userId)!;
    const key = `${kind}:${id}`;
    const g = groups.get(key) ?? {
      kind,
      id,
      count: 0,
      reporters: 0,
      reasons: [],
      firstAt: r.createdAt,
      latestAt: r.createdAt,
      who: new Set<string>(),
    };
    g.count++;
    g.who.add(r.reporterId);
    g.latestAt = r.createdAt;
    const reason = excerpt(r.reason, 120);
    if (reason && !g.reasons.includes(reason) && g.reasons.length < 5) g.reasons.push(reason);
    groups.set(key, g);
  }
  const list = [...groups.values()];
  const [postDocs, userDocs] = await Promise.all([
    posts(db)
      .find({ _id: { $in: list.filter((g) => g.kind === 'post').map((g) => g.id) } })
      .toArray(),
    users(db)
      .find({ _id: { $in: list.filter((g) => g.kind === 'user').map((g) => g.id) } })
      .toArray(),
  ]);
  const byPost = new Map(postDocs.map((p) => [p._id, p]));
  const byUser = new Map(userDocs.map((u) => [u._id, u]));
  return list.map(({ who, ...g }) => {
    const p = byPost.get(g.id);
    const u = byUser.get(g.id);
    return {
      ...g,
      reporters: who.size,
      post:
        g.kind === 'post' && p
          ? {
              status: p.status,
              type: p.type,
              place: p.stamp.placeName,
              caption: excerpt(p.text, 80),
              authorId: p.authorId,
            }
          : undefined,
      user:
        g.kind === 'user' && u
          ? { username: u.username ?? null, banned: !!u.bannedAt, deleted: !!u.deletedAt }
          : undefined,
    };
  });
}

/** A user by id or @username (usernames are lowercase and unique among live accounts). */
export async function resolveUser(ctx: AppContext, ref: string): Promise<UserDoc> {
  const u = ref.startsWith('@')
    ? await users(ctx.db).findOne({ username: ref.slice(1).toLowerCase() })
    : await users(ctx.db).findOne({ _id: ref });
  if (!u) throw new ApiError(404, 'NOT_FOUND', `No such user: ${ref}`);
  return u;
}

async function getPost(ctx: AppContext, id: string): Promise<PostDoc> {
  const p = await posts(ctx.db).findOne({ _id: id });
  if (!p) throw new ApiError(404, 'NOT_FOUND', `No such post: ${id}`);
  return p;
}

export interface PostDetail {
  id: string;
  type: PostDoc['type'];
  status: PostDoc['status'];
  moderationReason?: string;
  createdAt: Date;
  liveAt?: Date;
  place: string;
  caption: string;
  author: { id: string; username: string | null; banned: boolean };
  moderation: ModerationState;
  reports: {
    reporterId: string;
    reporter: string | null;
    reason: string;
    status: ReportDoc['status'];
    createdAt: Date;
  }[];
  /** Signed links that stop working in 15 minutes: what viewers see (the rendition, else the original). */
  media: { id: string; kind: string; url: string; posterUrl?: string }[];
}

export async function showPost(ctx: AppContext, id: string): Promise<PostDetail> {
  const { db, providers } = ctx;
  const p = await getPost(ctx, id);
  const [author, reportDocs, mediaDocs, states] = await Promise.all([
    users(db).findOne({ _id: p.authorId }),
    reports(db).find({ postId: p._id }).sort({ createdAt: 1 }).toArray(),
    media(db)
      .find({ _id: { $in: p.mediaIds } })
      .toArray(),
    moderationStates(db, [p._id]),
  ]);
  const reporters = await users(db)
    .find({ _id: { $in: reportDocs.map((r) => r.reporterId) } }, { projection: { username: 1 } })
    .toArray();
  const handle = new Map(reporters.map((u) => [u._id, u.username ?? null]));
  const ttl = 15 * 60;
  return {
    id: p._id,
    type: p.type,
    status: p.status,
    moderationReason: p.moderationReason,
    createdAt: p.createdAt,
    liveAt: p.liveAt,
    place: p.stamp.placeName,
    caption: p.text ?? '',
    author: { id: p.authorId, username: author?.username ?? null, banned: !!author?.bannedAt },
    moderation: states.get(p._id) ?? NO_JOB,
    reports: reportDocs.map((r) => ({
      reporterId: r.reporterId,
      reporter: handle.get(r.reporterId) ?? null,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
    })),
    media: await Promise.all(
      mediaDocs
        .filter((m) => m.kind !== 'audio')
        .map(async (m) => ({
          id: m._id,
          kind: m.kind,
          url: await providers.storage.presignGet(m.rendition?.key ?? m.key, ttl),
          posterUrl: m.rendition?.posterKey
            ? await providers.storage.presignGet(m.rendition.posterKey, ttl)
            : undefined,
        })),
    ),
  };
}

/**
 * Re-runs the safety check for every pending post whose check is dead or missing (Gemini was down longer than the
 * retries lasted). A post with a check queued, retrying or running is left alone: enqueue's dedupe only blocks live
 * jobs, so the dead one does not get in the way of the fresh job.
 */
export async function retryModeration(ctx: AppContext) {
  const pending = await posts(ctx.db)
    .find({ status: 'pending' }, { projection: { _id: 1 } })
    .toArray();
  const states = await moderationStates(
    ctx.db,
    pending.map((p) => p._id),
  );
  const stuck = pending.filter((p) => {
    const s = states.get(p._id)?.state ?? 'none';
    return s === 'dead' || s === 'none';
  });
  for (const p of stuck) await enqueueModeration(ctx, p._id);
  return { requeued: stuck.length, alreadyRunning: pending.length - stuck.length };
}

/** Pending → live without the safety check (it could not run, or a person has looked). */
export async function approvePost(ctx: AppContext, id: string) {
  const p = await getPost(ctx, id);
  if (p.status !== 'pending')
    throw new ApiError(409, 'CONFLICT', `Post ${id} is ${p.status}, not pending`);
  await goLive(ctx, p, 'Approved by admin');
  return { id: p._id, status: 'live' as const };
}

/** Marks reports about a target as handled, whatever the automatic check already did with them. */
async function closeReports(
  ctx: AppContext,
  target: { postId: string } | { userId: string } | { postId: { $in: string[] } },
  status: 'actioned' | 'dismissed',
): Promise<number> {
  const r = await reports(ctx.db).updateMany(
    { ...target, status: { $in: ['open', 'reviewed'] } },
    { $set: { status, reviewedAt: ctx.clock.now() } },
  );
  return r.modifiedCount;
}

/** Takes a post down (any status) and closes its reports; a live Review changes its place's summary. */
export async function removePost(ctx: AppContext, id: string, reason: string) {
  if (!reason.trim()) throw new ApiError(400, 'BAD_REQUEST', 'A reason is required');
  const p = await getPost(ctx, id);
  await posts(ctx.db).updateOne(
    { _id: p._id },
    { $set: { status: 'removed', moderationReason: `Removed by admin: ${reason.trim()}` } },
  );
  const actioned = await closeReports(ctx, { postId: p._id }, 'actioned');
  if (p.status === 'live' && p.type === 'review') await enqueueReviewSummary(ctx, p.placeId);
  return { id: p._id, was: p.status, reportsActioned: actioned };
}

export interface BanPreview {
  user: { id: string; username: string | null; name: string | null };
  alreadyBanned: boolean;
  livePosts: number;
  pendingPosts: number;
  pushTokens: number;
  openReports: number;
}

/** What `ban` would change, for the confirmation step. */
export async function previewBan(ctx: AppContext, ref: string): Promise<BanPreview> {
  const u = await resolveUser(ctx, ref);
  if (u.deletedAt) throw new ApiError(409, 'CONFLICT', `${ref} is a deleted account`);
  const count = (status: PostDoc['status']) =>
    posts(ctx.db).countDocuments({ authorId: u._id, status });
  const [livePosts, pendingPosts, openReports] = await Promise.all([
    count('live'),
    count('pending'),
    reports(ctx.db).countDocuments({ userId: u._id, status: 'open' }),
  ]);
  return {
    user: { id: u._id, username: u.username ?? null, name: u.name ?? null },
    alreadyBanned: !!u.bannedAt,
    livePosts,
    pendingPosts,
    pushTokens: u.pushTokens?.length ?? 0,
    openReports,
  };
}

/**
 * Locks the account out (requireAuth answers 403 BANNED on the next request), hides them socially, takes down their
 * live and pending posts, closes the reports about them, and stops pushes. Safe to run again: it finishes whatever a failed run left.
 */
export async function banUser(ctx: AppContext, ref: string, reason: string) {
  if (!reason.trim()) throw new ApiError(400, 'BAD_REQUEST', 'A reason is required');
  const u = await resolveUser(ctx, ref);
  if (u.deletedAt) throw new ApiError(409, 'CONFLICT', `${ref} is a deleted account`);
  const { db, clock } = ctx;
  await users(db).updateOne(
    { _id: u._id },
    {
      // Ghost mode and Open to plans off, as DELETE /me does: the social map, matching and find-plans skip them.
      $set: {
        bannedAt: u.bannedAt ?? clock.now(),
        banReason: reason.trim(),
        ghostMode: true,
        openToPlans: false,
      },
      $unset: { pushTokens: '' },
    },
  );
  const doomed = await posts(db)
    .find({ authorId: u._id, status: { $in: ['live', 'pending'] } })
    .toArray();
  await posts(db).updateMany(
    { _id: { $in: doomed.map((p) => p._id) } },
    { $set: { status: 'removed', moderationReason: `Author banned: ${reason.trim()}` } },
  );
  const places = new Set(
    doomed.flatMap((p) =>
      p.status === 'live' && p.type === 'review' && p.placeId ? [p.placeId] : [],
    ),
  );
  for (const placeId of places) await enqueueReviewSummary(ctx, placeId);
  const actioned =
    (await closeReports(ctx, { userId: u._id }, 'actioned')) +
    (await closeReports(ctx, { postId: { $in: doomed.map((p) => p._id) } }, 'actioned'));
  return {
    user: { id: u._id, username: u.username ?? null },
    alreadyBanned: !!u.bannedAt,
    postsRemoved: doomed.length,
    pushTokensCleared: u.pushTokens?.length ?? 0,
    reportsActioned: actioned,
  };
}

/**
 * Lifts a ban. Posts taken down with it stay removed, push tokens come back when they next open the app, and Ghost
 * mode / Open to plans stay as the ban left them: the person turns them back on.
 */
export async function unbanUser(ctx: AppContext, ref: string) {
  const u = await resolveUser(ctx, ref);
  if (!u.bannedAt) throw new ApiError(409, 'CONFLICT', `${ref} is not banned`);
  await users(ctx.db).updateOne({ _id: u._id }, { $unset: { bannedAt: '', banReason: '' } });
  return { user: { id: u._id, username: u.username ?? null } };
}

/** A person read the reports about a post or user (an id, or @username) and chose to do nothing. */
export async function dismissReports(ctx: AppContext, ref: string) {
  let target: { postId: string } | { userId: string };
  if (ref.startsWith('@')) target = { userId: (await resolveUser(ctx, ref))._id };
  else if (await posts(ctx.db).findOne({ _id: ref }, { projection: { _id: 1 } }))
    target = { postId: ref };
  else target = { userId: (await resolveUser(ctx, ref))._id };
  return { dismissed: await closeReports(ctx, target, 'dismissed') };
}

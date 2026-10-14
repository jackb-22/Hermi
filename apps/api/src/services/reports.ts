import { ApiError, newId } from '@itp/shared';
import type { Collection, Db } from 'mongodb';
import type { AppContext } from '../context.ts';
import { enqueue } from '../jobs/queue.ts';
import { posts } from './posts.ts';
import { hit } from './rateLimit.ts';
import { users } from './users.ts';

/**
 * open: waiting. reviewed: the automatic check left the post up. actioned: a post or user was taken down.
 * dismissed: a person read it and did nothing.
 */
export type ReportStatus = 'open' | 'reviewed' | 'actioned' | 'dismissed';

export interface ReportDoc {
  _id: string;
  reporterId: string;
  postId?: string;
  userId?: string;
  reason: string;
  status: ReportStatus;
  createdAt: Date;
  reviewedAt?: Date;
  /** Set once the team has been emailed, so a retried alert job never sends twice. */
  alertedAt?: Date;
}

export const reports = (db: Db): Collection<ReportDoc> => db.collection<ReportDoc>('reports');

/** How the team runs the admin CLI (api/scripts/admin.ts); on the Droplet this goes inside the api container. */
export const ADMIN_CMD = 'pnpm --filter @itp/api admin';

/** One person may file this many reports an hour; each one emails the team, so a flood must not reach the inbox. */
const REPORTS_PER_HOUR = 20;
const EXCERPT = 200;

/** Collapses whitespace and cuts to a short, single-line excerpt. */
export function excerpt(text: string | undefined, max = EXCERPT): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Files a report on a post or a user. The target must exist (404). The same person reporting the same target again
 * while their earlier report is unresolved (open, or left standing by the automatic check) changes nothing and sends
 * nothing. A reported post disappears for its reporter,
 * and the team is emailed by a job, so the request stays fast and a mail outage retries.
 */
export async function fileReport(
  ctx: AppContext,
  reporterId: string,
  body: { postId?: string; userId?: string; reason: string },
): Promise<void> {
  const { db, clock } = ctx;
  if (!body.postId && !body.userId)
    throw new ApiError(400, 'BAD_REQUEST', 'postId or userId required');
  if (body.postId && !(await posts(db).findOne({ _id: body.postId }, { projection: { _id: 1 } })))
    throw new ApiError(404, 'NOT_FOUND', 'No such post');
  if (
    body.userId &&
    !(await users(db).findOne(
      { _id: body.userId, deletedAt: { $exists: false } },
      { projection: { _id: 1 } },
    ))
  )
    throw new ApiError(404, 'NOT_FOUND', 'No such user');

  if (body.postId)
    await posts(db).updateOne({ _id: body.postId }, { $addToSet: { hiddenFrom: reporterId } });
  const target = body.postId ? { postId: body.postId } : { userId: body.userId };
  if (await reports(db).findOne({ reporterId, status: { $in: ['open', 'reviewed'] }, ...target }))
    return;
  await hit(db, `report:${reporterId}`, REPORTS_PER_HOUR, 3600, clock.now());

  const report: ReportDoc = {
    _id: newId(),
    reporterId,
    postId: body.postId,
    userId: body.userId,
    reason: body.reason,
    status: 'open',
    createdAt: clock.now(),
  };
  await reports(db).insertOne(report);
  // One email per report (no dedupeKey: coalescing would swallow reports); 8 attempts ride out a mail outage.
  await enqueue(ctx, 'report_alert', { reportId: report._id }, { maxAttempts: 8 });
  if (body.postId)
    await enqueue(
      ctx,
      'review_report',
      { postId: body.postId },
      { dedupeKey: `report:${body.postId}`, maxAttempts: 8 },
    );
}

const who = (id: string, u?: { username?: string } | null) =>
  u?.username ? `@${u.username} (${id})` : id;

/**
 * Job: email the team about one report. Text only: no media and no reporter email. The commands use ids, never
 * user-written text, so a caption cannot dress itself up as one.
 */
export async function sendReportAlert(ctx: AppContext, payload: { reportId: string }) {
  const { db, config, providers, clock } = ctx;
  const r = await reports(db).findOne({ _id: payload.reportId });
  if (!r || r.alertedAt) return;
  const [reporter, post, reported] = await Promise.all([
    users(db).findOne({ _id: r.reporterId }),
    r.postId ? posts(db).findOne({ _id: r.postId }) : null,
    r.userId ? users(db).findOne({ _id: r.userId }) : null,
  ]);
  const author = post ? await users(db).findOne({ _id: post.authorId }) : null;

  const lines: string[] = [];
  const act: string[] = [];
  if (r.postId) {
    lines.push(
      `Reported: post ${r.postId}${post ? ` (${post.type}, ${post.status})` : ' (no longer exists)'}`,
    );
    if (post) {
      lines.push(`Place:    ${post.stamp.placeName}`);
      lines.push(`Caption:  ${post.text ? `"${excerpt(post.text)}"` : '(none)'}`);
      lines.push(`Author:   ${who(post.authorId, author)}`);
      act.push(
        `${ADMIN_CMD} show-post ${post._id}`,
        `${ADMIN_CMD} remove-post ${post._id} --reason "<why>" --yes`,
        `${ADMIN_CMD} ban ${post.authorId} --reason "<why>" --yes`,
        `${ADMIN_CMD} dismiss-reports ${post._id}`,
      );
    }
  }
  if (r.userId) {
    lines.push(`Reported: user ${who(r.userId, reported)}`);
    act.push(
      `${ADMIN_CMD} ban ${r.userId} --reason "<why>" --yes`,
      `${ADMIN_CMD} dismiss-reports ${r.userId}`,
    );
  }
  lines.push(`Reason:   ${r.reason ? `"${excerpt(r.reason)}"` : '(none given)'}`);
  lines.push(`Reporter: ${who(r.reporterId, reporter)}`);
  lines.push(`Time:     ${r.createdAt.toISOString()}`);

  const text = [
    ...lines,
    '',
    'App Store 1.2: act within 24 hours. A person reads every report.',
    'To act, run on the Droplet inside the api container (docker compose exec api <command>):',
    ...act.map((c) => `  ${c}`),
    `  ${ADMIN_CMD} reports`,
  ].join('\n');
  await providers.email.send(
    config.REPORTS_EMAIL_TO,
    `Hermi report: ${r.postId ? `post ${r.postId}` : `user ${r.userId}`}`,
    text,
  );
  await reports(db).updateOne({ _id: r._id }, { $set: { alertedAt: clock.now() } });
}

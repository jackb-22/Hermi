/**
 * Moderation admin: review what users posted and reported, take things down, ban people. App Store 1.2 says we
 * act on a report within 24 hours; every report is emailed to REPORTS_EMAIL_TO with the command to run.
 *
 *   pnpm --filter @itp/api admin <command> [args]
 *
 *   pending                           pending posts, oldest first: age, author, place, caption, and why each is
 *                                     stuck (a "dead" moderation job means the safety check never ran)
 *   reports [--all]                   open reports grouped by post/user: count, reasons, first and latest time;
 *                                     --all also lists ones the automatic check left up ("reviewed")
 *   retry-moderation                  re-runs the safety check for every pending post whose check died; run it once
 *                                     Gemini is back after an outage (no --yes: it only re-runs the check)
 *   show-post <id>                    details, its reports, and 15-minute signed links to the media
 *   approve-post <id> [--yes]         pending → live without the safety check (use after looking at it)
 *   remove-post <id> --reason "…" [--yes]
 *                                     takes the post down and closes its reports
 *   ban <userId|@username> --reason "…" [--yes]
 *                                     locks the account out (403 BANNED), turns on Ghost mode and off Open to plans,
 *                                     removes their live and pending posts, closes reports about them, clears
 *                                     push tokens
 *   unban <userId|@username>          lifts the ban (removed posts stay removed; Ghost mode and Open to plans stay as
 *                                     the ban left them, the person turns them back on)
 *   dismiss-reports <id|@username>    a person read the reports about this post/user and did nothing
 *
 * approve-post, remove-post and ban print what they will do and change nothing without --yes.
 * Exit code: 0 done, 1 error or no --yes, 2 bad usage (pnpm itself reports every failure as 1).
 *
 * On the Droplet, run it inside the api container, which already has the production env. The compose file is being
 * written by another engineer, so check the service name; probably:
 *   docker compose exec api pnpm --filter @itp/api admin pending
 *   docker compose exec api pnpm --filter @itp/api admin remove-post 01J… --reason "nudity" --yes
 * Locally it reads ../../.env (the docker Mongo), so it works on dev data the same way.
 */
import { parseArgs } from 'node:util';
import { ApiError } from '@itp/shared';
import { closeContext, createContext } from '../src/boot.ts';
import type { AppContext } from '../src/context.ts';
import {
  approvePost,
  banUser,
  dismissReports,
  listPending,
  listReports,
  type ModerationState,
  previewBan,
  removePost,
  retryModeration,
  showPost,
  unbanUser,
} from '../src/services/admin.ts';

const COMMANDS = [
  'pending',
  'reports',
  'retry-moderation',
  'show-post',
  'approve-post',
  'remove-post',
  'ban',
  'unban',
  'dismiss-reports',
];
const usage = () =>
  console.error(
    `usage: pnpm --filter @itp/api admin <${COMMANDS.join('|')}> [args]\nsee the header of apps/api/scripts/admin.ts`,
  );

function parse() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        reason: { type: 'string' },
        yes: { type: 'boolean', default: false },
        all: { type: 'boolean', default: false },
        limit: { type: 'string', default: '50' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    console.error((e as Error).message);
    usage();
    process.exit(2);
  }
}
const { positionals, values } = parse();
const [command, arg] = positionals;
const needsArg = !['pending', 'reports', 'retry-moderation'].includes(command ?? '');
if (values.help || !command || !COMMANDS.includes(command) || (needsArg && !arg)) {
  usage();
  process.exit(2);
}
if ((command === 'remove-post' || command === 'ban') && !values.reason?.trim()) {
  console.error(`${command} needs --reason "…" (it is kept on the record)`);
  process.exit(2);
}

const age = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
};
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const handle = (u: string | null, id: string) => (u ? `@${u} (${id})` : id);

function moderation(m: ModerationState, now: Date): string {
  switch (m.state) {
    case 'none':
      return 'no moderation job (run retry-moderation, or approve or remove it by hand)';
    case 'queued':
      return 'queued for the safety check';
    case 'running':
      return `safety check running (attempt ${m.attempts}/${m.maxAttempts})`;
    case 'retrying': {
      const wait = m.nextTryAt ? ` next try in ${age(m.nextTryAt.getTime() - now.getTime())}` : '';
      return `safety check retrying (attempt ${m.attempts}/${m.maxAttempts}${wait}): ${m.lastError ?? ''}`;
    }
    case 'dead':
      return `SAFETY CHECK NEVER RAN, gave up after ${m.attempts}/${m.maxAttempts} attempts: ${m.lastError ?? ''} (run retry-moderation once Gemini is back)`;
  }
}

/** Prints what is about to happen; without --yes that is all that happens. */
function preview(lines: string[]): boolean {
  for (const l of lines) console.log(l);
  if (values.yes) return true;
  console.log('\nNothing changed. Run again with --yes to do this.');
  process.exitCode = 1;
  return false;
}

async function run(ctx: AppContext) {
  const now = ctx.clock.now();
  const ref = arg!;
  switch (command) {
    case 'pending': {
      const rows = await listPending(ctx, Number(values.limit) || 50);
      console.log(`${rows.length} pending post(s), oldest first`);
      for (const r of rows) {
        console.log(
          `\n${r.id}  ${age(r.ageMs).padEnd(7)} ${r.type}  ${handle(r.author.username, r.author.id)}`,
        );
        console.log(`  ${r.place}${r.caption ? `  "${r.caption}"` : ''}`);
        console.log(`  ${moderation(r.moderation, now)}`);
      }
      return;
    }
    case 'reports': {
      const groups = await listReports(ctx, { includeReviewed: values.all });
      console.log(`${groups.length} reported target(s), longest-waiting first`);
      for (const g of groups) {
        const what =
          g.kind === 'post'
            ? `post ${g.id}${g.post ? ` (${g.post.type}, ${g.post.status}) at ${g.post.place}${g.post.caption ? ` "${g.post.caption}"` : ''}` : ' (gone)'}`
            : `user ${handle(g.user?.username ?? null, g.id)}${g.user?.banned ? ' [banned]' : ''}${g.user?.deleted ? ' [deleted]' : ''}`;
        console.log(`\n${what}`);
        console.log(
          `  ${g.count} report(s) from ${g.reporters} person(s); waiting ${age(now.getTime() - g.firstAt.getTime())}, latest ${g.latestAt.toISOString()}`,
        );
        for (const reason of g.reasons) console.log(`  - "${reason}"`);
      }
      return;
    }
    case 'retry-moderation': {
      const r = await retryModeration(ctx);
      console.log(
        `Re-queued the safety check for ${r.requeued} pending post(s); ${r.alreadyRunning} already have a check queued or running.`,
      );
      return;
    }
    case 'show-post': {
      const p = await showPost(ctx, ref);
      console.log(
        `${p.id}  ${p.type}  ${p.status}${p.moderationReason ? `  (${p.moderationReason})` : ''}`,
      );
      console.log(
        `  author:  ${handle(p.author.username, p.author.id)}${p.author.banned ? ' [banned]' : ''}`,
      );
      console.log(`  place:   ${p.place}`);
      console.log(`  caption: ${p.caption ? `"${oneLine(p.caption)}"` : '(none)'}`);
      console.log(
        `  posted:  ${p.createdAt.toISOString()} (${age(now.getTime() - p.createdAt.getTime())} ago)`,
      );
      console.log(`  check:   ${moderation(p.moderation, now)}`);
      console.log(`  reports: ${p.reports.length}`);
      for (const r of p.reports)
        console.log(
          `    ${r.createdAt.toISOString()}  ${r.status}  by ${handle(r.reporter, r.reporterId)}  ${r.reason ? `"${r.reason}"` : '(no reason)'}`,
        );
      for (const m of p.media) {
        console.log(`  ${m.kind}: ${m.url}`);
        if (m.posterUrl) console.log(`  poster: ${m.posterUrl}`);
      }
      return;
    }
    case 'approve-post': {
      const p = await showPost(ctx, ref);
      if (
        !preview([
          `Will publish post ${p.id} by ${handle(p.author.username, p.author.id)} at ${p.place} NOW, without the safety check:`,
          `  ${p.caption ? `"${oneLine(p.caption)}"` : '(no caption)'}   [${p.media.length} media; run show-post to see them]`,
        ])
      )
        return;
      const r = await approvePost(ctx, ref);
      console.log(`Post ${r.id} is ${r.status}.`);
      return;
    }
    case 'remove-post': {
      const p = await showPost(ctx, ref);
      if (
        !preview([
          `Will remove post ${p.id} (${p.status}) by ${handle(p.author.username, p.author.id)} at ${p.place}:`,
          `  ${p.caption ? `"${oneLine(p.caption)}"` : '(no caption)'}`,
          `  reason: ${values.reason}; closes its ${p.reports.length} report(s); a Review also refreshes the place summary`,
        ])
      )
        return;
      const r = await removePost(ctx, ref, values.reason!);
      console.log(`Post ${r.id} removed (was ${r.was}); ${r.reportsActioned} report(s) closed.`);
      return;
    }
    case 'ban': {
      const b = await previewBan(ctx, ref);
      if (
        !preview([
          `Will ban ${handle(b.user.username, b.user.id)}${b.user.name ? ` (${b.user.name})` : ''}${b.alreadyBanned ? ' [already banned; finishing the clean-up]' : ''}:`,
          `  every request they make gets 403 BANNED from now on; Ghost mode on, Open to plans off`,
          `  removes ${b.livePosts} live and ${b.pendingPosts} pending post(s); clears ${b.pushTokens} push token(s)`,
          `  closes ${b.openReports} open report(s) about them and any on their posts`,
          `  reason: ${values.reason}`,
        ])
      )
        return;
      const r = await banUser(ctx, ref, values.reason!);
      console.log(
        `Banned ${handle(r.user.username, r.user.id)}: ${r.postsRemoved} post(s) removed, ${r.pushTokensCleared} push token(s) cleared, ${r.reportsActioned} report(s) closed.`,
      );
      return;
    }
    case 'unban': {
      const r = await unbanUser(ctx, ref);
      console.log(
        `Unbanned ${handle(r.user.username, r.user.id)}. Posts removed by the ban stay removed; Ghost mode and Open to plans stay as the ban left them.`,
      );
      return;
    }
    case 'dismiss-reports': {
      const r = await dismissReports(ctx, ref);
      console.log(`${r.dismissed} report(s) dismissed.`);
      return;
    }
  }
}

const ctx = await createContext();
try {
  await run(ctx);
} catch (e) {
  console.error(e instanceof ApiError ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeContext(ctx);
}

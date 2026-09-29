import { groupSay } from '../services/groupChat.ts';
import { matchNotify } from '../services/matching.ts';
import { sendPush } from '../services/notify.ts';
import { reviewReminder, weeklyNudge } from '../services/nudges.ts';
import { moderatePost, summarizeReviews } from '../services/posts.ts';
import { reviewReport, scanPhoto } from '../services/safety.ts';
import { finalizeSession } from './finalizeSession.ts';
import { processMedia } from './processMedia.ts';
import type { JobHandler } from './queue.ts';

/** Job type → handler. Each feature registers its jobs here. */
export const handlers: Record<string, JobHandler> = {
  finalize_session: finalizeSession as JobHandler,
  moderate_post: moderatePost as JobHandler,
  process_media: processMedia as JobHandler,
  push: sendPush as JobHandler,
  // Retired with Backboard; jobs already queued finish as no-ops.
  remember: (async () => {}) as JobHandler,
  match_notify: matchNotify as JobHandler,
  scan_photo: scanPhoto as JobHandler,
  review_report: reviewReport as JobHandler,
  weekly_nudge: weeklyNudge as JobHandler,
  review_reminder: reviewReminder as JobHandler,
  group_say: groupSay as JobHandler,
  summarize_reviews: summarizeReviews as JobHandler,
};

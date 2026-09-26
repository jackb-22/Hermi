import { matchNotify } from '../services/matching.ts';
import { syncMemory } from '../services/memory.ts';
import { sendPush } from '../services/notify.ts';
import { moderatePost } from '../services/posts.ts';
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
  remember: syncMemory as JobHandler,
  match_notify: matchNotify as JobHandler,
  scan_photo: scanPhoto as JobHandler,
  review_report: reviewReport as JobHandler,
};

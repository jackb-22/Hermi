import { sendPush } from '../services/notify.ts';
import { moderatePost } from '../services/posts.ts';
import { finalizeSession } from './finalizeSession.ts';
import { processMedia } from './processMedia.ts';
import type { JobHandler } from './queue.ts';

/** Job type → handler. Each feature registers its jobs here. */
export const handlers: Record<string, JobHandler> = {
  finalize_session: finalizeSession as JobHandler,
  moderate_post: moderatePost as JobHandler,
  process_media: processMedia as JobHandler,
  push: sendPush as JobHandler,
};

import type { FastifyPluginAsync } from 'fastify';
import { attestRoutes } from './attest.ts';
import { authRoutes } from './auth.ts';
import { checkinRoutes } from './checkins.ts';
import { devRoutes } from './dev.ts';
import { feedRoutes } from './feed.ts';
import { meRoutes } from './me.ts';
import { mediaRoutes } from './media.ts';
import { placesRoutes } from './places.ts';
import { planRoutes } from './plans.ts';
import { postRoutes } from './posts.ts';
import { profileRoutes } from './profile.ts';
import { saveRoutes } from './saves.ts';
import { scoreRoutes } from './score.ts';
import { sessionRoutes } from './sessions.ts';
import { tapRoutes } from './taps.ts';
import { tasteRoutes } from './taste.ts';

/** Route plugins, registered once under /v1 and once at the bare path. */
export const routes: FastifyPluginAsync[] = [
  authRoutes,
  attestRoutes,
  meRoutes,
  tasteRoutes,
  placesRoutes,
  planRoutes,
  sessionRoutes,
  checkinRoutes,
  mediaRoutes,
  tapRoutes,
  scoreRoutes,
  postRoutes,
  feedRoutes,
  profileRoutes,
  saveRoutes,
  devRoutes,
];

import type { FastifyPluginAsync } from 'fastify';
import { attestRoutes } from './attest.ts';
import { authRoutes } from './auth.ts';
import { checkinRoutes } from './checkins.ts';
import { devRoutes } from './dev.ts';
import { meRoutes } from './me.ts';
import { mediaRoutes } from './media.ts';
import { placesRoutes } from './places.ts';
import { planRoutes } from './plans.ts';
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
  devRoutes,
];

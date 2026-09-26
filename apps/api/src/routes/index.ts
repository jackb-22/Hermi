import type { FastifyPluginAsync } from 'fastify';
import { authRoutes } from './auth.ts';
import { meRoutes } from './me.ts';

/** Route plugins, registered once under /v1 and once at the bare path. */
export const routes: FastifyPluginAsync[] = [authRoutes, meRoutes];

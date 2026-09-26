import type { FastifyPluginAsync } from 'fastify';

/** Route plugins, registered once under /v1 and once at the bare path. */
export const routes: FastifyPluginAsync[] = [];

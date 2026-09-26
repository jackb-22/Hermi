import { timingSafeEqual } from 'node:crypto';
import { ApiError } from '@itp/shared';
import type { FastifyRequest } from 'fastify';

export const DEV_TOKEN_HEADER = 'x-dev-token';

/**
 * Dev affordances (dev login, fake Apple tokens, dev clock, dev tags, echoed .edu codes).
 * Locally they are open. On a deployment they need DEV_TOKEN set and sent as x-dev-token;
 * in production without a DEV_TOKEN they are refused outright.
 */
export function hasDevAccess(req: FastifyRequest): boolean {
  const { config } = req.server.ctx;
  if (!config.devRoutes) return false;
  if (!config.DEV_TOKEN) return config.NODE_ENV !== 'production';
  const sent = req.headers[DEV_TOKEN_HEADER];
  if (typeof sent !== 'string') return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(config.DEV_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function devGuard(req: FastifyRequest) {
  if (!hasDevAccess(req))
    throw new ApiError(403, 'FORBIDDEN', `Dev route: send a valid ${DEV_TOKEN_HEADER} header`);
}

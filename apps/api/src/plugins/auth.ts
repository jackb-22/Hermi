import jwt from '@fastify/jwt';
import { ApiError } from '@itp/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { users } from '../services/users.ts';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

export const TOKEN_TTL = '30d';

/** What a banned account gets, from routes behind a token and from the routes that issue one. */
export const bannedError = () => new ApiError(403, 'BANNED', 'This account has been suspended');

export const authPlugin = fp(async (app: FastifyInstance) => {
  await app.register(jwt, { secret: app.ctx.config.JWT_SECRET, sign: { expiresIn: TOKEN_TTL } });
  app.decorateRequest('userId', '');
});

/**
 * Verifies the bearer token, then loads the user so the token cannot outlive the account: a deleted user is 401 and
 * a banned one 403 BANNED, at once rather than when the 30-day token expires. One indexed read by _id per request.
 */
async function authenticate(req: FastifyRequest, tokenMessage: string) {
  let sub: string;
  try {
    sub = (await req.jwtVerify<{ sub: string }>()).sub;
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', tokenMessage);
  }
  const u = await users(req.server.ctx.db).findOne(
    { _id: sub },
    { projection: { deletedAt: 1, bannedAt: 1 } },
  );
  if (!u || u.deletedAt) throw new ApiError(401, 'UNAUTHORIZED', 'User no longer exists');
  if (u.bannedAt) throw bannedError();
  req.userId = sub;
}

/** preHandler: rejects with the standard envelope unless a valid bearer token of a live, unbanned user is present. */
export async function requireAuth(req: FastifyRequest) {
  await authenticate(req, 'Missing or invalid bearer token');
}

/** Route option fragment for authenticated routes (adds the OpenAPI security marker too). */
export const authed = { preHandler: requireAuth } as const;
export const bearer = [{ bearer: [] }];

/** preHandler: sets req.userId when a valid token is present, otherwise continues anonymously. */
export async function optionalAuth(req: FastifyRequest) {
  if (!req.headers.authorization) return;
  await authenticate(req, 'Invalid bearer token');
}

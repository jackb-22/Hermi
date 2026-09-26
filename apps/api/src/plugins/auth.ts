import jwt from '@fastify/jwt';
import { ApiError } from '@itp/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

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

export const authPlugin = fp(async (app: FastifyInstance) => {
  await app.register(jwt, { secret: app.ctx.config.JWT_SECRET, sign: { expiresIn: TOKEN_TTL } });
  app.decorateRequest('userId', '');
});

/** preHandler: rejects with the standard envelope unless a valid bearer token is present. */
export async function requireAuth(req: FastifyRequest) {
  try {
    const p = await req.jwtVerify<{ sub: string }>();
    req.userId = p.sub;
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid bearer token');
  }
}

/** Route option fragment for authenticated routes (adds the OpenAPI security marker too). */
export const authed = { preHandler: requireAuth } as const;
export const bearer = [{ bearer: [] }];

/** preHandler: sets req.userId when a valid token is present, otherwise continues anonymously. */
export async function optionalAuth(req: FastifyRequest) {
  if (!req.headers.authorization) return;
  try {
    const p = await req.jwtVerify<{ sub: string }>();
    req.userId = p.sub;
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid bearer token');
  }
}

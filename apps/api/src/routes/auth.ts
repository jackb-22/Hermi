import { createHash, randomInt } from 'node:crypto';
import { ApiError } from '@itp/shared';
import {
  AppleAuthBody,
  AuthResponse,
  DevAuthBody,
  EduStartBody,
  EduStartResponse,
  EduVerifyBody,
  MeSchema,
} from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authed, bearer } from '../plugins/auth.ts';
import { devGuard, hasDevAccess } from '../plugins/devGuard.ts';
import { getUser, newUser, toMe, users } from '../services/users.ts';
import { errs } from './_util.ts';

const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;

/** Known campuses; any other .edu is accepted and named from its domain. */
const CAMPUSES: Record<string, string> = {
  'columbia.edu': 'Columbia',
  'barnard.edu': 'Barnard',
  'nyu.edu': 'NYU',
  'cuny.edu': 'CUNY',
  'fordham.edu': 'Fordham',
  'newschool.edu': 'The New School',
};

export function campusFor(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (!domain.endsWith('.edu')) return null;
  const parts = domain.split('.');
  const root = parts.slice(-2).join('.');
  return CAMPUSES[root] ?? parts.at(-2)!.replace(/^./, (c) => c.toUpperCase());
}

interface EduCodeDoc {
  _id: string; // userId: one pending code per user
  codeHash: string;
  emailHash: string;
  campus: string;
  gradYear: number;
  attempts: number;
  expiresAt: Date;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, config, providers, clock } = app.ctx;
  const sign = (sub: string) => app.jwt.sign({ sub });

  app.post(
    '/auth/apple',
    {
      schema: {
        tags: ['auth'],
        summary: 'Sign in with Apple',
        body: AppleAuthBody,
        response: { 200: AuthResponse, ...errs(400, 401) },
      },
    },
    async (req) => {
      if (providers.appleIdentity.name === 'fake') await devGuard(req);
      let sub: string;
      try {
        ({ sub } = await providers.appleIdentity.verify(req.body.identityToken));
      } catch (e) {
        throw new ApiError(
          401,
          'UNAUTHORIZED',
          `Apple identity token rejected: ${(e as Error).message}`,
        );
      }
      const existing = await users(db).findOne({ appleSub: sub, deletedAt: { $exists: false } });
      if (existing)
        return {
          token: sign(existing._id),
          isNew: false,
          user: toMe(existing, config, clock.now()),
        };
      const u = newUser(clock.now(), { appleSub: sub, name: req.body.name });
      await users(db).insertOne(u);
      return { token: sign(u._id), isNew: true, user: toMe(u, config, clock.now()) };
    },
  );

  if (config.devRoutes) {
    app.post(
      '/auth/dev',
      {
        preHandler: devGuard,
        schema: {
          tags: ['dev'],
          summary:
            'Dev-only sign in by username (creates the user if needed). Needs x-dev-token on deployments.',
          body: DevAuthBody,
          response: { 200: AuthResponse },
        },
      },
      async (req) => {
        const found = await users(db).findOne({
          username: req.body.username,
          deletedAt: { $exists: false },
        });
        if (found)
          return { token: sign(found._id), isNew: false, user: toMe(found, config, clock.now()) };
        const u = newUser(clock.now(), {
          username: req.body.username,
          name: req.body.name ?? req.body.username,
        });
        await users(db).insertOne(u);
        return { token: sign(u._id), isNew: true, user: toMe(u, config, clock.now()) };
      },
    );
  }

  app.post(
    '/auth/edu',
    {
      ...authed,
      schema: {
        tags: ['auth'],
        summary: 'Start student verification: sends a 6-digit code to a .edu address',
        security: bearer,
        body: EduStartBody,
        response: { 200: EduStartResponse, ...errs(400, 401) },
      },
    },
    async (req) => {
      const campus = campusFor(req.body.email);
      if (!campus)
        throw new ApiError(400, 'EDU_DOMAIN_NOT_ALLOWED', 'Use your school (.edu) email');
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = new Date(clock.now().getTime() + CODE_TTL_MS);
      await db.collection<EduCodeDoc>('edu_codes').replaceOne(
        { _id: req.userId },
        {
          codeHash: sha(`${req.userId}:${code}`),
          emailHash: sha(req.body.email.toLowerCase()),
          campus,
          gradYear: req.body.gradYear,
          attempts: 0,
          expiresAt,
        },
        { upsert: true },
      );
      await providers.email.send(
        req.body.email,
        'Your verification code',
        `Your code is ${code}. It expires in 10 minutes.`,
      );
      return {
        sent: true as const,
        campus,
        expiresAt: expiresAt.toISOString(),
        devCode: providers.email.name === 'console' && hasDevAccess(req) ? code : undefined,
      };
    },
  );

  app.post(
    '/auth/edu/verify',
    {
      ...authed,
      schema: {
        tags: ['auth'],
        summary: 'Finish student verification with the emailed code',
        security: bearer,
        body: EduVerifyBody,
        response: { 200: MeSchema, ...errs(400, 401) },
      },
    },
    async (req) => {
      const codes = db.collection<EduCodeDoc>('edu_codes');
      const pending = await codes.findOne({ _id: req.userId });
      if (!pending || pending.expiresAt <= clock.now()) {
        throw new ApiError(400, 'EDU_CODE_EXPIRED', 'Code expired; request a new one');
      }
      if (pending.attempts >= MAX_CODE_ATTEMPTS) {
        await codes.deleteOne({ _id: req.userId });
        throw new ApiError(400, 'EDU_CODE_EXPIRED', 'Too many attempts; request a new code');
      }
      if (pending.codeHash !== sha(`${req.userId}:${req.body.code}`)) {
        await codes.updateOne({ _id: req.userId }, { $inc: { attempts: 1 } });
        throw new ApiError(400, 'EDU_CODE_INVALID', 'Wrong code');
      }
      await codes.deleteOne({ _id: req.userId });
      await users(db).updateOne(
        { _id: req.userId },
        {
          $set: {
            verifiedAt: clock.now(),
            campus: pending.campus,
            gradYear: pending.gradYear,
            eduEmailHash: pending.emailHash,
          },
        },
      );
      return toMe(await getUser(db, req.userId), config, clock.now());
    },
  );
};

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
import { parseEduEmail, SCHOOL_EMAIL_HINT } from '../services/eduEmail.ts';
import { hit } from '../services/rateLimit.ts';
import { getUser, isDupKey, newUser, toMe, users } from '../services/users.ts';
import { errs } from './_util.ts';

const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
/**
 * Code emails per hour. The free Resend tier is 100 a day, so a script must not drain it. The per-user
 * cap is the main guard: each attacker account needs a real Apple ID. The per-IP cap is sized for the
 * sign-up stand (dozens of students an hour on one campus Wi-Fi or carrier NAT); raise it before an
 * event if people get 429.
 */
const EDU_SENDS_PER_USER = 5;
const EDU_SENDS_PER_IP = 60;
const EDU_SEND_WINDOW_S = 3600;

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
const emailTaken = () =>
  new ApiError(409, 'EDU_EMAIL_TAKEN', 'That school email is already verified on another account');

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
        summary:
          'Start student verification: emails a 6-digit code to a Columbia or Barnard address',
        description:
          'Columbia and Barnard addresses and their subdomains only. Each attempt on an allowed domain counts ' +
          `toward ${EDU_SENDS_PER_USER} an hour per account and ${EDU_SENDS_PER_IP} an hour per IP (429 ` +
          'RATE_LIMITED). A school email verifies one account: 409 EDU_EMAIL_TAKEN when another holds it.',
        security: bearer,
        body: EduStartBody,
        response: { 200: EduStartResponse, ...errs(400, 401, 409, 429) },
      },
    },
    async (req) => {
      // A deleted account's token stays valid; it must not be able to claim an address.
      await getUser(db, req.userId);
      // A refused domain sends nothing and costs nothing, so it is not counted: a typo should not burn
      // one of the five. Everything after it is, including the taken-address 409, which would otherwise
      // let a script probe which addresses are verified.
      const edu = parseEduEmail(req.body.email);
      if (!edu) throw new ApiError(400, 'EDU_DOMAIN_NOT_ALLOWED', SCHOOL_EMAIL_HINT);
      // User first: a user already over their cap must not keep draining the IP's shared budget.
      const now = clock.now();
      await hit(db, `edu:user:${req.userId}`, EDU_SENDS_PER_USER, EDU_SEND_WINDOW_S, now);
      await hit(db, `edu:ip:${req.ip}`, EDU_SENDS_PER_IP, EDU_SEND_WINDOW_S, now);
      const holder = await users(db).findOne(
        { eduEmailHash: edu.hash, _id: { $ne: req.userId }, deletedAt: { $exists: false } },
        { projection: { _id: 1 } },
      );
      if (holder) throw emailTaken();
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
      await db.collection<EduCodeDoc>('edu_codes').replaceOne(
        { _id: req.userId },
        {
          codeHash: sha(`${req.userId}:${code}`),
          emailHash: edu.hash,
          campus: edu.campus,
          gradYear: req.body.gradYear,
          attempts: 0,
          expiresAt,
        },
        { upsert: true },
      );
      await providers.email.send(
        edu.address,
        'Your verification code',
        `Your code is ${code}. It expires in 10 minutes.`,
      );
      return {
        sent: true as const,
        campus: edu.campus,
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
        description:
          'EDU_EMAIL_TAKEN (409) if another account verified the same address after the code was sent.',
        security: bearer,
        body: EduVerifyBody,
        response: { 200: MeSchema, ...errs(400, 401, 409) },
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
      try {
        // The unique index on eduEmailHash settles two accounts racing for one address; the loser lands here.
        await users(db).updateOne(
          { _id: req.userId, deletedAt: { $exists: false } },
          {
            $set: {
              verifiedAt: clock.now(),
              campus: pending.campus,
              gradYear: pending.gradYear,
              eduEmailHash: pending.emailHash,
            },
          },
        );
      } catch (e) {
        if (isDupKey(e)) throw emailTaken();
        throw e;
      }
      return toMe(await getUser(db, req.userId), config, clock.now());
    },
  );
};

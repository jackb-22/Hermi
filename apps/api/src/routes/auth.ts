import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
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
import { checkName } from '../domain/nameFilter.ts';
import { authed, bannedError, bearer } from '../plugins/auth.ts';
import { devGuard, hasDevAccess } from '../plugins/devGuard.ts';
import {
  isReviewCampus,
  parseEduEmail,
  REVIEW_CAMPUS,
  reviewCodeFor,
  SCHOOL_EMAIL_HINT,
  schoolEmailKey,
} from '../services/eduEmail.ts';
import { hit } from '../services/rateLimit.ts';
import { befriendReviewer } from '../services/social.ts';
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
  /** Absent for App Review: the shared review address must not claim the one-per-account hash. */
  emailHash?: string;
  campus: string;
  gradYear: number;
  attempts: number;
  expiresAt: Date;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Hex digests compared in constant time, so response timing cannot narrow down a code. */
const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const emailTaken = () =>
  new ApiError(409, 'EDU_EMAIL_TAKEN', 'That school email is already verified on another account');

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, config, providers, clock } = app.ctx;
  const sign = (sub: string) => app.jwt.sign({ sub });
  const eduKey = schoolEmailKey(config.JWT_SECRET);
  /** Replaces the user's pending code (only its hash is kept) and returns when it expires. */
  async function keepCode(
    userId: string,
    now: Date,
    o: { code: string; campus: string; emailHash?: string; gradYear: number },
  ) {
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
    await db.collection<EduCodeDoc>('edu_codes').replaceOne(
      { _id: userId },
      {
        codeHash: sha(`${userId}:${o.code}`),
        ...(o.emailHash ? { emailHash: o.emailHash } : {}),
        campus: o.campus,
        gradYear: o.gradYear,
        attempts: 0,
        expiresAt,
      },
      { upsert: true },
    );
    return expiresAt;
  }

  app.post(
    '/auth/apple',
    {
      schema: {
        tags: ['auth'],
        summary: 'Sign in with Apple',
        description:
          'A suspended account gets 403 BANNED and no token (its code is not exchanged).',
        body: AppleAuthBody,
        response: { 200: AuthResponse, ...errs(400, 401, 403) },
      },
    },
    async (req) => {
      const apple = providers.appleIdentity;
      if (apple.name === 'fake') await devGuard(req);
      const { identityToken, nonce, authorizationCode, name } = req.body;
      let sub: string;
      try {
        ({ sub } = await apple.verify(identityToken, nonce));
      } catch (e) {
        throw new ApiError(
          401,
          'UNAUTHORIZED',
          `Apple identity token rejected: ${(e as Error).message}`,
        );
      }
      const existing = await users(db).findOne({ appleSub: sub, deletedAt: { $exists: false } });
      // Before the exchange: a banned account's code is never traded, so Apple is not called and
      // the stored refresh token stays as it was. The code is single use: nothing is lost.
      if (existing?.bannedAt) throw bannedError();
      // Every sign-in exchanges its code, so the stored token comes from the latest authorization (one
      // kept from before the user revoked us in Settings would make the revoke at deletion useless).
      // A failure must not block sign-in: the code is single use, so the next sign-in retries with a new one.
      let appleRefreshToken: string | undefined;
      try {
        appleRefreshToken = await apple.exchangeCode(authorizationCode, sub);
      } catch (e) {
        req.log.warn(
          { reason: (e as Error).message },
          'Apple code exchange failed; signing in without storing a refresh token',
        );
      }
      if (existing) {
        if (appleRefreshToken)
          await users(db).updateOne({ _id: existing._id }, { $set: { appleRefreshToken } });
        return {
          token: sign(existing._id),
          isNew: false,
          user: toMe(existing, config, clock.now()),
        };
      }
      // Apple sends the name once, on the first sign-in, so a refusal must not fail the request: the account is
      // made without a name, which the person can set later. An existing user's name is never taken from Apple.
      const u = newUser(clock.now(), {
        appleSub: sub,
        name: name !== undefined && checkName(name, 'displayName').ok ? name : undefined,
        appleRefreshToken,
      });
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
          response: { 200: AuthResponse, ...errs(403) },
        },
      },
      async (req) => {
        const found = await users(db).findOne({
          username: req.body.username,
          deletedAt: { $exists: false },
        });
        if (found?.bannedAt) throw bannedError();
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
      const now = clock.now();
      // App Review: the one address that takes a fixed code, not a school inbox (REVIEW_EMAIL).
      // It goes before the domain list and skips the taken check (several reviewer accounts share
      // it) and the per-IP cap (reviewers share Apple's networks). The per-user cap stays, so a
      // leaked address gets 25 code guesses an hour per account. Nothing is emailed, and the
      // response has no devCode: the review code is never echoed.
      const reviewCode = reviewCodeFor(config, req.body.email);
      if (reviewCode) {
        await hit(db, `edu:user:${req.userId}`, EDU_SENDS_PER_USER, EDU_SEND_WINDOW_S, now);
        const expiresAt = await keepCode(req.userId, now, {
          code: reviewCode,
          campus: REVIEW_CAMPUS,
          gradYear: req.body.gradYear,
        });
        return { sent: true as const, campus: REVIEW_CAMPUS, expiresAt: expiresAt.toISOString() };
      }
      // A refused domain sends nothing and costs nothing, so it is not counted: a typo should not burn
      // one of the five. Everything after it is, including the taken-address 409, which would otherwise
      // let a script probe which addresses are verified.
      const edu = parseEduEmail(req.body.email, eduKey);
      if (!edu) throw new ApiError(400, 'EDU_DOMAIN_NOT_ALLOWED', SCHOOL_EMAIL_HINT);
      // User first: a user already over their cap must not keep draining the IP's shared budget.
      await hit(db, `edu:user:${req.userId}`, EDU_SENDS_PER_USER, EDU_SEND_WINDOW_S, now);
      await hit(db, `edu:ip:${req.ip}`, EDU_SENDS_PER_IP, EDU_SEND_WINDOW_S, now);
      const holder = await users(db).findOne(
        { eduEmailHash: edu.hash, _id: { $ne: req.userId }, deletedAt: { $exists: false } },
        { projection: { _id: 1 } },
      );
      if (holder) throw emailTaken();
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = await keepCode(req.userId, now, {
        code,
        campus: edu.campus,
        emailHash: edu.hash,
        gradYear: req.body.gradYear,
      });
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
      if (!sameHash(pending.codeHash, sha(`${req.userId}:${req.body.code}`))) {
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
              // App Review has no hash: reviewer accounts share the address, and the unique
              // index is what keeps a real student's address on one account.
              ...(pending.emailHash ? { eduEmailHash: pending.emailHash } : {}),
            },
          },
        );
      } catch (e) {
        if (isDupKey(e)) throw emailTaken();
        throw e;
      }
      const me = await getUser(db, req.userId);
      // App Review gets one real friend to try Report and Block on. The code is spent and the
      // account is verified by now, so a problem here is logged, not returned.
      if (config.REVIEW_FRIEND_ID && isReviewCampus(pending.campus)) {
        const outcome = await befriendReviewer(
          db,
          me._id,
          config.REVIEW_FRIEND_ID,
          clock.now(),
        ).catch((e) => (e as Error).message);
        if (outcome !== 'made' && outcome !== 'exists')
          req.log.warn(
            { userId: me._id, friendId: config.REVIEW_FRIEND_ID, reason: outcome },
            'App Review friendship not made',
          );
      }
      return toMe(me, config, clock.now());
    },
  );
};

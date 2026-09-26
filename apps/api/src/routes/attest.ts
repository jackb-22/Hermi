import { randomBytes } from 'node:crypto';
import { ApiError } from '@itp/shared';
import { AttestChallengeResponse, AttestRegisterBody, OkSchema } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AttestKeyDoc } from '../plugins/attest.ts';
import { authed, bearer } from '../plugins/auth.ts';
import { errs } from './_util.ts';

interface ChallengeDoc {
  _id: string;
  userId: string;
  expiresAt: Date;
}

export const attestRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, clock, providers } = app.ctx;

  app.get(
    '/attest/challenge',
    {
      ...authed,
      schema: {
        tags: ['integrity'],
        summary: 'One-time challenge for App Attest key registration',
        description:
          'Then send every check-in, tap and capture with header `x-app-attest: base64(JSON{keyId, assertion})`, ' +
          'where assertion = generateAssertion(keyId, sha256(raw request body)).',
        security: bearer,
        response: { 200: AttestChallengeResponse },
      },
    },
    async (req) => {
      const doc = {
        _id: randomBytes(24).toString('base64url'),
        userId: req.userId,
        expiresAt: new Date(clock.now().getTime() + 5 * 60_000),
      };
      await db.collection<ChallengeDoc>('attest_challenges').insertOne(doc);
      return { challenge: doc._id, expiresAt: doc.expiresAt.toISOString() };
    },
  );

  app.post(
    '/attest/register',
    {
      ...authed,
      schema: {
        tags: ['integrity'],
        summary: 'Register an App Attest key for this user',
        security: bearer,
        body: AttestRegisterBody,
        response: { 200: OkSchema, ...errs(400, 401, 403) },
      },
    },
    async (req) => {
      const ch = await db
        .collection<ChallengeDoc>('attest_challenges')
        .findOneAndDelete({ _id: req.body.challenge, userId: req.userId });
      if (!ch || ch.expiresAt < clock.now())
        throw new ApiError(400, 'BAD_REQUEST', 'Unknown or expired challenge');
      let publicKey: string;
      try {
        ({ publicKey } = providers.appAttest.attestation({
          attestation: Buffer.from(req.body.attestation, 'base64'),
          challenge: req.body.challenge,
          keyId: req.body.keyId,
        }));
      } catch (e) {
        throw new ApiError(403, 'ATTEST_FAILED', `Attestation rejected: ${(e as Error).message}`);
      }
      await db
        .collection<AttestKeyDoc>('attest_keys')
        .updateOne(
          { _id: req.body.keyId },
          { $set: { userId: req.userId, publicKey, signCount: 0, createdAt: clock.now() } },
          { upsert: true },
        );
      return { ok: true as const };
    },
  );
};

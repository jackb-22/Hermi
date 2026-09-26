import { ApiError } from '@itp/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
    /** True when the request carried a valid App Attest assertion over its body. */
    attested: boolean;
  }
}

export interface AttestKeyDoc {
  _id: string; // keyId
  userId: string;
  publicKey: string;
  signCount: number;
  createdAt: Date;
}

export const ATTEST_HEADER = 'x-app-attest';

/** Keep the raw JSON body: assertions sign the exact bytes the app sent. */
export const rawBodyPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('attested', false);
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const s = body as string;
    req.rawBody = s;
    if (!s) return done(null, {});
    try {
      done(null, JSON.parse(s));
    } catch {
      done(new ApiError(400, 'BAD_REQUEST', 'Malformed JSON body'), undefined);
    }
  });
});

/**
 * preHandler for check-ins, taps and captures. Header x-app-attest = base64(JSON {keyId, assertion}).
 * ATTEST_MODE: off → skip; log → verify and record, never block; enforce → reject missing or invalid.
 */
export async function attestGuard(req: FastifyRequest) {
  const { config, db, providers } = req.server.ctx;
  if (config.ATTEST_MODE === 'off') return;
  const header = req.headers[ATTEST_HEADER];
  const fail = (why: string) => {
    if (config.ATTEST_MODE === 'enforce')
      throw new ApiError(403, 'ATTEST_FAILED', `App attestation failed: ${why}`);
    req.log.warn({ why, userId: req.userId }, 'unattested request (log mode)');
  };
  if (typeof header !== 'string') return fail('missing header');
  try {
    const { keyId, assertion } = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as {
      keyId: string;
      assertion: string;
    };
    const keys = db.collection<AttestKeyDoc>('attest_keys');
    const key = await keys.findOne({ _id: keyId });
    if (!key || key.userId !== req.userId) return fail('unknown key');
    const { signCount } = providers.appAttest.assertion({
      assertion: Buffer.from(assertion, 'base64'),
      payload: req.rawBody ?? '',
      publicKey: key.publicKey,
      signCount: key.signCount,
    });
    // Counter must move forward: a replayed assertion loses the race here.
    const moved = await keys.updateOne(
      { _id: keyId, signCount: { $lt: signCount } },
      { $set: { signCount } },
    );
    if (!moved.modifiedCount) return fail('replayed assertion');
    req.attested = true;
  } catch (e) {
    return fail((e as Error).message);
  }
}

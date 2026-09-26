import { ApiError, buildTagUrl } from '@itp/shared';
import { ClockBody, ClockResponse, DevTagBody, DevTagResponse } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { bearer, requireAuth } from '../plugins/auth.ts';
import { devGuard } from '../plugins/devGuard.ts';
import { places } from '../services/places.ts';
import { hashSecret, newSecret, newTagId, tags } from '../services/tags.ts';
import { users } from '../services/users.ts';

/** Dev-only affordances: registered only with DEV_ROUTES (or outside production), and gated by x-dev-token on deployments. */
export const devRoutes: FastifyPluginAsyncZod = async (app) => {
  const { config, clock, db } = app.ctx;
  if (!config.devRoutes) return;
  app.addHook('preHandler', devGuard);

  app.get(
    '/dev/clock',
    { schema: { tags: ['dev'], response: { 200: ClockResponse } } },
    async () => ({ now: clock.now().toISOString(), offsetMs: clock.offsetMs }),
  );

  app.post(
    '/dev/clock',
    {
      schema: {
        tags: ['dev'],
        summary:
          'Shift the server clock (streaks, score decay, time-compressed walk replays). Global to the process.',
        body: ClockBody,
        response: { 200: ClockResponse },
      },
    },
    async (req) => {
      if (req.body.reset) clock.offsetMs = 0;
      if (req.body.offsetMs !== undefined) clock.offsetMs = req.body.offsetMs;
      if (req.body.advanceMs !== undefined) clock.offsetMs += req.body.advanceMs;
      return { now: clock.now().toISOString(), offsetMs: clock.offsetMs };
    },
  );

  app.post(
    '/dev/tags',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['dev'],
        summary:
          'Mint a venue or personal tag and get its URL (render it as a QR code to test scanning)',
        security: bearer,
        body: DevTagBody,
        response: { 200: DevTagResponse },
      },
    },
    async (req) => {
      const id = newTagId();
      const k = newSecret();
      if (req.body.kind === 'venue') {
        const p = req.body.placeId ? await places(db).findOne({ _id: req.body.placeId }) : null;
        if (!p) throw new ApiError(400, 'BAD_REQUEST', 'placeId required for a venue tag');
        await tags(db).insertOne({
          _id: id,
          kind: 'venue',
          placeId: p._id,
          secretHash: hashSecret(k),
          chip: 'dev',
          createdAt: clock.now(),
        });
        await places(db).updateOne({ _id: p._id }, { $set: { venueTagId: id } });
      } else {
        const ownerId = req.body.bindToMe ? req.userId : undefined;
        await tags(db).insertOne({
          _id: id,
          kind: 'personal',
          ownerId,
          secretHash: hashSecret(k),
          chip: 'dev',
          createdAt: clock.now(),
        });
        if (ownerId) await users(db).updateOne({ _id: ownerId }, { $set: { tagId: id } });
      }
      return {
        tagId: id,
        url: buildTagUrl(config.PUBLIC_BASE_URL, { kind: req.body.kind, id, k }),
      };
    },
  );
};

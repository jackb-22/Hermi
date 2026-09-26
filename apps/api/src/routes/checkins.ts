import { ApiError } from '@itp/shared';
import { CheckinBody, CheckinResponse } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { attestGuard } from '../plugins/attest.ts';
import { bearer, requireAuth } from '../plugins/auth.ts';
import { createCheckin } from '../services/checkins.ts';
import { verifyTag } from '../services/tags.ts';
import { errs } from './_util.ts';

export const checkinRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, clock } = app.ctx;

  app.post(
    '/checkins',
    {
      preHandler: [requireAuth, attestGuard],
      schema: {
        tags: ['action'],
        summary: 'Check in: GPS tier (5 min inside the 100 m fence) or tag tier (venue QR / NFC within 150 m)',
        description: 'Gates XP, reviews and posts. One check-in per user per venue every 6 hours. Tag tier earns 15 XP, GPS 10, +10 on a first visit.',
        security: bearer,
        body: CheckinBody,
        response: { 200: CheckinResponse, ...errs(400, 401, 403, 404, 409, 429) },
      },
    },
    async (req) => {
      const b = req.body;
      let placeId = b.placeId;
      let tagId: string | undefined;
      if (b.tier === 'tag') {
        const tag = await verifyTag(db, b, 'venue');
        if (!tag.placeId) throw new ApiError(400, 'TAG_INVALID', 'Tag is not bound to a venue');
        placeId = tag.placeId;
        tagId = tag._id;
      }
      const time = b.time ? new Date(b.time) : clock.now();
      if (Math.abs(time.getTime() - clock.now().getTime()) > 10 * 60_000) throw new ApiError(400, 'BAD_REQUEST', 'Check-in time is too far from now');
      return createCheckin(app.ctx, {
        userId: req.userId,
        placeId: placeId!,
        tier: b.tier,
        at: { lat: b.lat, lng: b.lng },
        accuracy: b.accuracy,
        time,
        attested: req.attested,
        sessionId: b.sessionId,
        tagId,
      });
    },
  );
};

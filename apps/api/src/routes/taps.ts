import { ApiError, parseTagUrl } from '@itp/shared';
import { BindTagBody, MeSchema, TapBody, TapResponse } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { attestGuard } from '../plugins/attest.ts';
import { authed, bearer, requireAuth } from '../plugins/auth.ts';
import { checkinHooks, createCheckin } from '../services/checkins.ts';
import {
  findReciprocal,
  friendships,
  logHangout,
  pairKey,
  recordTagRead,
  TAP_WINDOW_MS,
  toStreak,
  toUserCard,
  venueHangouts,
} from '../services/social.ts';
import { tags, verifyTag } from '../services/tags.ts';
import { getUser, toMe, users } from '../services/users.ts';
import { errs } from './_util.ts';

checkinHooks.push(venueHangouts);

export const tapRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, tiger, config, clock } = app.ctx;

  app.post(
    '/taps',
    {
      preHandler: [requireAuth, attestGuard],
      schema: {
        tags: ['social'],
        summary:
          'A tag was read (NFC tap or QR scan): venue tags check in; personal tags pair two phones',
        description:
          'Both people tap each other\'s personal tag within 2 minutes and 50 m. First tap returns status "waiting"; ' +
          'the second completes it: "friends" (new) or "hangout" (streak moved). Tapping tags is the only way to add a friend.',
        security: bearer,
        body: TapBody,
        response: { 200: TapResponse, ...errs(400, 401, 403, 404, 409, 429) },
      },
    },
    async (req) => {
      const b = req.body;
      const time = b.time ? new Date(b.time) : clock.now();
      if (Math.abs(time.getTime() - clock.now().getTime()) > 10 * 60_000)
        throw new ApiError(400, 'BAD_REQUEST', 'Tap time is too far from now');
      const at = { lat: b.lat, lng: b.lng };
      const kind = b.url ? parseTagUrl(b.url)?.kind : undefined;
      const tag = await verifyTag(db, { tagUrl: b.url, tagId: b.tagId, k: b.k }, kind);
      await recordTagRead(app.ctx, {
        userId: req.userId,
        tagId: tag._id,
        kind: tag.kind,
        at,
        accuracy: b.accuracy,
        time,
        attested: req.attested,
      });
      const empty = { expiresAt: null, friend: null, streak: null, checkin: null };

      if (tag.kind === 'venue') {
        const checkin = await createCheckin(app.ctx, {
          userId: req.userId,
          placeId: tag.placeId!,
          tier: 'tag',
          at,
          accuracy: b.accuracy,
          time,
          attested: req.attested,
          tagId: tag._id,
        });
        return { ...empty, kind: 'venue' as const, status: 'checked_in' as const, checkin };
      }

      if (!tag.ownerId)
        throw new ApiError(400, 'TAG_INVALID', 'This tag is not bound to anyone yet');
      if (tag.ownerId === req.userId)
        throw new ApiError(400, 'TAG_INVALID', 'That is your own tag: tap your friend’s');
      const [me, owner] = await Promise.all([
        getUser(db, req.userId),
        users(db).findOne({ _id: tag.ownerId }),
      ]);
      if (!owner || owner.deletedAt) throw new ApiError(404, 'NOT_FOUND', 'Tag owner not found');
      const friend = toUserCard(owner, config);
      const reciprocal = me.tagId
        ? await findReciprocal(app.ctx, {
            readerId: me._id,
            ownerId: owner._id,
            readerTagId: me.tagId,
            at,
            time,
            requireAttested: config.ATTEST_MODE === 'enforce',
          })
        : null;
      if (!reciprocal) {
        return {
          ...empty,
          kind: 'personal' as const,
          status: 'waiting' as const,
          friend,
          expiresAt: new Date(time.getTime() + TAP_WINDOW_MS).toISOString(),
        };
      }
      const h = await logHangout(app.ctx, me._id, owner._id, time, 'tap');
      return {
        ...empty,
        kind: 'personal' as const,
        status: h!.status,
        friend,
        streak: toStreak(h!.friendship, time),
      };
    },
  );

  app.get(
    '/taps/pending',
    {
      ...authed,
      schema: {
        tags: ['social'],
        summary: 'Poll during the 2-minute window: has the other person tapped back?',
        security: bearer,
        querystring: z.object({ friendId: z.string() }),
        response: { 200: TapResponse, ...errs(401) },
      },
    },
    async (req) => {
      const now = clock.now();
      const owner = await users(db).findOne({ _id: req.query.friendId });
      if (!owner) throw new ApiError(404, 'NOT_FOUND', 'No such user');
      const base = { kind: 'personal' as const, friend: toUserCard(owner, config), checkin: null };
      const f = await friendships(db).findOne({ _id: pairKey(req.userId, owner._id) });
      const { rows } = await tiger.query<{ time: Date }>(
        'select time from tag_reads where user_id = $1 and tag_id = $2 order by time desc limit 1',
        [req.userId, owner.tagId ?? ''],
      );
      const myTap = rows[0]?.time;
      if (f && myTap) {
        const from = new Date(myTap.getTime() - TAP_WINDOW_MS);
        const matched = (
          await tiger.query('select 1 from hangouts where pair_key = $1 and time >= $2 limit 1', [
            f._id,
            from,
          ])
        ).rowCount;
        if (matched)
          return {
            ...base,
            status: f.since >= from ? ('friends' as const) : ('hangout' as const),
            expiresAt: null,
            streak: toStreak(f, now),
          };
      }
      const open = myTap && now.getTime() - myTap.getTime() < TAP_WINDOW_MS;
      return {
        ...base,
        status: 'waiting' as const,
        expiresAt: open ? new Date(myTap.getTime() + TAP_WINDOW_MS).toISOString() : null,
        streak: f ? toStreak(f, now) : null,
      };
    },
  );

  app.post(
    '/me/tag',
    {
      ...authed,
      schema: {
        tags: ['social'],
        summary: 'Bind your personal NFC sticker (handed out at onboarding)',
        security: bearer,
        body: BindTagBody,
        response: { 200: MeSchema, ...errs(400, 401, 409) },
      },
    },
    async (req) => {
      const tag = await verifyTag(db, { tagUrl: req.body.url }, 'personal');
      if (tag.ownerId && tag.ownerId !== req.userId)
        throw new ApiError(409, 'CONFLICT', 'This tag belongs to someone else');
      await tags(db).updateOne({ _id: tag._id }, { $set: { ownerId: req.userId } });
      await tags(db).updateMany(
        { kind: 'personal', ownerId: req.userId, _id: { $ne: tag._id } },
        { $unset: { ownerId: '' } },
      );
      await users(db).updateOne({ _id: req.userId }, { $set: { tagId: tag._id } });
      return toMe(await getUser(db, req.userId), config, clock.now());
    },
  );
};

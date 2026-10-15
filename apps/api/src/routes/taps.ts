import { ApiError, parseTagUrl } from '@itp/shared';
import { BindTagBody, MeSchema, MyCodeResponse, TapBody, TapResponse } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { attestGuard } from '../plugins/attest.ts';
import { authed, bearer, requireAuth } from '../plugins/auth.ts';
import { createCheckin } from '../services/checkins.ts';
import {
  findReciprocal,
  friendships,
  logHangout,
  PENDING_LOOKBACK_MS,
  pairKey,
  recordTagRead,
  TAP_WINDOW_MS,
  toStreak,
  toUserCard,
  visibleUser,
} from '../services/social.ts';
import { personalCode, tags, verifyTag } from '../services/tags.ts';
import { getUser, toMe, users } from '../services/users.ts';
import { errs } from './_util.ts';

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
          'the second completes it: "friends" (new) or "hangout" (streak moved). Tapping tags is the only way to add a friend. ' +
          'A personal tag whose owner is deleted, or blocked either way, is 404 like an unknown user.',
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
      // An owner who is deleted, or blocked either way, is "no such user" like everywhere else: the tap never
      // pairs, shows no card and is not recorded (a stored read could pair the two after an unblock).
      const owner =
        tag.kind === 'personal' && tag.ownerId && tag.ownerId !== req.userId
          ? await visibleUser(db, req.userId, tag.ownerId)
          : undefined;
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
      const me = await getUser(db, req.userId);
      const friend = toUserCard(owner!, config); // set above for any bound tag that is not yours
      const reciprocal = me.tagId
        ? await findReciprocal(app.ctx, {
            readerId: me._id,
            ownerId: tag.ownerId,
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
      const h = await logHangout(app.ctx, me._id, tag.ownerId, time, 'tap');
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
        description:
          'Only for someone whose tag you just tapped (POST /taps returned their card), or a friend; anyone else is 404.',
        security: bearer,
        querystring: z.object({ friendId: z.string() }),
        response: { 200: TapResponse, ...errs(401, 404) },
      },
    },
    async (req) => {
      const now = clock.now();
      const owner = await visibleUser(db, req.userId, req.query.friendId);
      const base = { kind: 'personal' as const, friend: toUserCard(owner, config), checkin: null };
      const f = await friendships(db).findOne({ _id: pairKey(req.userId, owner._id) });
      const { rows } = await tiger.query<{ time: Date }>(
        'select time from tag_reads where user_id = $1 and tag_id = $2 order by time desc limit 1',
        [req.userId, owner.tagId ?? ''],
      );
      const myTap = rows[0]?.time;
      // The card is only for the other half of a pairing: a friend, or someone whose tag you tapped a moment ago.
      if (!f && !(myTap && now.getTime() - myTap.getTime() < PENDING_LOOKBACK_MS))
        throw new ApiError(404, 'NOT_FOUND', 'No such user');
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
    '/me/code',
    {
      ...authed,
      schema: {
        tags: ['social'],
        summary: 'Your personal QR code: made on the first call, the same URL on every call after',
        description:
          "Send no body. The URL is a /t universal link, so a friend's Camera app opens it in the app, which sends it to " +
          'POST /taps like an NFC tap. Binding a sticker (POST /me/tag) replaces the code; from then on this answers ' +
          '`kind: "sticker"` with no URL.',
        security: bearer,
        response: { 200: MyCodeResponse, ...errs(401) },
      },
    },
    async (req) => personalCode(app.ctx, req.userId),
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
      // A code unbound by a sticker would otherwise be up for grabs to anyone who photographed its QR.
      if (tag.derived) throw new ApiError(400, 'TAG_INVALID', 'That is a code, not a sticker');
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

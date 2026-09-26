import { ApiError } from '@itp/shared';
import { MeSchema, OkSchema, PatchMeBody, PushTokenBody } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authed, bearer, requireAuth } from '../plugins/auth.ts';
import { uploadProfilePhoto } from '../services/safety.ts';
import { getUser, isDupKey, toMe, users } from '../services/users.ts';
import { errs } from './_util.ts';

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, config, clock } = app.ctx;

  app.get(
    '/me',
    {
      ...authed,
      schema: { tags: ['me'], security: bearer, response: { 200: MeSchema, ...errs(401) } },
    },
    async (req) => toMe(await getUser(db, req.userId), config, clock.now()),
  );

  app.patch(
    '/me',
    {
      ...authed,
      schema: {
        tags: ['me'],
        summary: 'Edit profile fields and settings (ghost mode, open to plans)',
        security: bearer,
        body: PatchMeBody,
        response: { 200: MeSchema, ...errs(400, 401, 409) },
      },
    },
    async (req) => {
      try {
        // photoKey is ignored: photos arrive through POST /me/photo, which scans them first.
        const { photoKey: _ignored, ...fields } = req.body;
        await users(db).updateOne({ _id: req.userId }, { $set: fields });
      } catch (e) {
        if (isDupKey(e)) throw new ApiError(409, 'USERNAME_TAKEN', 'Username is taken');
        throw e;
      }
      return toMe(await getUser(db, req.userId), config, clock.now());
    },
  );

  // Raw image bytes (Content-Type: image/jpeg, image/png, image/heic or image/webp), not JSON.
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      /^image\//,
      { parseAs: 'buffer', bodyLimit: 12 * 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );
    scope.post(
      '/me/photo',
      {
        preHandler: requireAuth,
        schema: {
          tags: ['me'],
          summary: 'Upload a profile photo (raw image bytes, up to 12 MB)',
          description:
            'Send the image as the body with its Content-Type. Images whose Content Credentials declare AI generation are refused (422 PHOTO_REJECTED). ' +
            'With Reality Defender configured the photo is scanned first: Me.photoReview shows scanning, then it goes live or is rejected (push kind photo_rejected).',
          security: bearer,
          response: { 200: MeSchema, ...errs(400, 401, 422) },
        },
      },
      async (req) => {
        if (!Buffer.isBuffer(req.body))
          throw new ApiError(
            400,
            'BAD_REQUEST',
            'Send the image bytes with an image/* Content-Type',
          );
        await uploadProfilePhoto(
          app.ctx,
          req.userId,
          req.body,
          String(req.headers['content-type']).split(';')[0]!.trim(),
        );
        return toMe(await getUser(db, req.userId), config, clock.now());
      },
    );
  });

  app.post(
    '/me/push-token',
    {
      ...authed,
      schema: {
        tags: ['me'],
        summary: 'Register an Expo push token',
        security: bearer,
        body: PushTokenBody,
        response: { 200: OkSchema },
      },
    },
    async (req) => {
      await users(db).updateOne({ _id: req.userId }, { $addToSet: { pushTokens: req.body.token } });
      return { ok: true as const };
    },
  );

  app.delete(
    '/me',
    {
      ...authed,
      schema: {
        tags: ['me'],
        summary: 'Delete account',
        security: bearer,
        response: { 200: OkSchema },
      },
    },
    async (req) => {
      await users(db).updateOne(
        { _id: req.userId },
        {
          $set: { deletedAt: clock.now(), openToPlans: false, ghostMode: true },
          $unset: { username: '', appleSub: '', pushTokens: '' },
        },
      );
      await db
        .collection('posts')
        .updateMany({ authorId: req.userId }, { $set: { status: 'removed' } });
      return { ok: true as const };
    },
  );
};

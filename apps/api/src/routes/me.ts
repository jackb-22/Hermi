import { ApiError } from '@itp/shared';
import { MeSchema, OkSchema, PatchMeBody, PushTokenBody } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authed, bearer } from '../plugins/auth.ts';
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
        await users(db).updateOne({ _id: req.userId }, { $set: req.body });
      } catch (e) {
        if (isDupKey(e)) throw new ApiError(409, 'USERNAME_TAKEN', 'Username is taken');
        throw e;
      }
      return toMe(await getUser(db, req.userId), config, clock.now());
    },
  );

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
      return { ok: true as const };
    },
  );
};

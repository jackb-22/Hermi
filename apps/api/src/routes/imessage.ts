import { ApiError } from '@itp/shared';
import { DevImessageLinkBody, ImessageLinkCode, ImessageStatus, OkSchema } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authed, bearer } from '../plugins/auth.ts';
import { devGuard } from '../plugins/devGuard.ts';
import {
  attachHandle,
  maskHandle,
  newLinkCode,
  normalizeHandle,
  smsUrl,
} from '../services/imessage.ts';
import { hit } from '../services/rateLimit.ts';
import { getUser, users } from '../services/users.ts';
import { errs } from './_util.ts';

/** Link a phone to your account so you can text Hermi a plan. */
export const imessageRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, clock, providers, config } = app.ctx;
  const agent = () => providers.messenger.address;

  app.get(
    '/me/imessage',
    {
      ...authed,
      schema: {
        tags: ['me'],
        summary: 'Texting Hermi: linked handles (masked) and the number to text',
        security: bearer,
        response: { 200: ImessageStatus, ...errs(401) },
      },
    },
    async (req) => {
      const me = await getUser(db, req.userId);
      const handles = me.imessageHandles ?? [];
      return {
        linked: handles.length > 0,
        handles: handles.map(maskHandle),
        agentAddress: agent(),
      };
    },
  );

  app.post(
    '/me/imessage/link-code',
    {
      ...authed,
      schema: {
        tags: ['me'],
        summary: 'A code to text to Hermi ("link ABC123"), which links the phone you text from',
        security: bearer,
        response: { 200: ImessageLinkCode, ...errs(401, 429) },
      },
    },
    async (req) => {
      await hit(db, `imlink:${req.userId}`, 10, 3600, clock.now());
      const { code, expiresAt } = await newLinkCode(app.ctx, req.userId);
      return {
        code,
        expiresAt: expiresAt.toISOString(),
        agentAddress: agent(),
        smsUrl: smsUrl(agent(), `link ${code}`),
      };
    },
  );

  app.delete(
    '/me/imessage',
    {
      ...authed,
      schema: {
        tags: ['me'],
        summary: 'Unlink every phone: Hermi stops acting on texts from them',
        security: bearer,
        response: { 200: OkSchema, ...errs(401) },
      },
    },
    async (req) => {
      await users(db).updateOne({ _id: req.userId }, { $unset: { imessageHandles: '' } });
      return { ok: true as const };
    },
  );

  if (config.devRoutes)
    app.post(
      '/dev/imessage/link',
      {
        preHandler: devGuard,
        schema: {
          tags: ['dev'],
          summary: 'Link a handle to a user without texting a code (demo accounts)',
          body: DevImessageLinkBody,
          response: { 200: ImessageStatus },
        },
      },
      async (req) => {
        const handle = normalizeHandle(req.body.handle);
        if (!handle) throw new ApiError(400, 'BAD_REQUEST', 'Not a phone number or email');
        const u = await users(db).findOne({ username: req.body.username });
        if (!u) throw new ApiError(404, 'NOT_FOUND', 'No such user');
        const me = await attachHandle(app.ctx, u._id, handle);
        return {
          linked: true,
          handles: (me.imessageHandles ?? []).map(maskHandle),
          agentAddress: agent(),
        };
      },
    );
};

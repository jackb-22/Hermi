import { TAGS, TASTE_DECK } from '@itp/shared';
import { DeckResponse, TasteBody, TasteResponse } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { buildPrefs } from '../domain/prefs.ts';
import { authed, bearer } from '../plugins/auth.ts';
import { getUser, toMe, users } from '../services/users.ts';
import { errs } from './_util.ts';

export const tasteRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, config, clock } = app.ctx;

  app.get(
    '/onboarding/deck',
    { schema: { tags: ['onboarding'], summary: 'The Taste swipe deck (about 16 cards)', response: { 200: DeckResponse } } },
    async () => ({ cards: TASTE_DECK.map((c) => ({ ...c, requires21: !!c.requires21 })), tags: [...TAGS] }),
  );

  app.post(
    '/me/taste',
    {
      ...authed,
      schema: {
        tags: ['onboarding'],
        summary: 'Save Taste swipes: builds the preference vector and hard-filter dislikes (also used by Retune taste)',
        security: bearer,
        body: TasteBody,
        response: { 200: TasteResponse, ...errs(400, 401) },
      },
    },
    async (req) => {
      const prefs = buildPrefs(req.body.swipes, req.body.is21);
      await users(db).updateOne(
        { _id: req.userId },
        { $set: { prefVector: prefs.prefVector, dislikes: prefs.dislikes, is21: req.body.is21, tasteDone: true } },
      );
      const u = await getUser(db, req.userId);
      return { user: toMe(u, config, clock.now()), likedTags: prefs.likedTags, dislikes: prefs.dislikes };
    },
  );
};

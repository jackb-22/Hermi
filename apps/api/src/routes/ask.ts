import { AskBody, AskResponse } from '@itp/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authed, bearer } from '../plugins/auth.ts';
import { askPlanner } from '../services/planner.ts';
import { assertHost, getPlan, saveAndView } from '../services/plans.ts';
import { hit } from '../services/rateLimit.ts';
import { getUser } from '../services/users.ts';
import { errs } from './_util.ts';

export const askRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, clock } = app.ctx;

  app.post(
    '/plans/:id/ask',
    {
      ...authed,
      schema: {
        tags: ['plans'],
        summary: 'AI button, expanded: a chip or one line of text becomes suggested changes',
        description:
          'Runs through Backboard (per-user memory, Gemini as the model) with plan tools: add_stop, remove_stop, move_stop, ' +
          'set_mode, set_date, plus ask_maps (Grounding with Google Maps). Falls back to Gemini function calling, then to ' +
          'rules for the chips. Best weather day is always picked by code from the 10-day forecast. The result replaces ' +
          'plan.ghostChanges; accept with /plans/:id/changes/apply (all, or ids one at a time). Nothing is applied silently.',
        security: bearer,
        params: z.object({ id: z.string() }),
        body: AskBody,
        response: { 200: AskResponse, ...errs(400, 401, 403, 404, 429) },
      },
    },
    async (req) => {
      const plan = await getPlan(db, req.params.id);
      assertHost(plan, req.userId);
      await hit(db, `ask:${req.userId}`, 30, 3600, clock.now());
      const user = await getUser(db, req.userId);
      const r = await askPlanner(app.ctx, plan, user, req.body);
      plan.ghostChanges = r.changes;
      if (r.threadId) plan.aiThreadId = r.threadId;
      const view = await saveAndView(app.ctx, plan, req.userId);
      return { plan: view, message: r.message, sources: r.sources, via: r.via };
    },
  );
};

import { z } from 'zod';
import { IdSchema } from './common.ts';
import { PlanSchema } from './plans.ts';
import { PostSchema } from './posts.ts';

export const FeedQuery = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export const FeedCard = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('post'), post: PostSchema }),
  z.object({
    kind: z.literal('plan'),
    plan: PlanSchema,
    action: z
      .enum(['join', 'request'])
      .describe('Join on a friend’s plan, Request to join on a matched student’s'),
  }),
  z.object({
    kind: z.literal('end'),
    title: z.string().describe('"You\'re caught up. Go outside."'),
    action: z
      .object({ label: z.string(), type: z.literal('plan_from_saved') })
      .describe('Builds a plan from your saved places nearby (POST /plans/from-saved)'),
  }),
]);

export const FeedResponse = z.object({
  cards: z
    .array(FeedCard)
    .describe('The whole remaining feed for today, in order: it ends on purpose with an end card'),
  unseenLeftToday: z.number().int().describe('Out of 30 unseen posts a day'),
});

export const SeenBody = z.object({
  postIds: z
    .array(IdSchema)
    .min(1)
    .max(50)
    .describe('Posts the user actually viewed (card became visible)'),
});

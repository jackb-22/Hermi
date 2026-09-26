import { z } from 'zod';
import { IdSchema, LatLngSchema } from './common.ts';
import { PlanSchema } from './plans.ts';
import { UserCardSchema } from './social.ts';

export const SocialQuery = z.object({
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/)
    .optional()
    .describe('west,south,east,north; omit for everything'),
});

export const SocialResponse = z.object({
  friendsOut: z
    .array(
      z.object({
        user: UserCardSchema,
        place: z.object({ id: IdSchema, name: z.string(), loc: LatLngSchema }),
        at: z.string(),
        planId: IdSchema.nullable().describe('Their current plan, with Join if it is shared'),
      }),
    )
    .describe(
      'Friends checked in within the last 3 hours: their pixel sprite on the place. Never live location.',
    ),
  friendPlans: z
    .array(z.object({ plan: PlanSchema, action: z.enum(['join', 'joined', 'invited']) }))
    .describe('Friends’ upcoming shared plans: dotted route with a start time'),
  openPlans: z
    .array(z.object({ plan: PlanSchema, action: z.enum(['request', 'requested']) }))
    .describe('Open plans from matched students: the "!" quest-giver marker'),
  refreshAfterS: z.literal(30),
});

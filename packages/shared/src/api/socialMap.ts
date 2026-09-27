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
        active: z
          .boolean()
          .describe(
            'Blink this place: they are there now as far as check-ins tell (checked in within the hour, or it is the latest stop of the outing they are still on). Still never live location.',
          ),
      }),
    )
    .describe(
      'Friends checked in within the last 3 hours, drawn on the place. Never live location.',
    ),
  routes: z
    .array(
      z.object({
        planId: IdSchema,
        name: z.string(),
        host: UserCardSchema,
        status: z.enum(['planned', 'active', 'completed']),
        style: z
          .enum(['dotted', 'solid', 'mixed'])
          .describe(
            'planned: dotted · completed: solid · active (under way): solid through stop doneThrough, dotted after',
          ),
        line: z
          .array(LatLngSchema)
          .describe(
            'The stops in order, to join with straight lines. Completed routes list only the stops they checked in at. Never a GPS trace.',
          ),
        doneThrough: z.number().int().describe('Stops checked in at, counted from the first'),
        startAt: z.string(),
        completedAt: z.string().nullable(),
      }),
    )
    .describe(
      "Friends' plans as lines on the Social map: shared upcoming and under-way plans, and plans they completed in the last 7 days (hidden while they are in ghost mode).",
    ),
  friendPlans: z
    .array(z.object({ plan: PlanSchema, action: z.enum(['join', 'joined', 'invited']) }))
    .describe('Friends’ upcoming shared plans: dotted route with a start time'),
  openPlans: z
    .array(z.object({ plan: PlanSchema, action: z.enum(['request', 'requested']) }))
    .describe('Open plans from matched students: the "!" quest-giver marker'),
  refreshAfterS: z.literal(30),
});

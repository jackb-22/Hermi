import { z } from 'zod';
import { IdSchema, IsoDate, LatLngSchema } from './common.ts';
import { PinTypeSchema, PlaceSchema } from './places.ts';

/** A suggested next stop: dithered pin joined to the last pin by a dotted line labeled with walking minutes. */
export const GhostPinSchema = z
  .object({
    place: PlaceSchema,
    category: PinTypeSchema,
    label: z.string().describe('Six words or fewer, e.g. "Sunset at Pier 45"'),
    walkMin: z.number().int().describe('Label for the dotted line'),
    distanceM: z.number().int(),
    arriveAt: z.string().describe('When you would get there'),
    score: z.number().describe('pref · time · P(c | prev) · (1 + novelty)'),
    factors: z.object({
      pref: z.number(),
      time: z.number(),
      transition: z.number(),
      novelty: z.number().min(0).max(1).describe('Share of unvisited tiles around the venue'),
    }),
  })
  .meta({ id: 'GhostPin' });

export const GhostsResponse = z.object({
  items: z.array(GhostPinSchema).max(3).describe('Up to three, best first'),
  anchor: z.object({
    loc: LatLngSchema,
    placeId: IdSchema.nullable(),
    stopId: IdSchema.nullable().describe('Plan stop the ghosts follow (plan route only)'),
  }),
  at: z.string().describe('Departure time from the anchor used for time(c, t)'),
  sunsetAt: z.string(),
  weather: z.object({ highF: z.number(), precipChance: z.number() }).nullable(),
  rankedBy: z.enum(['gemini', 'code']),
  fadeAfterSec: z.number().int().describe('Ghosts fade after this long or on the next pan'),
});

export const GhostsQuery = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    after: IdSchema.optional().describe(
      'Place id of the last pin; its location and category are the anchor',
    ),
    at: IsoDate.optional().describe('When you leave the last pin; defaults to now'),
    exclude: z
      .string()
      .optional()
      .describe('Comma-separated place ids already pinned, never suggested'),
  })
  .refine((q) => q.after || (q.lat !== undefined && q.lng !== undefined), {
    message: 'Give after (a place id) or lat and lng',
  });

export const PlanGhostsQuery = z.object({
  afterStopId: IdSchema.optional().describe('Defaults to the last stop'),
  lat: z.coerce.number().min(-90).max(90).optional().describe('Anchor for an empty plan'),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export const AcceptGhostBody = z.object({
  placeId: IdSchema,
  afterStopId: IdSchema.optional().describe('Inserted right after this stop; defaults to the end'),
});

export const SkipGhostsBody = z.object({
  placeIds: z.array(IdSchema).min(1).max(10),
  planId: IdSchema.optional(),
});

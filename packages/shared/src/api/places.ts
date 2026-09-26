import { z } from 'zod';
import { PIN_TYPES, TAGS } from '../tags.ts';
import { IdSchema, LatLngSchema } from './common.ts';

export const PinTypeSchema = z.enum(PIN_TYPES);
export const CategoryFilter = z.enum(['all', ...PIN_TYPES]).default('all');

export const PlaceSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    category: PinTypeSchema,
    tags: z.array(z.enum(TAGS)),
    loc: LatLngSchema,
    address: z.string().nullable(),
    been: z.number().int().describe('People with a verified check-in here'),
    wouldGoAgainPct: z
      .number()
      .int()
      .min(0)
      .max(100)
      .nullable()
      .describe('Share of yes on verified reviews; null until reviewed'),
    distanceM: z.number().optional().describe('Present on proximity queries'),
    walkMin: z.number().int().optional().describe('Straight-line walking estimate at 80 m/min'),
    tasteMatch: z
      .number()
      .min(-1)
      .max(1)
      .optional()
      .describe('Cosine of place tags vs your preferences (signed in only)'),
  })
  .meta({ id: 'Place' });

/** "92% would go again · 12 here now · 3 friends have been · 142 been · 12 going this week" */
export const PlaceDetailSchema = PlaceSchema.extend({
  hereNow: z.number().int().describe('Distinct people checked in within the last 60 minutes'),
  friendsBeen: z.number().int().describe('Your friends with any verified check-in here'),
  going: z
    .number()
    .int()
    .describe('People with this place in a saved or joined plan within 7 days'),
  hours: z
    .array(z.object({ day: z.number().int().min(0).max(6), open: z.string(), close: z.string() }))
    .nullable(),
  reviewSummary: z.string().nullable(),
}).meta({ id: 'PlaceDetail' });

export const PlacesBboxQuery = z.object({
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/)
    .describe('west,south,east,north'),
  cat: CategoryFilter,
  limit: z.coerce.number().int().min(1).max(100).default(25).describe('Top places per category'),
});

export const PlacesNearQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  cat: CategoryFilter,
  r: z.coerce
    .number()
    .min(50)
    .max(5000)
    .optional()
    .describe(
      'Search radius in meters: about one third of the visible map short side. Widened in steps to at least 5 results, capped at a 15-minute walk (1200 m).',
    ),
});

export const PlacesResponse = z.object({ items: z.array(PlaceSchema), nextCursor: z.null() });
export const PlacesNearResponse = z.object({
  items: z.array(PlaceSchema),
  nextCursor: z.null(),
  radiusM: z.number().describe('Radius actually searched after widening'),
});

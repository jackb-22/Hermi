import { z } from 'zod';
import { IdSchema, IsoDate, LatLngSchema } from './common.ts';
import { PlanSchema } from './plans.ts';

export const SessionSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(['plan', 'headout']).describe('Started from a plan, or Head out with no plan'),
    planId: IdSchema.nullable(),
    status: z.enum(['active', 'ending', 'ended']),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    pointsAccepted: z.number().int(),
  })
  .meta({ id: 'Session' });

export const GeofenceSchema = z.object({
  stopId: IdSchema,
  placeId: IdSchema,
  name: z.string(),
  center: LatLngSchema,
  radiusM: z.number().describe('Arrival geofence radius (100 m); iOS monitors up to 20 regions'),
});

export const StartSessionBody = z.object({
  planId: IdSchema.optional().describe('Omit for Head out'),
});
export const StartSessionResponse = z.object({
  session: SessionSchema,
  geofences: z.array(GeofenceSchema),
  plan: PlanSchema.nullable(),
});

export const PointsBody = z.object({
  points: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).describe('Horizontal accuracy, meters'),
        speed: z.number().optional().describe('m/s from the OS, if known'),
        time: IsoDate,
      }),
    )
    .min(1)
    .max(500)
    .describe('Batch of background location updates (every ~20 m)'),
});

export const PointsResponse = z.object({
  accepted: z.number().int(),
  rejected: z.object({
    accuracy: z.number().int(),
    jump: z.number().int(),
    order: z.number().int(),
    future: z.number().int(),
  }),
});

export const ActiveSessionResponse = z.object({ session: SessionSchema.nullable() });

export const EndSessionBody = z.object({
  steps: z
    .number()
    .int()
    .min(0)
    .max(200_000)
    .optional()
    .describe('Pedometer steps during the session (expo-sensors)'),
});

export const RecapStopSchema = z.object({
  checkinId: IdSchema,
  placeId: IdSchema,
  placeName: z.string(),
  category: z.string(),
  tier: z.enum(['gps', 'tag']),
  time: z.string(),
  firstVisit: z.boolean(),
  bestMediaId: IdSchema.nullable().describe(
    'Best capture at this stop (clip over photo, latest wins)',
  ),
  mediaIds: z.array(IdSchema),
  reviewed: z.boolean(),
});

export const RecapSchema = z
  .object({
    sessionId: IdSchema,
    planId: IdSchema.nullable(),
    planName: z.string().nullable(),
    startedAt: z.string(),
    endedAt: z.string(),
    durationMin: z.number().int(),
    route: z
      .array(z.object({ lat: z.number(), lng: z.number() }))
      .describe('Thinned route line for the replay'),
    segments: z.array(
      z.object({
        mode: z.enum(['walk', 'bike', 'vehicle', 'subway', 'still']),
        start: z.string(),
        end: z.string(),
        meters: z.number().int(),
      }),
    ),
    newTiles: z
      .array(z.object({ x: z.number().int(), y: z.number().int() }))
      .describe('Zoom-18 tiles that flip from grey to color, in route order'),
    footKm: z.number(),
    totalKm: z.number(),
    steps: z.number().int().nullable(),
    stops: z.array(RecapStopSchema),
    xp: z
      .object({
        total: z.number().int(),
        items: z.array(z.object({ kind: z.string(), xp: z.number().int(), label: z.string() })),
      })
      .describe('Includes check-ins made during the session'),
    planCompleted: z.boolean(),
    fullParty: z.boolean(),
    posted: z.boolean(),
  })
  .meta({ id: 'Recap' });

export const RecapResponse = z.object({
  status: z
    .enum(['pending', 'ready'])
    .describe('pending while the worker builds it; poll every second or two'),
  recap: RecapSchema.nullable(),
});

export const EndSessionResponse = z.object({ session: SessionSchema });

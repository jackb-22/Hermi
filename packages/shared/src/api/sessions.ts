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

export const StartSessionBody = z.object({ planId: IdSchema.optional().describe('Omit for Head out') });
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
  rejected: z.object({ accuracy: z.number().int(), jump: z.number().int(), order: z.number().int(), future: z.number().int() }),
});

export const ActiveSessionResponse = z.object({ session: SessionSchema.nullable() });

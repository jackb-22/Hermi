import { z } from 'zod';
import { ERROR_CODES } from '../errors.ts';

/** Coordinates cross the API boundary as {lat,lng}; GeoJSON stays internal. */
export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const IdSchema = z.string().min(1).max(64);
export const IsoDate = z.iso.datetime({ offset: true });

export const ErrorEnvelope = z
  .object({
    error: z.object({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: 'ErrorEnvelope' });

/** Every list endpoint returns {items, nextCursor}. */
export const Paged = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const OkSchema = z.object({ ok: z.literal(true) });

export const HealthSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  mongo: z.boolean(),
  tiger: z.boolean(),
  time: z.string(),
  providers: z.record(z.string(), z.string()).describe('Which implementation backs each external service (fake/real)'),
});

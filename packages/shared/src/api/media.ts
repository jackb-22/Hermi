import { z } from 'zod';
import { IdSchema, IsoDate, LatLngSchema } from './common.ts';

export const MediaKindSchema = z.enum(['photo', 'video', 'audio']);

export const PresignBody = z.object({
  checkinId: IdSchema.describe('Every capture is tagged with the current check-in'),
  kind: MediaKindSchema.describe('audio = the 3-second ambient clip recorded after a photo'),
  contentType: z.string().regex(/^(image|video|audio)\//),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).describe('SHA-256 of the file bytes, hex, computed on device'),
  bytes: z.number().int().positive().max(80 * 1024 * 1024),
  capturedAt: IsoDate,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  durationS: z.number().max(16).optional().describe('Video (≤15 s) or ambient audio (~3 s)'),
  pairedWith: IdSchema.optional().describe('For an ambient clip: the photo media id it belongs to'),
});

export const MediaSchema = z
  .object({
    id: IdSchema,
    kind: MediaKindSchema,
    status: z.enum(['pending', 'verified', 'rejected']),
    checkinId: IdSchema,
    placeId: IdSchema,
    capturedAt: z.string(),
    at: LatLngSchema,
    sha256: z.string(),
    url: z.string().nullable().describe('Owner-only signed URL of the original; null until uploaded'),
    renditionUrl: z.string().nullable().describe('Public CDN rendition (720p H.264 / resized photo) once processed'),
    posterUrl: z.string().nullable(),
    ambientId: IdSchema.nullable().describe('Paired 3-second ambient clip for a photo'),
    verifyUrl: z.string().describe('Public Verified IRL credential page'),
    rejectReason: z.string().nullable(),
  })
  .meta({ id: 'Media' });

export const PresignResponse = z.object({
  media: MediaSchema,
  upload: z.object({
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()).describe('Send exactly these headers with the PUT'),
    expiresAt: z.string(),
  }),
});

export const MediaListQuery = z.object({ checkinId: IdSchema.optional(), sessionId: IdSchema.optional() });

import { z } from 'zod';
import { IdSchema, IsoDate } from './common.ts';
import { PlaceSchema } from './places.ts';

export const TierSchema = z.enum(['gps', 'tag']);

export const CheckinBody = z
  .object({
    tier: TierSchema,
    placeId: IdSchema.optional().describe('Required for the GPS tier'),
    tagUrl: z.string().optional().describe('Tag tier: the scanned QR / NFC URL, https://<domain>/c/<id>?k=<secret>'),
    tagId: IdSchema.optional().describe('Tag tier alternative to tagUrl'),
    k: z.string().optional().describe('Tag secret, with tagId'),
    sessionId: IdSchema.optional().describe('Active Action-mode session; required for the GPS tier'),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0),
    time: IsoDate.optional().describe('Defaults to server time'),
  })
  .refine((b) => b.tier === 'gps' ? !!b.placeId : !!(b.tagUrl || (b.tagId && b.k)), { message: 'GPS needs placeId; tag needs tagUrl or tagId+k' });

export const XpItemSchema = z.object({ kind: z.string(), xp: z.number().int(), label: z.string() });

export const CheckinSchema = z
  .object({
    id: IdSchema,
    placeId: IdSchema,
    tier: TierSchema,
    time: z.string(),
    attested: z.boolean(),
    sessionId: IdSchema.nullable(),
    planId: IdSchema.nullable(),
  })
  .meta({ id: 'Checkin' });

export const CheckinResponse = z.object({
  checkin: CheckinSchema,
  place: PlaceSchema,
  firstVisit: z.boolean(),
  xp: z.object({ total: z.number().int(), items: z.array(XpItemSchema) }),
  planStop: z.object({ planId: IdSchema, stopId: IdSchema, index: z.number().int() }).nullable().describe('The plan stop this check-in completed'),
  hangouts: z.array(z.object({ friendId: IdSchema, streakWeeks: z.number().int() })).describe('Friends checked in at this venue tag within 30 min'),
});

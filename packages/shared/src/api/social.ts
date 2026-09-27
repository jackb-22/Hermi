import { z } from 'zod';
import { CheckinResponse } from './checkins.ts';
import { IdSchema, IsoDate } from './common.ts';

export const UserCardSchema = z
  .object({
    id: IdSchema,
    name: z.string().nullable(),
    username: z.string().nullable(),
    spriteUrl: z
      .string()
      .nullable()
      .describe('Deprecated, always null: everyone is the same hermit crab, bundled in the app'),
    photoUrl: z.string().nullable(),
    verified: z.boolean(),
    campus: z.string().nullable(),
  })
  .meta({ id: 'UserCard' });

export const StreakSchema = z.object({
  weeks: z.number().int().describe('"12w" — 0 once a week passes with no hangout'),
  lit: z.boolean().describe('Flame lit once this week is logged, grey until then'),
  endsThisWeek: z
    .boolean()
    .describe('Last hangout was last week: the streak ends Sunday without one'),
  hangouts: z.number().int().describe('"38 since March": never resets'),
  since: z.string(),
});

export const TapBody = z
  .object({
    url: z.string().optional().describe('The URL read from the NFC tag or QR code'),
    tagId: IdSchema.optional(),
    k: z.string().optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0),
    time: IsoDate.optional(),
  })
  .refine((b) => !!b.url || !!(b.tagId && b.k), { message: 'url or tagId+k required' });

export const TapResponse = z.object({
  kind: z.enum(['venue', 'personal']),
  status: z
    .enum(['checked_in', 'waiting', 'friends', 'hangout', 'already_today'])
    .describe(
      'waiting: show "Now <name> taps yours" with the 2-minute timer; friends: new friendship; hangout: streak moved',
    ),
  expiresAt: z.string().nullable().describe('End of the 2-minute window while waiting'),
  friend: UserCardSchema.nullable(),
  streak: StreakSchema.nullable(),
  checkin: CheckinResponse.nullable().describe('Venue tags check you in'),
});

export const BindTagBody = z.object({
  url: z.string().describe('The personal sticker handed out at onboarding'),
});

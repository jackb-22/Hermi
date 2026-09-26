import { z } from 'zod';
import { IdSchema, LatLngSchema } from './common.ts';
import { PlaceSchema } from './places.ts';
import { PlanSchema } from './plans.ts';
import { PostSchema } from './posts.ts';
import { ScoreSchema } from './score.ts';
import { StreakSchema, UserCardSchema } from './social.ts';

export const LastCheckinSchema = z
  .object({ placeId: IdSchema, placeName: z.string(), at: z.string() })
  .describe('"Film Forum · 2h" (hidden in ghost mode)');

export const ProfileSchema = z
  .object({
    user: UserCardSchema.extend({
      studentStatus: z.enum(['current', 'alumni']).nullable(),
      gradYear: z.number().int().nullable(),
    }),
    isMe: z.boolean(),
    isFriend: z.boolean(),
    friendCount: z.number().int(),
    streak: StreakSchema.nullable().describe('Your streak with this friend'),
    score: ScoreSchema,
    lastCheckin: LastCheckinSchema.nullable(),
    counts: z.object({
      posts: z.number().int(),
      plans: z.number().int(),
      placesVisited: z.number().int(),
    }),
  })
  .meta({ id: 'Profile' });

export const FriendRowSchema = z.object({
  user: UserCardSchema,
  streak: StreakSchema,
  score: z.number().int(),
  lastCheckin: LastCheckinSchema.nullable(),
});
export const FriendsResponse = z.object({ items: z.array(FriendRowSchema), nextCursor: z.null() });

export const SaveTypeSchema = z.enum(['place', 'post', 'plan']);
export const SaveBody = z.object({
  type: SaveTypeSchema,
  refId: IdSchema,
  folderId: IdSchema.optional().describe(
    'Also add to this folder (the toast offers "Add to folder")',
  ),
});
export const SavedItemSchema = z.object({
  type: SaveTypeSchema,
  refId: IdSchema,
  savedAt: z.string(),
  place: PlaceSchema.nullable(),
  post: PostSchema.nullable(),
  plan: PlanSchema.nullable(),
});
export const SaveResponse = z.object({
  saved: SavedItemSchema,
  copiedPlanId: IdSchema.nullable().describe(
    'Saving someone else’s plan copies it into your plans, ready to start',
  ),
});
export const SavesQuery = z.object({
  type: SaveTypeSchema.optional(),
  folderId: IdSchema.optional(),
});
export const FolderSchema = z.object({
  id: IdSchema,
  name: z.string(),
  count: z.number().int(),
  createdAt: z.string(),
});
export const FolderBody = z.object({ name: z.string().min(1).max(40) });
export const FolderItemBody = z.object({ type: SaveTypeSchema, refId: IdSchema });

export const VerifySchema = z.object({
  sha256: z.string(),
  verified: z.boolean(),
  kind: z.enum(['photo', 'video', 'audio']),
  place: z.object({ name: z.string(), loc: LatLngSchema }),
  capturedAt: z.string(),
  checkin: z.object({ tier: z.enum(['gps', 'tag']), at: z.string(), attested: z.boolean() }),
  capturedInApp: z.literal(true),
  author: z.object({ username: z.string().nullable() }),
  credential: z.object({ c2pa: z.boolean(), manifestUrl: z.string().nullable() }),
});

export const FromSavedBody = z.object({
  lat: z.number(),
  lng: z.number(),
  startAt: z.string().optional(),
});

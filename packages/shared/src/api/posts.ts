import { z } from 'zod';
import { IdSchema, LatLngSchema } from './common.ts';
import { PinTypeSchema } from './places.ts';
import { UserCardSchema } from './social.ts';

export const PostTypeSchema = z.enum(['clip', 'photos', 'review', 'recap']);

export const PostMediaSchema = z.object({
  id: IdSchema,
  kind: z.enum(['photo', 'video']),
  url: z
    .string()
    .describe('Rendition on the CDN once processed, else a signed URL of the original'),
  posterUrl: z.string().nullable(),
  ambientUrl: z
    .string()
    .nullable()
    .describe("The place's own 3-second sound, looped under a photo"),
  verifyUrl: z.string(),
});

export const PostSchema = z
  .object({
    id: IdSchema,
    type: PostTypeSchema,
    status: z
      .enum(['pending', 'live', 'rejected', 'removed'])
      .describe('pending until the safety check passes (a second or two)'),
    author: UserCardSchema,
    place: z
      .object({ id: IdSchema, name: z.string(), category: PinTypeSchema, loc: LatLngSchema })
      .nullable(),
    planId: IdSchema.nullable(),
    media: z.array(PostMediaSchema),
    text: z.string().nullable(),
    again: z.boolean().nullable().describe('Review: "Would go again?"'),
    route: z
      .object({
        line: z.array(LatLngSchema),
        stops: z.array(
          z.object({
            placeId: IdSchema,
            name: z.string(),
            index: z.number().int(),
            loc: LatLngSchema,
          }),
        ),
      })
      .nullable()
      .describe('Recap route card: numbered stops on the pixel map'),
    stamp: z
      .object({ placeName: z.string(), time: z.string(), tier: z.enum(['gps', 'tag']) })
      .describe('Verified IRL stamp: tap for place, time and credential'),
    counts: z
      .object({ been: z.number().int(), going: z.number().int() })
      .describe('"142 been · 12 going this week": the only public numbers'),
    createdAt: z.string(),
  })
  .meta({ id: 'Post' });

export const CreatePostBody = z.object({
  sessionId: IdSchema.optional().describe(
    'Post from a recap (or later from any completed plan in your profile)',
  ),
  mediaIds: z
    .array(IdSchema)
    .max(10)
    .default([])
    .describe(
      'Verified in-app captures; the type follows the selection: one video = Clip, photos = Photos',
    ),
  includeRoute: z
    .boolean()
    .default(false)
    .describe('Route card selected: a Recap post (route + best capture per stop)'),
  caption: z.string().max(280).optional(),
});

export const ReviewBody = z.object({
  checkinId: IdSchema.describe('Reviews need a verified check-in'),
  again: z.boolean(),
  text: z
    .string()
    .max(500)
    .optional()
    .describe('With text it becomes a Review post; a bare yes/no only feeds the place percentage'),
});
export const ReviewResponse = z.object({
  reviewId: IdSchema,
  place: z.object({ id: IdSchema, wouldGoAgainPct: z.number().int().nullable() }),
  post: PostSchema.nullable(),
});

export const ReportBody = z.object({
  postId: IdSchema.optional(),
  userId: IdSchema.optional(),
  reason: z.string().max(300).default(''),
});
export const BlockBody = z.object({ userId: IdSchema });
export const PostsListQuery = z.object({
  authorId: IdSchema.optional(),
  cursor: z.string().optional(),
});

import { z } from 'zod';
import { PIN_TYPES, TAGS } from '../tags.ts';
import { MeSchema } from './auth.ts';

export const TasteCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.enum(PIN_TYPES),
  tags: z.array(z.enum(TAGS)),
  requires21: z.boolean().describe('Only show after the user confirms 21+'),
});

export const DeckResponse = z.object({ cards: z.array(TasteCardSchema), tags: z.array(z.enum(TAGS)).describe('Vector dimension order') });

export const TasteBody = z.object({
  is21: z.boolean().describe('User confirmed 21+ during Taste; gates bars and nightlife'),
  swipes: z
    .array(z.object({ cardId: z.string(), liked: z.boolean() }))
    .min(1)
    .max(64)
    .describe('Right = liked, left = not for me. Retune taste re-sends the whole deck.'),
});

export const TasteResponse = z.object({
  user: MeSchema,
  likedTags: z.array(z.enum(TAGS)),
  dislikes: z.object({ categories: z.array(z.enum(PIN_TYPES)), tags: z.array(z.enum(TAGS)) }),
});

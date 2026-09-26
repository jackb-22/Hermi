import { z } from 'zod';

export const ClockBody = z.object({
  offsetMs: z.number().int().optional().describe('Set the server clock offset'),
  advanceMs: z.number().int().optional().describe('Move the server clock forward (negative: back)'),
  reset: z.boolean().optional(),
});
export const ClockResponse = z.object({ now: z.string(), offsetMs: z.number().int() });

export const DevTagBody = z.object({
  kind: z.enum(['venue', 'personal']),
  placeId: z.string().optional().describe('Venue tags: the place it sits at'),
  bindToMe: z.boolean().default(true).describe('Personal tags: bind to the caller'),
});
export const DevTagResponse = z.object({ tagId: z.string(), url: z.string() });

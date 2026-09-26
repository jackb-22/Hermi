import { z } from 'zod';
import { IdSchema } from './common.ts';
import { UserCardSchema } from './social.ts';

export const ScoreSchema = z
  .object({
    userId: IdSchema,
    score: z.number().int().describe('XP from the last 30 days; goes up and down'),
    delta7d: z.number().int().describe('▲▼ against 7 days ago'),
    sparkline: z
      .array(z.object({ day: z.string(), xp: z.number().int() }))
      .length(30)
      .describe('Oldest first; the leftmost bars expire next'),
    expiring: z
      .object({
        xp: z.number().int(),
        by: z.string().describe('Local date the XP has fully expired by'),
      })
      .describe('"−40 expiring Sunday": XP leaving the window in the next 7 days'),
    ranks: z.object({
      friends: z.object({ rank: z.number().int(), of: z.number().int() }),
      campus: z
        .object({ rank: z.number().int(), of: z.number().int(), campus: z.string() })
        .nullable(),
    }),
  })
  .meta({ id: 'Score' });

export const LeaderboardQuery = z.object({
  scope: z.enum(['friends', 'campus']).default('friends'),
});
export const LeaderboardResponse = z.object({
  scope: z.enum(['friends', 'campus']),
  campus: z.string().nullable(),
  items: z.array(
    z.object({
      rank: z.number().int(),
      user: UserCardSchema,
      score: z.number().int(),
      isMe: z.boolean(),
    }),
  ),
  me: z.object({ rank: z.number().int(), score: z.number().int() }).nullable(),
});

export const BoroughStat = z.object({
  name: z.string(),
  colored: z.number().int(),
  total: z.number().int(),
  pct: z.number(),
});

export const TilesResponse = z.object({
  userId: IdSchema,
  zoom: z.literal(18),
  tiles: z
    .array(z.object({ x: z.number().int(), y: z.number().int() }))
    .describe('Colored zoom-18 tiles; draw 4×4 canvas px per tile under a Bayer-dithered fog'),
  count: z.number().int(),
  bounds: z
    .object({
      minX: z.number().int(),
      minY: z.number().int(),
      maxX: z.number().int(),
      maxY: z.number().int(),
    })
    .nullable(),
  manhattanPct: z.number().describe('"6% of Manhattan colored"'),
  boroughs: z.array(BoroughStat),
});

export const StatsResponse = z.object({
  topPlaces: z.array(
    z.object({
      placeId: IdSchema,
      name: z.string(),
      category: z.string(),
      visits: z.number().int(),
    }),
  ),
  peopleMost: z.array(
    z.object({ user: UserCardSchema, hangouts: z.number().int(), streakWeeks: z.number().int() }),
  ),
  onFoot: z.object({
    monthKm: z.number(),
    allTimeKm: z.number(),
    monthSteps: z.number().int(),
    allTimeSteps: z.number().int(),
  }),
  boroughs: z.array(BoroughStat),
  hoursOut: z.object({ month: z.number(), allTime: z.number() }),
});

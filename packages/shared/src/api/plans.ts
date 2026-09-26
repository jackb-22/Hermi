import { z } from 'zod';
import { PIN_TYPES } from '../tags.ts';
import { IdSchema, IsoDate, LatLngSchema } from './common.ts';
import { PlaceSchema } from './places.ts';

export const ModeSchema = z.enum(['walk', 'transit', 'bike', 'car']);
export const VisibilitySchema = z.enum(['just_me', 'invite', 'friends', 'find']);
export const PlanStatusSchema = z.enum(['draft', 'planned', 'active', 'completed', 'cancelled']);
export const MemberStatusSchema = z.enum(['invited', 'joined', 'declined', 'requested']);

export const SlotSchema = z.object({
  category: z.enum(PIN_TYPES),
  near: LatLngSchema.describe('Where the pin was dropped'),
});

/** A stop is a chosen place, or a slot ("some food, around here") until a place fills it. */
export const StopInput = z
  .object({
    id: IdSchema.optional().describe(
      'Keep the id of an existing stop to preserve its AI stay length',
    ),
    placeId: IdSchema.optional(),
    slot: SlotSchema.optional(),
    legMode: ModeSchema.optional().describe(
      'Mode of the leg arriving at this stop; defaults to the plan mode',
    ),
    stayMin: z
      .number()
      .int()
      .min(5)
      .max(240)
      .optional()
      .describe('User override of the stay length'),
  })
  .refine((s) => !!s.placeId !== !!s.slot, {
    message: 'Each stop needs exactly one of placeId or slot',
  });

export const StopSchema = z
  .object({
    id: IdSchema,
    index: z.number().int().describe('1-based plan number shown on the pin'),
    place: PlaceSchema.nullable(),
    slot: SlotSchema.nullable(),
    label: z.string().describe('Place name, or "Pick a food spot" for an unfilled slot'),
    stayMin: z.number().int(),
    staySource: z.enum(['default', 'ai', 'user']),
    stayReason: z.string().nullable(),
    legMode: ModeSchema.nullable().describe('Null for the first stop'),
    legMin: z.number().int().nullable(),
    legSource: z.enum(['estimate', 'apple', 'google']).nullable(),
    arriveAt: z.string(),
    departAt: z.string(),
    done: z.boolean().describe('Checked in during the plan'),
    checkinId: z.string().nullable(),
  })
  .meta({ id: 'Stop' });

export const IssueSchema = z.object({
  stopId: IdSchema,
  code: z.enum([
    'CLOSES_BEFORE_STAY_ENDS',
    'OPENS_AFTER_ARRIVAL',
    'ENDS_AFTER_END_TIME',
    'UNFILLED_SLOT',
  ]),
  message: z.string(),
});

/** A suggested edit rendered as a ghost: tap to accept, ignore to dismiss. Never applied silently. */
export const GhostChangeSchema = z.object({
  id: z.string(),
  kind: z.enum(['swap', 'move', 'add_stop', 'remove_stop', 'set_mode', 'set_start', 'set_stay']),
  label: z.string().describe('e.g. "Swap 2 and 3 to reach the museum before 5 pm"'),
  fromIndex: z.number().int().optional(),
  toIndex: z.number().int().optional(),
  stop: StopInput.optional(),
  stopId: IdSchema.optional(),
  mode: ModeSchema.optional(),
  startAt: z.string().optional(),
  stayMin: z.number().int().optional(),
  sources: z
    .array(z.object({ title: z.string(), uri: z.string() }))
    .optional()
    .describe('Google Maps source links; must be shown under the text'),
});

export const MemberSchema = z.object({
  userId: IdSchema,
  name: z.string().nullable(),
  username: z.string().nullable(),
  spriteUrl: z.string().nullable(),
  status: MemberStatusSchema,
});

export const PlanSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    hostId: IdSchema,
    isHost: z.boolean(),
    startAt: z.string(),
    endBy: z.string().nullable(),
    mode: ModeSchema,
    visibility: VisibilitySchema,
    status: PlanStatusSchema,
    stops: z.array(StopSchema),
    members: z.array(MemberSchema),
    totals: z.object({
      km: z.number(),
      footKm: z.number(),
      legMin: z.number().int(),
      xpPreview: z.number().int().describe('"+140 XP · 4.2 km on foot"'),
      endsAt: z.string().nullable(),
    }),
    issues: z.array(IssueSchema).describe('Rows to show red'),
    ghostChanges: z.array(GhostChangeSchema),
    shareUrl: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'Plan' });

export const CreatePlanBody = z.object({
  name: z.string().max(80).optional(),
  startAt: IsoDate.optional().describe('Defaults to the next quarter hour'),
  endBy: IsoDate.optional(),
  mode: ModeSchema.default('walk'),
  stops: z.array(StopInput).max(12).default([]),
});

export const PatchPlanBody = z.object({
  name: z.string().min(1).max(80).optional(),
  startAt: IsoDate.optional(),
  endBy: IsoDate.nullable().optional(),
  mode: ModeSchema.optional().describe('Changing the plan mode resets every leg to it'),
});

export const PutStopsBody = z.object({ stops: z.array(StopInput).max(12) });

export const PlansListQuery = z.object({
  scope: z.enum(['upcoming', 'drafts', 'completed', 'all']).default('all'),
  userId: IdSchema.optional().describe('Another user (public plans only); defaults to you'),
});

export const ApplyChangesBody = z.object({
  ids: z.array(z.string()).optional().describe('Ghost change ids; omit to act on all of them'),
});

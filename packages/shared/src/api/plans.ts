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
  legMin: z
    .number()
    .int()
    .optional()
    .describe('set_mode from Space it out: minutes of that leg once applied'),
  legSource: z.enum(['estimate', 'apple', 'google']).optional(),
  sources: z
    .array(z.object({ title: z.string(), uri: z.string() }))
    .optional()
    .describe('Google Maps source links; must be shown under the text'),
});

export const MemberSchema = z.object({
  userId: IdSchema,
  name: z.string().nullable(),
  username: z.string().nullable(),
  spriteUrl: z
    .string()
    .nullable()
    .describe('Deprecated, always null: everyone is the same hermit crab, bundled in the app'),
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
    matchCount: z
      .number()
      .int()
      .nullable()
      .describe('Find someone: verified students matched so far (host only; null otherwise)'),
    shareUrl: z.string(),
    textGroup: z
      .object({
        recipients: z
          .array(z.string())
          .describe("Our iMessage agent's number; add your friends in Messages"),
        body: z
          .string()
          .describe('Prefilled text carrying the plan link the agent binds the thread from'),
        bound: z.boolean().describe('The agent is already in a group thread for this plan'),
      })
      .nullable()
      .describe('Text the group (expo-sms): host only, when the Photon agent is configured'),
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

export const SavePlanBody = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe('Defaults to a name suggested from the stops'),
  visibility: VisibilitySchema.describe(
    'just_me · invite (friends you pick) · friends (every friend can join) · find (matched verified students can request)',
  ),
  inviteeIds: z
    .array(IdSchema)
    .max(20)
    .default([])
    .describe('Friends to invite (push + link); each taps Join or Can’t'),
});
export const InviteBody = z.object({ userIds: z.array(IdSchema).min(1).max(20) });
export const JoinBody = z.object({
  token: z.string().optional().describe('Share-link token, for people invited by link'),
});
export const NameSuggestionResponse = z.object({ name: z.string() });

export const ASK_CHIPS = [
  'add_dinner',
  'rain_proof',
  'best_weather_day',
  'cheaper',
  'space_stops',
  'suggest_activity',
] as const;
export const AskTurn = z.object({
  role: z.enum(['user', 'model']),
  text: z.string().trim().min(1).max(600),
});
export const AskBody = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .optional()
      .describe(
        'Free text, e.g. "somewhere with outdoor seating near stop 2" (Maps answers are English only)',
      ),
    chip: z
      .enum(ASK_CHIPS)
      .optional()
      .describe(
        'Add dinner · Rain-proof it · Best weather day · Make it cheaper · Space it out (transport times) · ' +
          'Add a stop in `category`',
      ),
    category: z
      .enum(PIN_TYPES)
      .optional()
      .describe('Required with chip suggest_activity: the kind of stop to add'),
    history: z
      .array(AskTurn)
      .max(8)
      .optional()
      .describe('Chat only: the earlier turns of this conversation, oldest first'),
  })
  .refine((b) => !!b.prompt !== !!b.chip, { message: 'Send exactly one of prompt or chip' })
  .refine((b) => (b.chip === 'suggest_activity') === !!b.category, {
    message: 'category goes with chip suggest_activity, and only with it',
    path: ['category'],
  })
  .refine((b) => !b.history?.length || !!b.prompt, {
    message: 'history goes with a prompt',
    path: ['history'],
  });

export const AskResponse = z.object({
  plan: PlanSchema.describe('plan.ghostChanges holds the diff: accept all or tap one at a time'),
  message: z.string().describe('One line from the planner'),
  sources: z
    .array(z.object({ title: z.string(), uri: z.string() }))
    .describe('Google Maps source links; must be shown right under message'),
  via: z
    .enum(['backboard', 'gemini', 'code'])
    .describe("Who answered. 'backboard' is retired (v0.25.3) and no longer returned"),
});

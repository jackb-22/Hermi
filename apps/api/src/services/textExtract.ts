import { PIN_TYPES, type PinType, type Tag } from '@itp/shared';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { nyLocal } from '../domain/weatherDay.ts';

/** One outing, as read from texts: ordered stops (a venue's name, or a kind of place), when, how and with whom. */
export const TextPlanSchema = z.object({
  intent: z.enum(['plan', 'none']),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  time: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/)
    .nullable(),
  mode: z.enum(['walk', 'transit', 'bike', 'car']).nullable(),
  stops: z
    .array(
      z.object({
        query: z.string().trim().min(1).max(120),
        kind: z.enum(['named', 'generic']),
        category: z.enum(PIN_TYPES).nullable(),
      }),
    )
    .max(12),
  people: z.array(z.string().trim().min(1).max(60)).max(20),
});
export type TextPlan = z.infer<typeof TextPlanSchema>;
export interface TextLine {
  sender: string;
  text: string;
}

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['plan', 'none'] },
    date: { type: 'string', nullable: true, description: 'YYYY-MM-DD in New York, or null' },
    time: { type: 'string', nullable: true, description: 'HH:MM 24-hour start time, or null' },
    mode: { type: 'string', enum: ['walk', 'transit', 'bike', 'car'], nullable: true },
    stops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The venue name as written, or the kind of place' },
          kind: { type: 'string', enum: ['named', 'generic'] },
          category: { type: 'string', enum: [...PIN_TYPES], nullable: true },
        },
        required: ['query', 'kind', 'category'],
      },
    },
    people: { type: 'array', items: { type: 'string' } },
  },
  required: ['intent', 'date', 'time', 'mode', 'stops', 'people'],
};

const dayName = (d: Date) =>
  d.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

/**
 * Reads the plan out of a DM or a group chat's recent lines. Gemini does the reading (structured output, later
 * corrections win); without a model, or when it fails, a rule parser handles the plain "Sat 2pm: A then B with C".
 */
export async function extractPlan(
  ctx: AppContext,
  lines: TextLine[],
  now: Date,
): Promise<TextPlan> {
  const llm = ctx.providers.llm;
  if (llm.name !== 'fake') {
    try {
      const raw = await llm.json<unknown>(
        `You read iMessages about going out in New York and pull out ONE outing plan for the app Hermi.
Today is ${dayName(now)} (New York). Resolve "Saturday", "tomorrow", "tonight" to dates from today.
Later messages override earlier ones ("actually not X, let's do Y" removes X). Stops are in the order they will be visited.
kind "named" = a specific venue ("Hungarian Pastry Shop", "the Met", "Movement Harlem"); "generic" = a kind of place
("coffee", "dinner somewhere", "a park") with the closest category. people = names or @handles of others to invite,
as written; never the sender, "me", "us", "you", or "Hermi". If the messages hold no outing to plan, intent is "none".
Messages, oldest first:
${lines.map((l) => `[${l.sender}] ${l.text}`).join('\n')}`,
        JSON_SCHEMA,
      );
      const parsed = TextPlanSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      console.warn(`[text-plan] model output rejected: ${parsed.error.issues[0]?.message}`);
    } catch (e) {
      console.warn(`[text-plan] model failed, using rules: ${(e as Error).message}`);
    }
  }
  return parsePlanText(lines.map((l) => l.text).join('\n'), now);
}

/** Kinds of place people name in a text, with the category and tags to look for. */
export const GENERIC: { re: RegExp; category: PinType; tags: Tag[] }[] = [
  { re: /\b(coffee|caf[eé]|espresso|latte)\b/i, category: 'food', tags: ['coffee'] },
  { re: /\b(pizza|slice)\b/i, category: 'food', tags: ['pizza'] },
  { re: /\bramen\b/i, category: 'food', tags: ['ramen'] },
  { re: /\btacos?\b/i, category: 'food', tags: ['tacos'] },
  { re: /\b(dessert|ice cream|gelato)\b/i, category: 'food', tags: ['dessert'] },
  { re: /\b(bakery|pastr(y|ies)|croissants?)\b/i, category: 'food', tags: ['bakery'] },
  { re: /\bbrunch\b/i, category: 'food', tags: ['brunch'] },
  { re: /\b(dinner|lunch|food|eat|bite|breakfast)\b/i, category: 'food', tags: [] },
  { re: /\b(cocktails?)\b/i, category: 'drinks', tags: ['cocktails'] },
  { re: /\b(beers?|brewery)\b/i, category: 'drinks', tags: ['brewery'] },
  { re: /\b(wine)\b/i, category: 'drinks', tags: ['wine_bar'] },
  { re: /\b(drinks?|bar|pub)\b/i, category: 'drinks', tags: [] },
  { re: /\b(park|picnic|garden)\b/i, category: 'nature', tags: ['park'] },
  { re: /\b(waterfront|river|pier)\b/i, category: 'nature', tags: ['waterfront'] },
  { re: /\b(museum)\b/i, category: 'culture', tags: ['museum'] },
  { re: /\b(gallery|art)\b/i, category: 'culture', tags: ['gallery'] },
  { re: /\b(library|books?(tore)?)\b/i, category: 'shopping', tags: ['bookstore'] },
  { re: /\b(thrift|vintage|shopping)\b/i, category: 'shopping', tags: ['thrift'] },
  { re: /\b(climb(ing)?|boulder(ing)?)\b/i, category: 'sports', tags: ['climbing'] },
  { re: /\b(basketball|hoops)\b/i, category: 'sports', tags: ['basketball'] },
  { re: /\b(bowling)\b/i, category: 'sports', tags: ['bowling'] },
  { re: /\b(jazz)\b/i, category: 'music', tags: ['live_jazz'] },
  { re: /\b(karaoke)\b/i, category: 'music', tags: ['karaoke'] },
  { re: /\b(concert|show|live music|gig)\b/i, category: 'music', tags: ['concert'] },
];
export const genericOf = (q: string) => GENERIC.find((g) => g.re.test(q));

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FILLER =
  /^(let'?s|lets|we|i|can|could|should|wanna|want to|gonna|go|get|grab|hit|do|visit|check out|at|to|for|some|a|an|then|and|maybe|after that|after|first|finally)\s+/i;

/** The rule reader: "Sat 2pm: Hungarian Pastry Shop, then climbing at Movement Harlem with ben and @jenny". */
export function parsePlanText(text: string, now: Date): TextPlan {
  let rest = text
    .replace(/\bhermi\b[,:]?/gi, ' ')
    .replace(/[ \t]+/g, ' ') // Line breaks separate a chat's messages: keep them.
    .trim();
  const today = nyLocal(now);
  const addDays = (n: number) => nyLocal(new Date(now.getTime() + n * 86_400_000)).date;

  // When.
  let date: string | null = null;
  let time: string | null = null;
  const lower = rest.toLowerCase();
  if (/\btomorrow\b/.test(lower)) date = addDays(1);
  else if (/\b(today|tonight)\b/.test(lower)) date = today.date;
  else {
    const m = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i.exec(rest);
    if (m) {
      const want = WEEKDAYS.indexOf(m[1]!.toLowerCase());
      const dow = new Date(`${today.date}T12:00:00Z`).getUTCDay();
      date = addDays((want - dow + 7) % 7);
    }
  }
  const t = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(rest);
  if (t) {
    let h = Number(t[1]) % 12;
    if (t[3]!.toLowerCase() === 'pm') h += 12;
    time = `${h}:${t[2] ?? '00'}`;
  } else if (/\bnoon\b/i.test(rest)) time = '12:00';
  else if (/\btonight\b/i.test(rest)) time = '19:00';
  rest = rest
    .replace(/\b(tomorrow|today|tonight|this|next|on|noon)\b/gi, ' ')
    .replace(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/gi, ' ')
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, ' ')
    .replace(/\b(at|on|around|by)\s*(?=[:,-]|$)/gim, ' ');

  // With whom.
  const people: string[] = [];
  const w = /\bwith\s+(.+?)(?=[.!?]|$)/i.exec(rest);
  if (w) {
    for (const p of w[1]!.split(/,|\band\b|&/i).map((s) => s.trim().replace(/^@/, '')))
      if (p && !/^(me|us|you|hermi)$/i.test(p)) people.push(p);
    rest = rest.replace(w[0], ' ');
  }

  // How.
  const mode = /\b(subway|train|transit)\b/i.test(rest)
    ? 'transit'
    : /\b(bike|citi ?bike|cycle)\b/i.test(rest)
      ? 'bike'
      : /\b(drive|car|uber|lyft)\b/i.test(rest)
        ? 'car'
        : null;

  // Where, in order.
  const stops: TextPlan['stops'] = [];
  for (let chunk of rest.split(/\bthen\b|→|->|;|,|\n|\band then\b|:|\.\s/i)) {
    chunk = chunk.trim().replace(/[.!?]+$/, '');
    for (let i = 0; i < 4; i++) chunk = chunk.replace(FILLER, '');
    // "Riverside Park at" once the time is gone; "Riverside Park after?"
    chunk = chunk.replace(/\s+(at|on|around|by|after|afterwards|later|too|maybe)\??$/i, '').trim();
    if (!chunk || chunk.length < 3 || /^(plan|and|ok|okay|yes|sure)$/i.test(chunk)) continue;
    // "climbing at Movement Harlem": the venue is after "at".
    const at = /\bat\s+(.+)$/i.exec(chunk);
    const name = at && /[A-Z]/.test(at[1]!) ? at[1]!.trim() : chunk;
    const g = genericOf(name);
    // A venue name has a capital ("Joe Coffee", "the Met"); lowercase text that isn't a kind of place is chatter.
    const named = /[A-Z]/.test(name.replace(/^(The|A)\s/, ''));
    if (!named && !g) continue;
    stops.push({
      query: name,
      kind: named ? 'named' : 'generic',
      category: named ? null : g!.category,
    });
    if (stops.length === 12) break;
  }
  return { intent: stops.length ? 'plan' : 'none', date, time, mode, stops, people };
}

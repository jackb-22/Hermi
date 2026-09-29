import {
  ApiError,
  fromGeoJSONPoint,
  haversineM,
  type LatLng,
  newId,
  PIN_TYPES,
  type PinType,
  TAGS,
  type Tag,
} from '@itp/shared';
import { ASK_CHIPS } from '@itp/shared/api';
import type { Filter } from 'mongodb';
import type { AppContext } from '../context.ts';
import type { PlaceDoc } from '../db/placeTypes.ts';
import type { UserDoc } from '../db/types.ts';
import { violatesDislikes } from '../domain/taste.ts';
import { bestDay, isOutdoor, nyLocal, nyLocalToUtc, outdoorShare } from '../domain/weatherDay.ts';
import type { ToolSpec } from '../providers/llm.ts';
import { PLANNER_SYSTEM, recentMemories, remember } from './memory.ts';
import { places, WALK_M_PER_MIN } from './places.ts';
import {
  type GhostChangeDoc,
  loadPlaces,
  type PlacesById,
  type PlanDoc,
  recompute,
  toSchedStops,
} from './plans.ts';
import { applyGhostChange } from './scheduler.ts';
import { planSpacing, spacingSummary } from './spacing.ts';

export const CHIPS = ASK_CHIPS;
export type Chip = (typeof CHIPS)[number];
/** Chips code answers on its own (the model at most words the reply). */
type CodeChip = 'best_weather_day' | 'space_stops' | 'suggest_activity';
export interface AskInput {
  prompt?: string;
  chip?: Chip;
  category?: PinType;
  history?: { role: 'user' | 'model'; text: string }[];
}

const CHIP_PROMPTS: Record<Exclude<Chip, CodeChip>, string> = {
  add_dinner:
    'Add dinner: one food stop around dinner time (6 to 8:30 PM) at a sensible point in the plan.',
  rain_proof:
    'Rain-proof it: replace outdoor stops with nearby indoor ones of a similar kind, keeping the plan’s shape.',
  cheaper:
    'Make it cheaper: swap pricey stops (splurge, fine dining, cocktail or rooftop bars) for cheap ones nearby.',
};

const PRICEY: ReadonlySet<Tag> = new Set([
  'splurge',
  'fine_dining',
  'cocktails',
  'rooftop_bar',
  'wine_bar',
]);
const SEARCH_RADIUS_M = 1500;

const nyTime = (d: Date) =>
  d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const PLANNER_TOOLS: ToolSpec[] = [
  {
    name: 'search_places',
    description:
      'Find real places near a stop of the plan. Returns place ids to use with add_stop. Dislikes and places already in the plan are filtered out.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: [...PIN_TYPES] },
        near_index: {
          type: 'integer',
          description: '1-based stop number to search around; defaults to the last stop',
        },
        tags: {
          type: 'array',
          items: { type: 'string', enum: [...TAGS] },
          description: 'Preferred tags, e.g. ["indoor"] or ["cheap"]',
        },
      },
      required: ['category'],
    },
  },
  {
    name: 'add_stop',
    description: 'Insert a place (from search_places) into the plan.',
    parameters: {
      type: 'object',
      properties: {
        placeId: { type: 'string' },
        position: {
          type: 'integer',
          description: '1-based position the new stop takes; defaults to the end',
        },
        why: { type: 'string', description: 'Label shown on the suggestion, under 12 words' },
      },
      required: ['placeId', 'why'],
    },
  },
  {
    name: 'remove_stop',
    description: 'Remove a stop.',
    parameters: {
      type: 'object',
      properties: { index: { type: 'integer' }, why: { type: 'string' } },
      required: ['index', 'why'],
    },
  },
  {
    name: 'move_stop',
    description: 'Move a stop from one 1-based position to another.',
    parameters: {
      type: 'object',
      properties: { from: { type: 'integer' }, to: { type: 'integer' }, why: { type: 'string' } },
      required: ['from', 'to', 'why'],
    },
  },
  {
    name: 'set_mode',
    description: 'Change how you travel: for the whole plan, or only the leg arriving at one stop.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['walk', 'transit', 'bike', 'car'] },
        index: { type: 'integer', description: 'Only the leg into this stop' },
        why: { type: 'string' },
      },
      required: ['mode', 'why'],
    },
  },
  {
    name: 'set_date',
    description: 'Move the plan to another day and/or start time (New York local).',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: {
          type: 'string',
          description: 'HH:MM, 24-hour; keeps the current start time if omitted',
        },
        why: { type: 'string' },
      },
      required: ['date', 'why'],
    },
  },
  {
    name: 'get_forecast',
    description:
      'The 10-day forecast where the plan is, with the day code scores best for this plan.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'ask_maps',
    description:
      'Ask Google Maps about places near a stop, for things local data cannot answer (outdoor seating, open late, vibe). English only.',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string' }, near_index: { type: 'integer' } },
      required: ['question'],
    },
  },
];

/** A working copy of the plan that tool calls edit; every edit is also recorded as a ghost change. */
class PlanEditor {
  changes: GhostChangeDoc[] = [];
  sources: { title: string; uri: string }[] = [];
  private constructor(
    readonly ctx: AppContext,
    readonly user: UserDoc,
    readonly work: PlanDoc,
    private byId: PlacesById,
  ) {}

  static async create(ctx: AppContext, plan: PlanDoc, user: UserDoc) {
    const work = structuredClone(plan);
    work.ghostChanges = [];
    const byId = await loadPlaces(
      ctx.db,
      work.stops.map((s) => s.placeId),
    );
    recompute(work, byId);
    return new PlanEditor(ctx, user, work, byId);
  }

  tagsOf(index: number): Tag[] {
    const p = this.work.stops[index - 1]?.placeId;
    return (p ? this.byId.get(p)?.tags : undefined) ?? [];
  }

  get sched() {
    return toSchedStops(this.work.stops, this.byId);
  }

  state(): string {
    const sched = this.sched;
    return JSON.stringify({
      start: nyTime(this.work.startAt),
      mode: this.work.mode,
      stops: this.work.stops.map((s, i) => {
        const p = s.placeId ? this.byId.get(s.placeId) : undefined;
        return {
          index: i + 1,
          name: sched[i]!.name,
          category: sched[i]!.category,
          tags: p?.tags ?? [],
          outdoor: isOutdoor(sched[i]!.category, p?.tags ?? []),
          arrive: nyTime(s.arriveAt),
          leave: nyTime(s.departAt),
          legMode: i ? s.legMode : null,
        };
      }),
    });
  }

  private stopAt(index: unknown) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 1 || i > this.work.stops.length)
      throw new ApiError(400, 'BAD_REQUEST', `There is no stop ${index}`);
    return i;
  }

  locNear(index?: unknown): LatLng {
    const sched = this.sched;
    if (!sched.length) throw new ApiError(400, 'BAD_REQUEST', 'The plan has no stops yet');
    const i = index === undefined || index === null ? sched.length : this.stopAt(index);
    return sched[i - 1]!.loc;
  }

  async search(a: { category: PinType; near_index?: number; tags?: Tag[] }) {
    if (!PIN_TYPES.includes(a.category))
      throw new ApiError(400, 'BAD_REQUEST', `Unknown category ${a.category}`);
    const at = this.locNear(a.near_index);
    const inPlan = this.work.stops.flatMap((s) => (s.placeId ? [s.placeId] : []));
    const q: Filter<PlaceDoc> = {
      category: a.category,
      _id: { $nin: inPlan },
      loc: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [at.lng, at.lat] },
          $maxDistance: SEARCH_RADIUS_M,
        },
      },
    };
    if (!this.user.is21) q.adultOnly = { $ne: true };
    const found = (await places(this.ctx.db).find(q).limit(40).toArray()).filter(
      (p) => !violatesDislikes(this.user.dislikes, p.category, p.tags),
    );
    const want = new Set(a.tags ?? []);
    const matches = (p: PlaceDoc) => p.tags.filter((t) => want.has(t)).length;
    // Nearest first, then those matching more of the wanted tags (stable sort keeps distance order).
    found.sort((x, y) => matches(y) - matches(x));
    const top = found.slice(0, 8);
    for (const p of top) this.byId.set(p._id, p);
    return top.map((p) => ({
      placeId: p._id,
      name: p.name,
      category: p.category,
      tags: p.tags,
      walkMin: Math.max(1, Math.round(haversineM(at, fromGeoJSONPoint(p.loc)) / WALK_M_PER_MIN)),
    }));
  }

  get places(): PlacesById {
    return this.byId;
  }

  /** Records a change code already built (Space it out) the same way a tool call's change is recorded. */
  async applyPrepared(change: GhostChangeDoc) {
    await applyGhostChange(this.ctx, this.work, change);
    this.byId = await loadPlaces(
      this.ctx.db,
      this.work.stops.map((s) => s.placeId),
    );
    const { issues } = recompute(this.work, this.byId);
    this.changes.push(change);
    return issues;
  }

  private async apply(g: Omit<GhostChangeDoc, 'id' | 'label'>, why: unknown, fallback: string) {
    const label = typeof why === 'string' && why.trim() ? why.trim().slice(0, 90) : fallback;
    const change: GhostChangeDoc = { ...g, id: newId(), label };
    if (this.sources.length) change.sources = [...this.sources];
    await applyGhostChange(this.ctx, this.work, change);
    this.byId = await loadPlaces(
      this.ctx.db,
      this.work.stops.map((s) => s.placeId),
    );
    recompute(this.work, this.byId);
    this.changes.push(change);
    return change;
  }

  async add(a: { placeId: string; position?: number; why?: string }) {
    const p =
      this.byId.get(a.placeId) ??
      (await places(this.ctx.db).findOne({ _id: a.placeId })) ??
      undefined;
    if (!p) throw new ApiError(400, 'BAD_REQUEST', `Unknown place ${a.placeId}; use search_places`);
    if (this.work.stops.some((s) => s.placeId === p._id))
      throw new ApiError(400, 'BAD_REQUEST', `${p.name} is already in the plan`);
    if (this.work.stops.length >= 12)
      throw new ApiError(400, 'BAD_REQUEST', 'A plan has at most 12 stops');
    const n = this.work.stops.length;
    const pos = Math.min(n + 1, Math.max(1, Math.round(Number(a.position ?? n + 1)) || n + 1));
    return this.apply(
      { kind: 'add_stop', stop: { placeId: p._id }, toIndex: pos },
      a.why,
      `Add ${p.name}`,
    );
  }

  async remove(a: { index: number; why?: string }) {
    const i = this.stopAt(a.index);
    const s = this.work.stops[i - 1]!;
    return this.apply(
      { kind: 'remove_stop', stopId: s.id },
      a.why,
      `Remove ${this.sched[i - 1]!.name}`,
    );
  }

  async move(a: { from: number; to: number; why?: string }) {
    const from = this.stopAt(a.from);
    const to = this.stopAt(a.to);
    return this.apply(
      { kind: 'move', fromIndex: from, toIndex: to },
      a.why,
      `Move stop ${from} to ${to}`,
    );
  }

  async setMode(a: { mode: string; index?: number; why?: string }) {
    if (!['walk', 'transit', 'bike', 'car'].includes(a.mode))
      throw new ApiError(400, 'BAD_REQUEST', `Unknown mode ${a.mode}`);
    const mode = a.mode as GhostChangeDoc['mode'];
    const stopId =
      a.index === undefined || a.index === null
        ? undefined
        : this.work.stops[this.stopAt(a.index) - 1]!.id;
    return this.apply({ kind: 'set_mode', mode, stopId }, a.why, `Go by ${a.mode}`);
  }

  async setDate(a: { date: string; time?: string; why?: string }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date))
      throw new ApiError(400, 'BAD_REQUEST', 'date must be YYYY-MM-DD');
    const cur = nyLocal(this.work.startAt);
    const m = /^(\d{1,2}):(\d{2})$/.exec(a.time ?? '');
    const [h, min] = m ? [Number(m[1]), Number(m[2])] : [cur.hour, cur.minute];
    const startAt = nyLocalToUtc(a.date, h, min);
    if (Number.isNaN(startAt.getTime())) throw new ApiError(400, 'BAD_REQUEST', 'Bad date or time');
    if (startAt.getTime() < this.ctx.clock.now().getTime() - 3600_000)
      throw new ApiError(400, 'BAD_REQUEST', 'That time has passed');
    return this.apply(
      { kind: 'set_start', startAt: startAt.toISOString() },
      a.why,
      `Start ${nyTime(startAt)}`,
    );
  }

  async forecast() {
    const loc = this.sched.length ? this.locNear(1) : { lat: 40.7831, lng: -73.9712 };
    const days = await this.ctx.providers.weather.daily(loc);
    const share = outdoorShare(
      this.work.stops.map((s, i) => ({
        category: this.sched[i]!.category,
        tags: (s.placeId ? this.byId.get(s.placeId)?.tags : undefined) ?? [],
      })),
    );
    const best = bestDay(days, share, nyLocal(this.ctx.clock.now()).date);
    return { days, outdoorShare: share, best };
  }

  async maps(a: { question: string; near_index?: number }) {
    const at = this.sched.length ? this.locNear(a.near_index) : { lat: 40.7831, lng: -73.9712 };
    const r = await this.ctx.providers.llm.askMaps(String(a.question ?? ''), at);
    for (const s of r.sources) if (!this.sources.some((x) => x.uri === s.uri)) this.sources.push(s);
    return r;
  }

  /** Runs one tool call for a model; errors go back to the model as text so it can recover. */
  exec = async (name: string, raw: Record<string, unknown> | string): Promise<string> => {
    try {
      const a = (typeof raw === 'string' ? JSON.parse(raw || '{}') : raw) as never;
      switch (name) {
        case 'search_places':
          return JSON.stringify(await this.search(a));
        case 'add_stop':
          await this.add(a);
          return this.state();
        case 'remove_stop':
          await this.remove(a);
          return this.state();
        case 'move_stop':
          await this.move(a);
          return this.state();
        case 'set_mode':
          await this.setMode(a);
          return this.state();
        case 'set_date':
          await this.setDate(a);
          return this.state();
        case 'get_forecast': {
          const f = await this.forecast();
          return JSON.stringify({
            ...f,
            best: f.best && { date: f.best.day.date, score: f.best.score },
          });
        }
        case 'ask_maps': {
          const r = await this.maps(a);
          return JSON.stringify({ answer: r.text, sources: r.sources.map((s) => s.title) });
        }
        default:
          return `error: unknown tool ${name}`;
      }
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  };
}

export interface AskResult {
  changes: GhostChangeDoc[];
  message: string;
  sources: { title: string; uri: string }[];
  via: 'gemini' | 'code';
}

/** Best weather day: code scores the days and picks one; Gemini only writes the one-line why. */
async function bestWeatherDay(ctx: AppContext, ed: PlanEditor): Promise<AskResult> {
  const via = ctx.providers.llm.name === 'fake' ? 'code' : 'gemini';
  const { best, outdoorShare: share } = await ed.forecast();
  if (!best)
    return { changes: [], message: 'No forecast is available right now.', sources: [], via };
  const d = best.day;
  const weekday = new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  const facts = `${Math.round(d.precipChance * 100)}% rain, ${Math.round(d.highF)}°F, wind ${Math.round(d.windMph)} mph`;
  if (d.date === nyLocal(ed.work.startAt).date)
    return {
      changes: [],
      message: `Your day is already the best one: ${facts}.`,
      sources: [],
      via,
    };
  await ed.setDate({ date: d.date, why: `Move to ${weekday}: ${facts}` });
  let message = `${weekday} looks best for this plan: ${facts}.`;
  try {
    const r = await ctx.providers.llm.json<{ why: string }>(
      `In one short friendly sentence (under 20 words), say why ${weekday} is the best day for a New York outing that is ${Math.round(share * 100)}% outdoors. Forecast that day: ${facts}.`,
      { type: 'object', properties: { why: { type: 'string' } }, required: ['why'] },
    );
    if (r.why?.trim()) message = r.why.trim().slice(0, 200);
  } catch {
    // The template above stands.
  }
  return { changes: ed.changes, message, sources: [], via };
}

/** Space it out: real ETAs and a mode per leg, so arrivals follow departures plus travel. Code only. */
async function spaceStops(ctx: AppContext, ed: PlanEditor): Promise<AskResult> {
  if (ed.work.stops.length < 2)
    return {
      changes: [],
      message: 'Add a second stop, then I can space them out.',
      sources: [],
      via: 'code',
    };
  const { changes, legs } = await planSpacing(ctx, ed.work, ed.places);
  let issues: Awaited<ReturnType<PlanEditor['applyPrepared']>> = [];
  for (const c of changes) issues = await ed.applyPrepared(c);
  const summary = spacingSummary(ed.work, legs);
  const warn = issues.length ? ` Heads up: ${issues[0]!.message}` : '';
  return {
    changes: ed.changes,
    message: changes.length
      ? `Spaced with travel times: ${summary}.${warn}`
      : `Already spaced right: ${summary}.${warn}`,
    sources: [],
    via: 'code',
  };
}

/** Chips without a model: the same edits, chosen by rules. */
async function codeChip(ed: PlanEditor, chip: Exclude<Chip, CodeChip>): Promise<string> {
  const sched = () => ed.sched;
  if (!ed.work.stops.length) return 'Add a stop first, then ask again.';
  const replace = async (i: number, alt: { placeId: string; name: string }, why: string) => {
    await ed.remove({ index: i, why });
    await ed.add({ placeId: alt.placeId, position: i, why: `Add ${alt.name} instead` });
  };
  switch (chip) {
    case 'add_dinner': {
      // After the stop you leave closest to 7 PM.
      const dist = (d: Date) => {
        const l = nyLocal(d);
        return Math.abs(l.hour * 60 + l.minute - 19 * 60);
      };
      let best = 0;
      ed.work.stops.forEach((s, i) => {
        if (dist(s.departAt) < dist(ed.work.stops[best]!.departAt)) best = i;
      });
      const found = await ed.search({ category: 'food', near_index: best + 1 });
      const pick =
        found.find(
          (p) => !p.tags.some((t) => ['coffee', 'bakery', 'dessert', 'brunch'].includes(t)),
        ) ?? found[0];
      if (!pick) return 'I could not find a dinner spot nearby.';
      await ed.add({ placeId: pick.placeId, position: best + 2, why: `Dinner at ${pick.name}` });
      return `Added dinner at ${pick.name}, ${pick.walkMin} min from stop ${best + 1}.`;
    }
    case 'rain_proof':
    case 'cheaper': {
      const ids = ed.work.stops.map((s) => s.id);
      let n = 0;
      for (const id of ids) {
        const i = ed.work.stops.findIndex((s) => s.id === id) + 1;
        const s = sched()[i - 1]!;
        const tags = ed.tagsOf(i);
        if (chip === 'rain_proof' && !isOutdoor(s.category, tags)) continue;
        if (chip === 'cheaper' && !tags.some((t) => PRICEY.has(t))) continue;
        const category = chip === 'rain_proof' && s.category === 'nature' ? 'culture' : s.category;
        const found = await ed.search({
          category,
          near_index: i,
          tags: chip === 'rain_proof' ? ['indoor', 'museum', 'gallery'] : ['cheap'],
        });
        const alt =
          chip === 'rain_proof'
            ? found.find((f) => !isOutdoor(f.category, f.tags))
            : found.find((f) => f.tags.includes('cheap') && !f.tags.some((t) => PRICEY.has(t)));
        if (alt) {
          await replace(
            i,
            alt,
            chip === 'rain_proof' ? `Swap ${s.name}: it's outdoors` : `Swap ${s.name}: pricey`,
          );
          n++;
        } else if (chip === 'rain_proof') {
          await ed.remove({ index: i, why: `Drop ${s.name}: outdoors, no indoor swap nearby` });
          n++;
        }
      }
      if (!n)
        return chip === 'rain_proof'
          ? 'Nothing here is outdoors; you are rain-proof.'
          : 'Nothing here is pricey.';
      return chip === 'rain_proof'
        ? `Moved ${n} outdoor stop${n > 1 ? 's' : ''} indoors.`
        : `Swapped ${n} pricey stop${n > 1 ? 's' : ''} for cheaper ones.`;
    }
  }
}

const PREFERENCE =
  /\b(no|not|never|don'?t|hate|avoid|prefer|love|always|allergic|vegetarian|vegan)\b/i;

/**
 * AI button, expanded: a chip or free text becomes a diff of ghost changes on the plan.
 * Gemini function calling over plan tools → rules for chips.
 */
export async function askPlanner(
  ctx: AppContext,
  plan: PlanDoc,
  user: UserDoc,
  body: AskInput,
): Promise<AskResult> {
  const { providers } = ctx;
  if (body.chip === 'best_weather_day')
    return bestWeatherDay(ctx, await PlanEditor.create(ctx, plan, user));
  if (body.chip === 'space_stops') return spaceStops(ctx, await PlanEditor.create(ctx, plan, user));
  if (body.chip === 'suggest_activity')
    return { changes: [], message: 'Not available yet.', sources: [], via: 'code' };

  const request = body.chip ? CHIP_PROMPTS[body.chip] : body.prompt!;
  const content = (ed: PlanEditor) =>
    `${request}\n\nIt is now ${nyTime(ctx.clock.now())} in New York.\nCurrent plan: ${ed.state()}`;
  const finish = (ed: PlanEditor, text: string, via: AskResult['via']): AskResult => ({
    changes: ed.changes,
    message:
      text.trim() ||
      (ed.changes.length ? 'Here are my suggestions.' : 'I have no changes to suggest.'),
    sources: ed.sources,
    via,
  });

  if (providers.llm.name !== 'fake') {
    const ed = await PlanEditor.create(ctx, plan, user);
    try {
      const mem = await recentMemories(ctx.db, user._id);
      const system = mem.length
        ? `${PLANNER_SYSTEM}\nWhat you remember about this person:\n${mem.map((m) => `- ${m}`).join('\n')}`
        : PLANNER_SYSTEM;
      const text = await providers.llm.runTools({
        system,
        prompt: content(ed),
        tools: PLANNER_TOOLS,
        exec: ed.exec,
      });
      // Keep what sounds like a lasting preference for the next ask.
      if (body.prompt && PREFERENCE.test(body.prompt))
        await remember(ctx, user._id, `Told the planner: "${body.prompt.slice(0, 200)}"`, 'ask');
      return finish(ed, text, 'gemini');
    } catch (e) {
      console.warn(`[planner] gemini failed, falling back to rules: ${(e as Error).message}`);
    }
  }

  const ed = await PlanEditor.create(ctx, plan, user);
  if (!body.chip)
    return finish(ed, 'The AI planner is offline right now; the chips still work.', 'code');
  try {
    return finish(ed, await codeChip(ed, body.chip), 'code');
  } catch (e) {
    return finish(ed, (e as Error).message, 'code');
  }
}

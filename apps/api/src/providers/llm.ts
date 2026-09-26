import { GoogleGenAI } from '@google/genai';
import { DEFAULT_STAY_MIN, type PinType } from '@itp/shared';
import type { Config } from '../config.ts';
import { clampStay } from '../domain/schedule.ts';

export interface StayInput {
  id: string;
  name: string;
  category: PinType;
  /** Local arrival time, e.g. "Sat 7:30 PM". */
  arrival: string;
}

export interface StayEstimate {
  id: string;
  stayMin: number;
  reason: string;
}

export interface GhostCandidate {
  id: string;
  name: string;
  category: PinType;
  tags: string[];
  walkMin: number;
  /** Code's label, used when the model gives none. */
  fallbackLabel: string;
}

export interface ModerationResult {
  allowed: boolean;
  reason: string;
}

/** The model proposes; code computes. Every method has a deterministic fallback so the app never waits on AI. */
export interface Llm {
  readonly name: string;
  stayLengths(
    stops: StayInput[],
    ctx: { pace?: 'relaxed' | 'normal' | 'brisk'; notes?: string },
  ): Promise<StayEstimate[]>;
  /** Six words or fewer, e.g. "Sunset at Pier 45". */
  label(o: { placeName: string; category: PinType; context: string }): Promise<string>;
  planName(stopNames: string[]): Promise<string>;
  /**
   * Re-ranks code's top candidates with context (weather, sunset, the plan so far) and labels each in six words
   * or fewer. Returns candidate ids only: unknown ids are dropped and missing ones keep code's order.
   */
  rerankGhosts(cands: GhostCandidate[], context: string): Promise<{ id: string; label: string }[]>;
  moderate(o: {
    text?: string;
    images?: { mimeType: string; data: Buffer }[];
  }): Promise<ModerationResult>;
  /** Structured call with a JSON schema; used by features that need custom output. */
  json<T>(prompt: string, schema: object): Promise<T>;
}

const sixWords = (s: string) => s.replace(/["\n]/g, ' ').trim().split(/\s+/).slice(0, 6).join(' ');

export class FakeLlm implements Llm {
  readonly name = 'fake';
  async stayLengths(stops: StayInput[], _ctx: { pace?: string; notes?: string } = {}) {
    return stops.map((s) => ({
      id: s.id,
      stayMin: DEFAULT_STAY_MIN[s.category],
      reason: `Typical ${s.category} visit`,
    }));
  }
  async label(o: { placeName: string; category: PinType; context?: string }) {
    return sixWords(`${o.placeName} next`);
  }
  async planName(names: string[]) {
    return names.length
      ? sixWords(names.length > 1 ? `${names[0]} and more` : names[0]!)
      : 'New plan';
  }
  async rerankGhosts(cands: GhostCandidate[]) {
    return cands.map((c) => ({ id: c.id, label: c.fallbackLabel }));
  }
  async moderate(o: { text?: string }) {
    const bad = /\b(kill yourself|nazi)\b/i.test(o.text ?? '');
    return { allowed: !bad, reason: bad ? 'fake filter' : 'ok' };
  }
  async json<T>(): Promise<T> {
    throw new Error('fake llm has no free-form json');
  }
}

export class GeminiLlm implements Llm {
  readonly name = 'gemini';
  readonly ai: GoogleGenAI;
  constructor(
    key: string,
    readonly model: string,
    private fallback = new FakeLlm(),
  ) {
    this.ai = new GoogleGenAI({ apiKey: key });
  }

  async json<T>(prompt: string, schema: object, parts: object[] = []): Promise<T> {
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: prompt }, ...parts] }],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        temperature: 0.3,
      },
    });
    return JSON.parse(res.text ?? 'null') as T;
  }

  async stayLengths(stops: StayInput[], ctx: { pace?: string; notes?: string }) {
    try {
      const out = await this.json<{ stops: StayEstimate[] }>(
        `Estimate how long a person typically stays at each stop of a city outing in New York. Pace: ${ctx.pace ?? 'normal'}. ${ctx.notes ?? ''}
Return minutes between 5 and 240 and a reason of at most 10 words. Stops:
${stops.map((s) => `- id=${s.id} "${s.name}" (${s.category}) arriving ${s.arrival}`).join('\n')}`,
        {
          type: 'object',
          properties: {
            stops: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  stayMin: { type: 'integer' },
                  reason: { type: 'string' },
                },
                required: ['id', 'stayMin', 'reason'],
              },
            },
          },
          required: ['stops'],
        },
      );
      const byId = new Map(out.stops.map((s) => [s.id, s]));
      // Code checks the model: unknown ids ignored, missing ones fall back, values clamped.
      const fb = await this.fallback.stayLengths(stops);
      return stops.map((s, i) => {
        const e = byId.get(s.id);
        return e
          ? { id: s.id, stayMin: clampStay(e.stayMin), reason: e.reason.slice(0, 120) }
          : fb[i]!;
      });
    } catch (e) {
      console.warn(`[gemini] stayLengths failed: ${(e as Error).message}`);
      return this.fallback.stayLengths(stops);
    }
  }

  async label(o: { placeName: string; category: PinType; context: string }) {
    try {
      const out = await this.json<{ label: string }>(
        `Write a label of six words or fewer suggesting this next stop on a city outing. Place: "${o.placeName}" (${o.category}). Context: ${o.context}. Example: "Sunset at Pier 45".`,
        { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
      );
      return sixWords(out.label);
    } catch {
      return this.fallback.label(o);
    }
  }

  async planName(names: string[]) {
    try {
      const out = await this.json<{ name: string }>(
        `Name this outing in four words or fewer, playful but plain. Stops: ${names.join(', ')}.`,
        { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      );
      return sixWords(out.name);
    } catch {
      return this.fallback.planName(names);
    }
  }

  async rerankGhosts(cands: GhostCandidate[], context: string) {
    try {
      const out = await this.json<{ picks: { id: string; label: string }[] }>(
        `You suggest the next stop of a city outing in New York. Re-rank these candidates, best first, for this moment and
write each a label of six words or fewer, like "Sunset at Pier 45". Only use the given ids.
Context: ${context}
Candidates:
${cands.map((c) => `- id=${c.id} "${c.name}" (${c.category}; ${c.tags.join(', ') || 'no tags'}) ${c.walkMin} min walk`).join('\n')}`,
        {
          type: 'object',
          properties: {
            picks: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'string' }, label: { type: 'string' } },
                required: ['id', 'label'],
              },
            },
          },
          required: ['picks'],
        },
      );
      return mergeRerank(cands, out.picks);
    } catch (e) {
      console.warn(`[gemini] rerankGhosts failed: ${(e as Error).message}`);
      return this.fallback.rerankGhosts(cands);
    }
  }

  async moderate(o: { text?: string; images?: { mimeType: string; data: Buffer }[] }) {
    try {
      const parts = (o.images ?? []).map((i) => ({
        inlineData: { mimeType: i.mimeType, data: i.data.toString('base64') },
      }));
      return await this.json<ModerationResult>(
        `You moderate a social app where people post photos, short clips and reviews from places they visited. Decide if this content is allowed.
Disallow: sexual content, graphic violence, hate or harassment, doxxing, illegal activity, self-harm. Allow ordinary nightlife, food, crowds and mild language.
Text: ${JSON.stringify(o.text ?? '')}`,
        {
          type: 'object',
          properties: { allowed: { type: 'boolean' }, reason: { type: 'string' } },
          required: ['allowed', 'reason'],
        },
        parts,
      );
    } catch (e) {
      // Fail open for the demo, but say so in the reason so it is visible in logs and the review queue.
      return { allowed: true, reason: `moderation unavailable: ${(e as Error).message}` };
    }
  }
}

/** Code checks the model: only known ids, each once, then any it left out in code's order; labels trimmed. */
export function mergeRerank(
  cands: GhostCandidate[],
  picks: { id: string; label: string }[],
): { id: string; label: string }[] {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const out = new Map<string, string>();
  for (const p of picks) {
    const c = byId.get(p.id);
    if (c && !out.has(p.id)) out.set(p.id, sixWords(p.label ?? '') || c.fallbackLabel);
  }
  for (const c of cands) if (!out.has(c.id)) out.set(c.id, c.fallbackLabel);
  return [...out].map(([id, label]) => ({ id, label }));
}

export function createLlm(c: Config): Llm {
  return c.GEMINI_API_KEY ? new GeminiLlm(c.GEMINI_API_KEY, c.GEMINI_MODEL) : new FakeLlm();
}

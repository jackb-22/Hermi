import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GeminiLlm } from '../src/providers/llm.ts';
import { PLANNER_TOOLS } from '../src/services/planner.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

type Part = {
  text?: string;
  functionCall?: unknown;
  functionResponse?: { name: string; response: { output: string } };
};
type Content = { role: string; parts: Part[] };
type Call = { contents: Content[]; config: { systemInstruction?: string; tools?: unknown[] } };
/** One scripted model turn: a function call, or text. It sees everything sent so far. */
type Turn = (
  contents: Content[],
) => { call: { name: string; args: Record<string, unknown> } } | { text: string };

/** A real GeminiLlm whose SDK call follows a script, so the whole tool loop runs without the network. */
function scriptedGemini(script: Turn[]) {
  const llm = new GeminiLlm('k', 'main-model');
  const calls: Call[] = [];
  let n = 0;
  (llm.ai.models as unknown as { generateContent: unknown }).generateContent = async (p: Call) => {
    calls.push(
      structuredClone({
        contents: p.contents,
        config: { ...p.config, abortSignal: undefined },
      }) as Call,
    );
    const turn = script[n++];
    if (!turn) return { text: 'Done.' };
    const out = turn(p.contents);
    if ('text' in out) return { text: out.text, functionCalls: [] };
    const functionCall = { id: `c${n}`, ...out.call };
    return {
      functionCalls: [functionCall],
      candidates: [{ content: { role: 'model', parts: [{ functionCall }] } }],
    };
  };
  return { llm, calls };
}
const lastOutput = (contents: Content[]) =>
  contents.at(-1)!.parts.find((p) => p.functionResponse)!.functionResponse!.response.output;

describe('AI chat: POST /plans/:id/ask {prompt, history}', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let u: Awaited<ReturnType<typeof devLogin>>;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    t = await setupTestApp();
    const docs = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Cafe', category: 'food', at: ORIGIN }),
      placeDoc({ name: 'Pier', category: 'nature', at: offset(ORIGIN, 1500, 0) }),
      placeDoc({ name: 'Midway Hall', category: 'music', at: offset(ORIGIN, 700, 0) }),
    ]);
    for (const d of docs) id[d.name] = d._id;
    await t.ctx.db.collection('places').updateOne(
      { _id: id.Cafe as never },
      {
        $set: {
          address: '2900 Broadway',
          hours: [{ day: 6, open: '08:00', close: '18:00' }],
          reviewSummary: { text: 'Quiet mornings, great croissants.', count: 4, at: new Date() },
        },
      },
    );
    u = await devLogin(t.app, 'chatter');
  });
  afterAll(() => t.teardown());

  const plan = async () =>
    (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: {
          startAt: new Date(t.ctx.clock.now().getTime() + 86_400_000).toISOString(),
          stops: [{ placeId: id.Cafe }, { placeId: id.Pier }],
        },
      })
    ).json();
  const chat = (planId: string, payload: object) =>
    t.app.inject({ method: 'POST', url: `/v1/plans/${planId}/ask`, headers: u.headers, payload });
  const using = (script: Turn[]) => {
    const s = scriptedGemini(script);
    t.ctx.providers.llm = s.llm;
    return s;
  };

  test('history goes first, oldest first; the new prompt carries the current plan', async () => {
    const p = await plan();
    const { calls } = using([() => ({ text: 'Stop 2 is the Pier.' })]);
    const r = await chat(p.id, {
      prompt: 'and what is stop 2?',
      history: [
        { role: 'user', text: 'what is stop 1?' },
        { role: 'model', text: 'The Cafe.' },
      ],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ via: 'gemini', message: 'Stop 2 is the Pier.' });
    const sent = calls[0]!.contents;
    expect(sent.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(sent[0]!.parts[0]!.text).toBe('what is stop 1?');
    expect(sent[2]!.parts[0]!.text).toMatch(
      /^Request: <<<and what is stop 2\?>>>[\s\S]*Current plan: .*"name":"Pier"[\s\S]*otherwise reply exactly: I can only help/,
    );
    expect(calls[0]!.config.systemInstruction).toMatch(/only help with this one outing plan/);
  });

  test('search then add: the edit is a ghost change, not applied', async () => {
    const p = await plan();
    using([
      () => ({ call: { name: 'search_places', args: { category: 'music', near_index: 1 } } }),
      (c) => {
        const [first] = JSON.parse(lastOutput(c)) as { placeId: string }[];
        return {
          call: {
            name: 'add_stop',
            args: { placeId: first!.placeId, position: 2, why: 'Live music on the way' },
          },
        };
      },
      () => ({ text: 'Added Midway Hall between your stops.' }),
    ]);
    const body = (await chat(p.id, { prompt: 'add some music between them' })).json();
    expect(body.message).toBe('Added Midway Hall between your stops.');
    expect(body.plan.ghostChanges).toEqual([
      expect.objectContaining({
        kind: 'add_stop',
        toIndex: 2,
        label: 'Live music on the way',
        stop: { placeId: id['Midway Hall'] },
      }),
    ]);
    expect(body.plan.stops).toHaveLength(2);
  });

  test('an invented place id is refused back to the model, and nothing changes', async () => {
    const p = await plan();
    let told = '';
    using([
      () => ({ call: { name: 'add_stop', args: { placeId: 'the-met', why: 'Art' } } }),
      (c) => {
        told = lastOutput(c);
        return { text: 'I could not find that place.' };
      },
    ]);
    const body = (await chat(p.id, { prompt: 'add the Met' })).json();
    expect(told).toMatch(/^error: Unknown place the-met; use search_places/);
    expect(body.plan.ghostChanges).toEqual([]);
  });

  test('questions are answered from place_details without changing the plan', async () => {
    const p = await plan();
    let facts = '';
    using([
      () => ({ call: { name: 'place_details', args: { index: 1 } } }),
      (c) => {
        facts = lastOutput(c);
        return { text: 'The Cafe opens at 8 on Saturdays.' };
      },
    ]);
    const body = (await chat(p.id, { prompt: 'when does the cafe open?' })).json();
    expect(JSON.parse(facts)).toMatchObject({
      name: 'Cafe',
      address: '2900 Broadway',
      hours: ['Sat 08:00–18:00'],
      reviews: 'Quiet mornings, great croissants.',
    });
    expect(body.plan.ghostChanges).toEqual([]);
  });

  test('off-topic: a text answer and no changes', async () => {
    const p = await plan();
    using([() => ({ text: 'I can only help with this plan.' })]);
    const body = (await chat(p.id, { prompt: 'write my essay on Kant' })).json();
    expect(body).toMatchObject({ message: 'I can only help with this plan.', via: 'gemini' });
    expect(body.plan.ghostChanges).toEqual([]);
  });

  test('the model gets plan tools only: nothing that invites, shares, saves or messages', () => {
    expect(PLANNER_TOOLS.map((t) => t.name)).toEqual([
      'search_places',
      'add_stop',
      'remove_stop',
      'move_stop',
      'set_mode',
      'set_date',
      'get_forecast',
      'get_plan',
      'place_details',
      'ask_maps',
    ]);
  });
});

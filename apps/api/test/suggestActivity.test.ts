import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { FakeLlm } from '../src/providers/llm.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

/** A model whose pick the test controls. */
class PickLlm extends FakeLlm {
  override readonly name = 'stub' as 'fake';
  answer: { id: string; why: string } | Error = new Error('unset');
  prompts: string[] = [];
  override async json<T>(prompt: string): Promise<T> {
    this.prompts.push(prompt);
    if (this.answer instanceof Error) throw this.answer;
    return this.answer as T;
  }
}

describe('POST /plans/:id/ask {chip: suggest_activity}', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let u: Awaited<ReturnType<typeof devLogin>>;
  const id: Record<string, string> = {};
  const llm = new PickLlm();

  beforeAll(async () => {
    t = await setupTestApp();
    const docs = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Cafe', category: 'food', at: ORIGIN }),
      placeDoc({ name: 'Pier', category: 'nature', at: offset(ORIGIN, 2000, 0) }),
      // On the way from the Cafe to the Pier: no detour.
      placeDoc({ name: 'Midway Hall', category: 'music', at: offset(ORIGIN, 1000, 0) }),
      // Off to the side of the Cafe, and more popular: popularity alone would pick it.
      placeDoc({ name: 'Side Club', category: 'music', at: offset(ORIGIN, 0, 700), been: 50 }),
      placeDoc({ name: 'Jazz Cellar', category: 'music', at: offset(ORIGIN, 1900, 50) }),
    ]);
    for (const d of docs) id[d.name] = d._id;
    u = await devLogin(t.app, 'suggester');
  });
  afterAll(() => t.teardown());

  const plan = async (names: string[]) =>
    (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: {
          startAt: new Date(t.ctx.clock.now().getTime() + 86_400_000).toISOString(),
          stops: names.map((n) => ({ placeId: id[n] })),
        },
      })
    ).json();
  const ask = (planId: string, category: string) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/plans/${planId}/ask`,
      headers: u.headers,
      payload: { chip: 'suggest_activity', category },
    });

  test('without a model: the least-detour place of that category, inserted where it fits', async () => {
    const p = await plan(['Cafe', 'Pier']);
    const r = await ask(p.id, 'music');
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.via).toBe('code');
    expect(body.plan.ghostChanges).toEqual([
      expect.objectContaining({
        kind: 'add_stop',
        toIndex: 2,
        stop: { placeId: id['Midway Hall'] },
      }),
    ]);
    expect(body.message).toBe('Midway Hall fits after Cafe, right on your route.');
    // Only a suggestion until applied.
    expect(body.plan.stops).toHaveLength(2);
  });

  test('the model picks among code’s candidates and its reason is the reply', async () => {
    Object.assign(t.ctx.providers, { llm });
    try {
      llm.answer = { id: id['Jazz Cellar']!, why: 'Live jazz right by the pier at sunset.' };
      const p = await plan(['Cafe', 'Pier']);
      const body = (await ask(p.id, 'music')).json();
      expect(body.via).toBe('gemini');
      expect(body.message).toBe('Live jazz right by the pier at sunset.');
      expect(body.plan.ghostChanges[0].stop.placeId).toBe(id['Jazz Cellar']);
      // Candidates are what code found (never the plan's own stops).
      const candidates = llm.prompts.at(-1)!.split('Candidates')[1]!;
      expect(candidates).toContain('Midway Hall');
      expect(candidates).not.toMatch(/"name":"(Cafe|Pier)"/);
    } finally {
      Object.assign(t.ctx.providers, { llm: new FakeLlm() });
    }
  });

  test('an id the model invents (or a model error) falls back to code’s first choice', async () => {
    Object.assign(t.ctx.providers, { llm });
    try {
      llm.answer = { id: 'made-up', why: 'Trust me' };
      const p = await plan(['Cafe', 'Pier']);
      let body = (await ask(p.id, 'music')).json();
      expect(body.via).toBe('code');
      expect(body.plan.ghostChanges[0].stop.placeId).toBe(id['Midway Hall']);
      llm.answer = new Error('503');
      body = (await ask(p.id, 'music')).json();
      expect(body.plan.ghostChanges[0].stop.placeId).toBe(id['Midway Hall']);
    } finally {
      Object.assign(t.ctx.providers, { llm: new FakeLlm() });
    }
  });

  test('never suggests a stop already in the plan', async () => {
    const p = await plan(['Cafe', 'Midway Hall', 'Pier']);
    const body = (await ask(p.id, 'music')).json();
    const added = body.plan.ghostChanges[0].stop.placeId;
    expect(added).not.toBe(id['Midway Hall']);
    expect([id['Jazz Cellar'], id['Side Club']]).toContain(added);
  });

  test('nothing of that kind nearby: a message and no changes', async () => {
    const p = await plan(['Cafe', 'Pier']);
    const body = (await ask(p.id, 'sports')).json();
    expect(body.plan.ghostChanges).toEqual([]);
    expect(body.message).toBe("I couldn't find a sports spot near this plan.");
  });

  test('applying adds the stop in that position', async () => {
    const p = await plan(['Cafe', 'Pier']);
    await ask(p.id, 'music');
    const after = (
      await t.app.inject({
        method: 'POST',
        url: `/v1/plans/${p.id}/changes/apply`,
        headers: u.headers,
        payload: {},
      })
    ).json();
    expect(after.stops.map((s: { place: { name: string } }) => s.place.name)).toEqual([
      'Cafe',
      'Midway Hall',
      'Pier',
    ]);
  });
});

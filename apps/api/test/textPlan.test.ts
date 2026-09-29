import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { UserDoc } from '../src/db/types.ts';
import { FakeLlm } from '../src/providers/llm.ts';
import { findByKind, findByName, resolveStops } from '../src/services/placeLookup.ts';
import { extractPlan, parsePlanText } from '../src/services/textExtract.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { setupTestApp } from './helpers.ts';

const THU = new Date('2026-10-01T14:00:00Z'); // Thu 1 Oct, 10 AM in New York

describe('reading a plan out of a text (rules)', () => {
  const p = (t: string) => parsePlanText(t, THU);
  test('when, stops in order, and who', () => {
    expect(
      p('Sat 2pm: Hungarian Pastry Shop, then climbing at Movement Harlem with ben and @jenny'),
    ).toEqual({
      intent: 'plan',
      date: '2026-10-03',
      time: '14:00',
      mode: null,
      stops: [
        { query: 'Hungarian Pastry Shop', kind: 'named', category: null },
        { query: 'Movement Harlem', kind: 'named', category: null },
      ],
      people: ['ben', 'jenny'],
    });
  });
  test('kinds of place, relative days, evening default', () => {
    expect(p('tomorrow dinner then drinks')).toMatchObject({
      date: '2026-10-02',
      time: null,
      stops: [
        { query: 'dinner', kind: 'generic', category: 'food' },
        { query: 'drinks', kind: 'generic', category: 'drinks' },
      ],
    });
    expect(p("let's get pizza then go to Riverside Park tonight with Maya")).toMatchObject({
      date: '2026-10-01',
      time: '19:00',
      stops: [
        { query: 'pizza', kind: 'generic' },
        { query: 'Riverside Park', kind: 'named' },
      ],
      people: ['Maya'],
    });
    expect(p('Thursday noon: coffee → the Met').date).toBe('2026-10-01');
    expect(p('Wed 9:30am coffee').date).toBe('2026-10-07');
    expect(p('Wed 9:30am coffee').time).toBe('9:30');
  });
  test('a group chat: several lines, a time mid-sentence, a trailing "after?"', () => {
    expect(
      p(
        'we should get coffee then Riverside Park tomorrow at 10am\nthen Joe Coffee after?\nplan this',
      ),
    ).toMatchObject({
      date: '2026-10-02',
      time: '10:00',
      stops: [
        { query: 'coffee', kind: 'generic' },
        { query: 'Riverside Park', kind: 'named' },
        { query: 'Joe Coffee', kind: 'named' },
      ],
    });
  });
  test('how', () => {
    expect(p('Sat: Joe Coffee then the Met by subway').mode).toBe('transit');
    expect(p('Sat: Joe Coffee then the Met on citibike').mode).toBe('bike');
  });
  test('chatter is not a plan', () => {
    expect(p('lol did you see that').intent).toBe('none');
    expect(p('hermi plan this').intent).toBe('none');
    expect(p('ok sounds good').intent).toBe('none');
  });
});

describe('extractPlan', () => {
  class JsonLlm extends FakeLlm {
    override readonly name = 'stub' as 'fake';
    constructor(private out: unknown) {
      super();
    }
    prompts: string[] = [];
    override async json<T>(prompt: string): Promise<T> {
      this.prompts.push(prompt);
      if (this.out instanceof Error) throw this.out;
      return this.out as T;
    }
  }
  const ctxWith = (llm: FakeLlm) => ({ providers: { llm } }) as never;
  const lines = [
    { sender: '+15551110000', text: 'saturday? the met then maybe tacos' },
    { sender: '+15551110001', text: 'actually not the met, MoMA. and bring Sam' },
  ];

  test('the model reads the chat, later corrections included', async () => {
    const llm = new JsonLlm({
      intent: 'plan',
      date: '2026-10-03',
      time: null,
      mode: null,
      stops: [
        { query: 'Museum of Modern Art', kind: 'named', category: null },
        { query: 'tacos', kind: 'generic', category: 'food' },
      ],
      people: ['Sam'],
    });
    const plan = await extractPlan(ctxWith(llm), lines, THU);
    expect(plan.stops.map((s) => s.query)).toEqual(['Museum of Modern Art', 'tacos']);
    expect(llm.prompts[0]).toContain('Today is Thursday, October 1, 2026');
    expect(llm.prompts[0]).toContain('[+15551110001] actually not the met, MoMA. and bring Sam');
  });

  test('a malformed or failed answer falls back to the rules', async () => {
    for (const out of [{ intent: 'plan', stops: 'nope' }, new Error('503')]) {
      const plan = await extractPlan(
        ctxWith(new JsonLlm(out)),
        [{ sender: 'x', text: 'Sat: Joe Coffee then pizza' }],
        THU,
      );
      expect(plan.stops.map((s) => s.query)).toEqual(['Joe Coffee', 'pizza']);
    }
  });
});

describe('finding the places', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  const user = {
    _id: 'u',
    is21: false,
    openToPlans: false,
    ghostMode: false,
    tasteDone: true,
    createdAt: new Date(),
  } as UserDoc;
  const far = offset(ORIGIN, 5000, 0);
  beforeAll(async () => {
    t = await setupTestApp();
    await insertPlaces(t.ctx.db, [
      placeDoc({ name: "Tom's Restaurant", category: 'food', at: ORIGIN }),
      placeDoc({ name: 'Metropolis Diner', category: 'food', at: ORIGIN }),
      placeDoc({ name: 'The Metropolitan Museum of Art', category: 'culture', at: far }),
      placeDoc({
        name: 'Joe Coffee',
        category: 'food',
        tags: ['coffee'],
        at: offset(ORIGIN, 3000, 0),
      }),
      placeDoc({
        name: 'Joe Coffee',
        category: 'food',
        tags: ['coffee'],
        at: offset(ORIGIN, 200, 0),
      }),
      placeDoc({ name: 'Big Diner', category: 'food', at: offset(ORIGIN, 100, 0), been: 40 }),
      placeDoc({
        name: 'Bean There',
        category: 'food',
        tags: ['coffee'],
        at: offset(ORIGIN, 150, 0),
      }),
      placeDoc({
        name: 'Night Bar',
        category: 'drinks',
        at: offset(ORIGIN, 100, 0),
        adultOnly: true,
      }),
      placeDoc({ name: 'Paris Cafe', category: 'food', at: { lat: 48.85, lng: 2.35 } }),
    ]);
  });
  afterAll(() => t.teardown());

  test('by name: any apostrophe, aliases, whole words for short names, nearest of namesakes, NYC only', async () => {
    expect((await findByName(t.ctx, 'Tom’s restaurant', null))?.name).toBe("Tom's Restaurant");
    expect((await findByName(t.ctx, 'toms', null))?.name).toBe("Tom's Restaurant");
    expect((await findByName(t.ctx, 'the met', null))?.name).toBe('The Metropolitan Museum of Art');
    expect(await findByName(t.ctx, 'metro', null)).toBeNull();
    const joe = await findByName(t.ctx, 'joe coffee', ORIGIN);
    expect(joe?.loc.coordinates[1]).toBeCloseTo(offset(ORIGIN, 200, 0).lat, 5);
    expect(await findByName(t.ctx, 'Paris Cafe', null)).toBeNull();
  });

  test('by kind: the wanted tag wins over popularity; 21+ places only for 21+', async () => {
    expect((await findByKind(t.ctx, 'coffee', 'food', ORIGIN, user, []))?.name).toMatch(
      /Joe Coffee|Bean There/,
    );
    expect(await findByKind(t.ctx, 'drinks', 'drinks', ORIGIN, user, [])).toBeNull();
    expect(
      (await findByKind(t.ctx, 'drinks', 'drinks', ORIGIN, { ...user, is21: true }, []))?.name,
    ).toBe('Night Bar');
  });

  test('in order, each search starting at the stop before; unknown names are reported, not invented', async () => {
    const r = await resolveStops(
      t.ctx,
      [
        { query: "Tom's Restaurant", kind: 'named', category: null },
        { query: 'coffee', kind: 'generic', category: 'food' },
        { query: 'Zzyzx Lounge', kind: 'named', category: null },
      ],
      user,
    );
    expect(r.places.map((p) => p.name)[0]).toBe("Tom's Restaurant");
    expect(r.places[1]?.tags).toContain('coffee');
    expect(r.missing).toEqual(['Zzyzx Lounge']);
  });

  test('a name we lack is asked of Google Maps, and its proper name looked up', async () => {
    class MapsLlm extends FakeLlm {
      override readonly name = 'stub' as 'fake';
      override async askMaps() {
        return {
          text: 'That is the Met.',
          sources: [
            { title: 'The Metropolitan Museum of Art', uri: 'https://maps.google.com/?cid=1' },
          ],
        };
      }
    }
    t.ctx.providers.llm = new MapsLlm();
    try {
      const r = await resolveStops(
        t.ctx,
        [{ query: 'Met Fifth Avenue', kind: 'named', category: null }],
        user,
      );
      expect(r.places.map((p) => p.name)).toEqual(['The Metropolitan Museum of Art']);
    } finally {
      t.ctx.providers.llm = new FakeLlm();
    }
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { EtaProvider } from '../src/providers/eta.ts';
import type { HoursProvider } from '../src/providers/hours.ts';
import { FakeLlm } from '../src/providers/llm.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

let t: Awaited<ReturnType<typeof setupTestApp>>;
let u: Awaited<ReturnType<typeof devLogin>>;
let cafe: string;
let museum: string;
const etaCalls: string[] = [];

beforeAll(async () => {
  t = await setupTestApp();
  const [c, m] = await insertPlaces(t.ctx.db, [
    placeDoc({ name: 'Cafe', category: 'food', at: ORIGIN }),
    placeDoc({ name: 'Museum', category: 'culture', at: offset(ORIGIN, 800, 0) }),
  ]);
  [cafe, museum] = [c!._id, m!._id];
  // Stub providers: hours only for the museum, fixed ETAs, an "AI" that says 60 min everywhere.
  const hours: HoursProvider = {
    name: 'stub',
    hours: async (p) =>
      p.name === 'Museum'
        ? { googlePlaceId: 'g-museum', hours: [{ day: 6, open: '10:00', close: '15:30' }] }
        : null,
  };
  const eta: EtaProvider = {
    name: 'stub',
    eta: async (_o, _d, mode, departAt) => {
      etaCalls.push(`${mode}@${departAt.toISOString()}`);
      return { minutes: mode === 'transit' ? 20 : 12, source: 'apple' };
    },
  };
  class StubLlm extends FakeLlm {
    override readonly name = 'stub' as 'fake';
    override async stayLengths(stops: { id: string }[]) {
      return stops.map((s) => ({ id: s.id, stayMin: 90, reason: 'Big collection' }));
    }
  }
  Object.assign(t.ctx.providers, { hours, eta, llm: new StubLlm() });
  u = await devLogin(t.app, 'planner');
});
afterAll(() => t.teardown());

describe('POST /plans/:id/schedule', () => {
  test('closing-time violation proposes a swap; accepting it clears the issue', async () => {
    // Sat 3 Oct 2026, 14:00 EDT
    const p = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: {
          startAt: '2026-10-03T18:00:00Z',
          stops: [{ placeId: cafe }, { placeId: museum }],
        },
      })
    ).json();
    const r = await t.app.inject({
      method: 'POST',
      url: `/v1/plans/${p.id}/schedule`,
      headers: u.headers,
    });
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(s.stops[1]).toMatchObject({
      legMin: 12,
      legSource: 'apple',
      stayMin: 90,
      staySource: 'ai',
      stayReason: 'Big collection',
    });
    expect(s.issues).toEqual([
      expect.objectContaining({ code: 'CLOSES_BEFORE_STAY_ENDS', stopId: s.stops[1].id }),
    ]);
    expect(s.ghostChanges).toEqual([
      expect.objectContaining({
        kind: 'swap',
        fromIndex: 2,
        toIndex: 1,
        label: 'Swap 1 and 2 to reach Museum by 2 pm',
      }),
    ]);

    const applied = (
      await t.app.inject({
        method: 'POST',
        url: `/v1/plans/${p.id}/changes/apply`,
        headers: u.headers,
        payload: {},
      })
    ).json();
    expect(applied.stops.map((x: { label: string }) => x.label)).toEqual(['Museum', 'Cafe']);
    expect(applied.issues).toEqual([]);
    expect(applied.ghostChanges).toEqual([]);
    expect(applied.stops[0].stayMin).toBe(90); // AI stay survives the reorder
  });

  test('transit legs are re-timed once with the departure times the real ETAs produce', async () => {
    etaCalls.length = 0;
    const p = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: {
          mode: 'transit',
          startAt: '2026-10-04T14:00:00Z',
          stops: [{ placeId: cafe }, { placeId: museum }, { placeId: cafe }],
        },
      })
    ).json();
    await t.app.inject({ method: 'POST', url: `/v1/plans/${p.id}/schedule`, headers: u.headers });
    // Pass 1 departs leg 2 after the offline 9-min estimate for leg 1; the real ETA (20 min) pushes it 11 min later.
    expect(etaCalls).toEqual([
      'transit@2026-10-04T15:30:00.000Z',
      'transit@2026-10-04T17:09:00.000Z',
      'transit@2026-10-04T15:30:00.000Z',
      'transit@2026-10-04T17:20:00.000Z',
    ]);
  });

  test('end-time overrun proposes an earlier start', async () => {
    const p = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: {
          startAt: '2026-10-04T14:00:00Z',
          endBy: '2026-10-04T16:00:00Z',
          stops: [{ placeId: cafe }, { placeId: cafe }],
        },
      })
    ).json();
    const s = (
      await t.app.inject({ method: 'POST', url: `/v1/plans/${p.id}/schedule`, headers: u.headers })
    ).json();
    expect(s.ghostChanges[0]).toMatchObject({
      kind: 'set_start',
      label: expect.stringMatching(/^Start \d+ min earlier/),
    });
    const applied = (
      await t.app.inject({
        method: 'POST',
        url: `/v1/plans/${p.id}/changes/apply`,
        headers: u.headers,
        payload: { ids: [s.ghostChanges[0].id] },
      })
    ).json();
    expect(applied.issues).toEqual([]);
  });

  test('hours, AI stays and walking legs are fetched at once, not one after another', async () => {
    /** Resolves to `f()` after `ms`. */
    const slow =
      <A extends unknown[], R>(ms: number, f: (...a: A) => Promise<R>) =>
      async (...a: A) => {
        await new Promise((r) => setTimeout(r, ms));
        return f(...a);
      };
    const saved = { ...t.ctx.providers };
    const { hours, eta, llm } = saved;
    Object.assign(t.ctx.providers, {
      hours: { name: 'slow', hours: slow(150, hours.hours.bind(hours)) },
      eta: { name: 'slow', eta: slow(100, eta.eta.bind(eta)) },
      llm: Object.assign(Object.create(llm), { stayLengths: slow(400, llm.stayLengths.bind(llm)) }),
    });
    const [far] = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Unscheduled Gallery', category: 'culture', at: offset(ORIGIN, 0, 600) }),
    ]);
    const p = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: { stops: [{ placeId: cafe }, { placeId: far!._id }, { placeId: museum }] },
      })
    ).json();
    const t0 = performance.now();
    const r = await t.app.inject({
      method: 'POST',
      url: `/v1/plans/${p.id}/schedule`,
      headers: u.headers,
    });
    const ms = performance.now() - t0;
    Object.assign(t.ctx.providers, saved);
    console.log(`schedule with 150 ms hours, 400 ms stays, 100 ms ETAs: ${Math.round(ms)} ms`);
    expect(r.json().stops[2]).toMatchObject({ legSource: 'apple', staySource: 'ai' });
    expect(ms).toBeLessThan(150 + 400 + 100);
  });

  test('dismiss clears ghosts without changing the plan', async () => {
    const p = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: {
          startAt: '2026-10-03T18:00:00Z',
          stops: [{ placeId: cafe }, { placeId: museum }],
        },
      })
    ).json();
    await t.app.inject({ method: 'POST', url: `/v1/plans/${p.id}/schedule`, headers: u.headers });
    const d = (
      await t.app.inject({
        method: 'POST',
        url: `/v1/plans/${p.id}/changes/dismiss`,
        headers: u.headers,
        payload: {},
      })
    ).json();
    expect(d.ghostChanges).toEqual([]);
    expect(d.stops.map((x: { label: string }) => x.label)).toEqual(['Cafe', 'Museum']);
  });
});

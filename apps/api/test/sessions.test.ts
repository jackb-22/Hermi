import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { filterTrace } from '../src/domain/plausibility.ts';
import { ORIGIN, insertPlaces, offset, placeDoc } from './fixtures/places.ts';
import { walk } from './fixtures/trace.ts';
import { devLogin, setupTestApp } from './helpers.ts';

describe('plausibility', () => {
  const now = new Date('2026-09-26T20:00:00Z');
  const p = (northM: number, sec: number, accuracy = 10) => ({ ...offset(ORIGIN, northM, 0), accuracy, time: new Date(now.getTime() - 600_000 + sec * 1000) });

  test('drops bad accuracy, teleports, reordering and future fixes', () => {
    const { accepted, rejected } = filterTrace(
      [p(0, 0), p(20, 15), p(30, 20, 150), p(5000, 30), p(40, 25), p(25, 15), { ...p(50, 0), time: new Date(now.getTime() + 600_000) }],
      undefined,
      now,
    );
    expect(accepted).toHaveLength(3);
    expect(rejected).toEqual({ accuracy: 1, jump: 1, order: 1, future: 1 });
  });

  test('continues from the previous batch', () => {
    const first = filterTrace([p(0, 0)], undefined, now);
    const { rejected } = filterTrace([p(9000, 10)], first.last, now);
    expect(rejected.jump).toBe(1);
  });
});

describe('sessions', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let u: Awaited<ReturnType<typeof devLogin>>;
  let cafe: string;
  beforeAll(async () => {
    t = await setupTestApp();
    const [c] = await insertPlaces(t.ctx.db, [placeDoc({ name: 'Cafe', category: 'food', at: offset(ORIGIN, 400, 0) })]);
    cafe = c!._id;
    u = await devLogin(t.app, 'walker');
  });
  afterAll(() => t.teardown());

  test('start from a plan returns geofences, is idempotent, and marks the plan active', async () => {
    const plan = (await t.app.inject({ method: 'POST', url: '/v1/plans', headers: u.headers, payload: { stops: [{ placeId: cafe }] } })).json();
    const a = await t.app.inject({ method: 'POST', url: '/v1/sessions', headers: u.headers, payload: { planId: plan.id } });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ session: { kind: 'plan', status: 'active' }, geofences: [{ placeId: cafe, radiusM: 100 }], plan: { status: 'active' } });
    const b = await t.app.inject({ method: 'POST', url: '/v1/sessions', headers: u.headers, payload: { planId: plan.id } });
    expect(b.json().session.id).toBe(a.json().session.id);
    const other = await t.app.inject({ method: 'POST', url: '/v1/sessions', headers: u.headers, payload: {} });
    expect(other.statusCode).toBe(409);
    const active = await t.app.inject({ url: '/v1/sessions/active', headers: u.headers });
    expect(active.json().session.id).toBe(a.json().session.id);

    const pts = walk([ORIGIN, offset(ORIGIN, 400, 0)], new Date(Date.now() - 10 * 60_000));
    const up = await t.app.inject({ method: 'POST', url: `/v1/sessions/${a.json().session.id}/points`, headers: u.headers, payload: { points: pts } });
    expect(up.json()).toEqual({ accepted: pts.length, rejected: { accuracy: 0, jump: 0, order: 0, future: 0 } });
    const again = await t.app.inject({ method: 'POST', url: `/v1/sessions/${a.json().session.id}/points`, headers: u.headers, payload: { points: pts.slice(0, 3) } });
    expect(again.json().rejected.order).toBe(3);
    const { rows } = await t.ctx.tiger.query('select count(*)::int as n from location_points where session_id = $1', [a.json().session.id]);
    expect(rows[0].n).toBe(pts.length);
  });

  test("points go only to your own session", async () => {
    const s = (await t.app.inject({ url: '/v1/sessions/active', headers: u.headers })).json().session;
    const intruder = await devLogin(t.app, 'intruder');
    const r = await t.app.inject({ method: 'POST', url: `/v1/sessions/${s.id}/points`, headers: intruder.headers, payload: { points: [{ lat: 1, lng: 1, accuracy: 5, time: new Date().toISOString() }] } });
    expect(r.statusCode).toBe(404);
  });
});

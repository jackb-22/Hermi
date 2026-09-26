import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { checkDwell } from '../src/domain/dwell.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { venueTag } from './fixtures/tags.ts';
import { walk } from './fixtures/trace.ts';
import { devLogin, setupTestApp } from './helpers.ts';

describe('checkDwell', () => {
  const place = offset(ORIGIN, 500, 0);
  const now = new Date('2026-09-26T20:00:00Z');
  const trace = (dwellMin: number, startInside = false) =>
    walk(
      startInside ? [place] : [ORIGIN, place],
      new Date(now.getTime() - (dwellMin + 8) * 60_000),
      { dwellMin: { [startInside ? 0 : 1]: dwellMin } },
    ).map((p) => ({
      ...p,
      time: new Date(p.time),
    }));

  test('5+ minutes inside after walking in passes', () => {
    expect(checkDwell(trace(6), place, now)).toMatchObject({ ok: true });
  });
  test('too short a stay fails with NO_DWELL', () => {
    expect(checkDwell(trace(3), place, new Date(now.getTime() - 5 * 60_000))).toEqual({
      ok: false,
      reason: 'CHECKIN_NO_DWELL',
    });
  });
  test('no trace leading in fails', () => {
    expect(checkDwell(trace(10, true), place, now)).toEqual({
      ok: false,
      reason: 'CHECKIN_NO_DWELL',
    });
  });
  test('never arrived fails with TOO_FAR', () => {
    expect(checkDwell(trace(6), offset(ORIGIN, 3000, 0), now)).toEqual({
      ok: false,
      reason: 'CHECKIN_TOO_FAR',
    });
  });
});

describe('POST /checkins', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let u: Awaited<ReturnType<typeof devLogin>>;
  let cafe: string;
  let museum: string;
  let tag: Awaited<ReturnType<typeof venueTag>>;
  const cafeAt = offset(ORIGIN, 500, 0);

  beforeAll(async () => {
    t = await setupTestApp();
    const [c, m] = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Cafe', category: 'food', at: cafeAt }),
      placeDoc({ name: 'Museum', category: 'culture', at: offset(ORIGIN, 1500, 0) }),
    ]);
    [cafe, museum] = [c!._id, m!._id];
    tag = await venueTag(t.ctx.db, museum);
    u = await devLogin(t.app, 'checker');
  });
  afterAll(() => t.teardown());

  const post = (payload: object) =>
    t.app.inject({ method: 'POST', url: '/v1/checkins', headers: u.headers, payload });

  test('GPS tier in a plan: dwell verified, XP 10+10, place been, stop done; cooldown blocks a second one', async () => {
    const plan = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: { stops: [{ placeId: cafe }, { placeId: museum }] },
      })
    ).json();
    const s = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: u.headers,
        payload: { planId: plan.id },
      })
    ).json().session;
    const pts = walk([ORIGIN, cafeAt], new Date(Date.now() - 16 * 60_000), { dwellMin: { 1: 7 } });
    await t.app.inject({
      method: 'POST',
      url: `/v1/sessions/${s.id}/points`,
      headers: u.headers,
      payload: { points: pts },
    });

    const r = await post({ tier: 'gps', placeId: cafe, sessionId: s.id, ...cafeAt, accuracy: 12 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      checkin: { tier: 'gps', placeId: cafe, planId: plan.id, sessionId: s.id },
      firstVisit: true,
      xp: { total: 20 },
      planStop: { planId: plan.id, index: 1 },
    });
    const p = await t.ctx.db.collection('places').findOne({ _id: cafe } as never);
    expect(p?.been).toBe(1);
    const after = (await t.app.inject({ url: `/v1/plans/${plan.id}`, headers: u.headers })).json();
    expect(after.stops[0]).toMatchObject({ done: true, checkinId: r.json().checkin.id });
    const { rows } = await t.ctx.tiger.query(
      'select kind, xp from xp_events where user_id = $1 order by kind',
      [u.id],
    );
    expect(rows).toEqual([
      { kind: 'checkin_gps', xp: 10 },
      { kind: 'first_visit', xp: 10 },
    ]);

    const again = await post({
      tier: 'gps',
      placeId: cafe,
      sessionId: s.id,
      ...cafeAt,
      accuracy: 12,
    });
    expect(again.statusCode).toBe(429);
    expect(again.json().error.code).toBe('CHECKIN_RATE_LIMITED');
  });

  test('GPS tier rejections: low accuracy, not there', async () => {
    expect(
      (
        await post({ tier: 'gps', placeId: museum, ...offset(ORIGIN, 1500, 0), accuracy: 80 })
      ).json().error.code,
    ).toBe('CHECKIN_LOW_ACCURACY');
    expect(
      (
        await post({ tier: 'gps', placeId: museum, ...offset(ORIGIN, 1500, 0), accuracy: 10 })
      ).json().error.code,
    ).toBe('CHECKIN_TOO_FAR');
  });

  test('tag tier: wrong secret, too far, then success with 15 XP', async () => {
    const wrong = await post({
      tier: 'tag',
      tagId: tag.id,
      k: 'nope',
      ...offset(ORIGIN, 1500, 0),
      accuracy: 30,
    });
    expect(wrong.json().error.code).toBe('TAG_INVALID');
    const far = await post({ tier: 'tag', tagUrl: tag.url, ...ORIGIN, accuracy: 30 });
    expect(far.json().error.code).toBe('CHECKIN_TOO_FAR');
    const ok = await post({
      tier: 'tag',
      tagUrl: tag.url,
      ...offset(ORIGIN, 1450, 0),
      accuracy: 30,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      checkin: { tier: 'tag', placeId: museum },
      xp: { total: 25 },
      planStop: { index: 2 },
    });
  });

  test('validation: GPS needs placeId', async () => {
    const r = await post({ tier: 'gps', ...ORIGIN, accuracy: 5 });
    expect(r.statusCode).toBe(400);
  });
});

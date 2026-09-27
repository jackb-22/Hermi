import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { applyHangout, displayStreak, newStreak } from '../src/domain/streak.ts';
import { insertPlaces, ORIGIN, offset, placeDoc } from './fixtures/places.ts';
import { personalTag, venueTag } from './fixtures/tags.ts';
import { devLogin, setupTestApp } from './helpers.ts';

// Mondays in New York: 2026-09-21, 09-28, 10-05, 10-12
const at = (iso: string) => new Date(iso);

describe('streak rules', () => {
  test('one per day, +1 per consecutive week, reset after a gap', () => {
    let s = newStreak(at('2026-09-22T16:00:00Z')); // Tue wk1
    expect(applyHangout(s, at('2026-09-22T22:00:00Z')).outcome).toBe('already_today');
    s = applyHangout(s, at('2026-09-24T16:00:00Z')).state; // Thu wk1: counted, streak unchanged
    expect(s).toMatchObject({ hangouts: 2, streakWeeks: 1 });
    s = applyHangout(s, at('2026-09-28T16:00:00Z')).state; // Mon wk2
    expect(s).toMatchObject({ hangouts: 3, streakWeeks: 2 });
    s = applyHangout(s, at('2026-10-14T16:00:00Z')).state; // wk4: skipped wk3
    expect(s).toMatchObject({ hangouts: 4, streakWeeks: 1 });
  });

  test('display: lit this week, live through next week, 0 after', () => {
    const s = { ...newStreak(at('2026-09-22T16:00:00Z')), streakWeeks: 8 };
    expect(displayStreak(s, at('2026-09-26T16:00:00Z'))).toEqual({
      weeks: 8,
      lit: true,
      endsThisWeek: false,
    });
    expect(displayStreak(s, at('2026-10-01T16:00:00Z'))).toEqual({
      weeks: 8,
      lit: false,
      endsThisWeek: true,
    });
    expect(displayStreak(s, at('2026-10-06T16:00:00Z'))).toEqual({
      weeks: 0,
      lit: false,
      endsThisWeek: false,
    });
  });

  test('Sunday night vs Monday morning ET are different weeks', () => {
    const s = newStreak(at('2026-09-28T03:30:00Z')); // Sun 27 Sep 23:30 EDT
    expect(applyHangout(s, at('2026-09-28T04:30:00Z')).state.streakWeeks).toBe(2); // Mon 00:30 EDT
  });
});

describe('POST /taps', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let maya: Awaited<ReturnType<typeof devLogin>>;
  let sam: Awaited<ReturnType<typeof devLogin>>;
  let mayaTag: Awaited<ReturnType<typeof personalTag>>;
  let samTag: Awaited<ReturnType<typeof personalTag>>;
  const here = { ...ORIGIN, accuracy: 10 };

  beforeAll(async () => {
    t = await setupTestApp();
    maya = await devLogin(t.app, 'maya');
    sam = await devLogin(t.app, 'sam');
    mayaTag = await personalTag(t.ctx.db);
    samTag = await personalTag(t.ctx.db);
    await t.app.inject({
      method: 'POST',
      url: '/v1/me/tag',
      headers: maya.headers,
      payload: { url: mayaTag.url },
    });
    const bound = await t.app.inject({
      method: 'POST',
      url: '/v1/me/tag',
      headers: sam.headers,
      payload: { url: samTag.url },
    });
    expect(bound.json(), bound.body).toMatchObject({ tagId: samTag.id });
  });
  afterAll(() => t.teardown());

  const tap = (who: typeof maya, url: string, extra: object = {}) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/taps',
      headers: who.headers,
      payload: { url, ...here, ...extra },
    });

  test('binding someone else’s tag is refused; tapping your own is refused', async () => {
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/v1/me/tag',
          headers: maya.headers,
          payload: { url: samTag.url },
        })
      ).statusCode,
    ).toBe(409);
    expect((await tap(maya, mayaTag.url)).json().error.code).toBe('TAG_INVALID');
  });

  test('two taps within 2 minutes and 50 m make friends; pending poll sees it', async () => {
    const first = await tap(maya, samTag.url);
    expect(first.json()).toMatchObject({
      kind: 'personal',
      status: 'waiting',
      friend: { username: 'sam' },
      expiresAt: expect.any(String),
    });
    expect(
      (
        await t.app.inject({
          url: '/v1/taps/pending',
          query: { friendId: sam.id },
          headers: maya.headers,
        })
      ).json().status,
    ).toBe('waiting');
    const second = await tap(sam, mayaTag.url, offset(ORIGIN, 20, 0));
    expect(second.json()).toMatchObject({
      status: 'friends',
      friend: { username: 'maya' },
      streak: { weeks: 1, lit: true, hangouts: 1 },
    });
    expect(
      (
        await t.app.inject({
          url: '/v1/taps/pending',
          query: { friendId: sam.id },
          headers: maya.headers,
        })
      ).json().status,
    ).toBe('friends');
    // Same day again: counts nothing more
    await tap(maya, samTag.url);
    expect((await tap(sam, mayaTag.url)).json().status).toBe('already_today');
  });

  test('too far apart or too late: still waiting', async () => {
    const lee = await devLogin(t.app, 'lee');
    const leeTag = await personalTag(t.ctx.db, lee.id);
    await t.ctx.db
      .collection('users')
      .updateOne({ _id: lee.id } as never, { $set: { tagId: leeTag.id } });
    await tap(maya, leeTag.url);
    expect((await tap(lee, mayaTag.url, offset(ORIGIN, 200, 0))).json().status).toBe('waiting');
    t.ctx.clock.offsetMs = 3 * 60_000;
    expect((await tap(lee, mayaTag.url)).json().status).toBe('waiting');
    t.ctx.clock.offsetMs = 0;
  });

  test('next week a tap moves the streak; friends tagging in at the same venue within 30 min log a hangout', async () => {
    t.ctx.clock.offsetMs = 7 * 86_400_000;
    await tap(maya, samTag.url);
    expect((await tap(sam, mayaTag.url)).json()).toMatchObject({
      status: 'hangout',
      streak: { weeks: 2, hangouts: 2 },
    });

    t.ctx.clock.offsetMs = 14 * 86_400_000;
    const [bar] = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Bar', category: 'drinks', at: ORIGIN }),
    ]);
    const vt = await venueTag(t.ctx.db, bar!._id);
    // A second tag at the same venue (a replaced sticker, or the app's tag stand-in) still counts together.
    const vt2 = await venueTag(t.ctx.db, bar!._id);
    const m = await tap(maya, vt.url);
    expect(m.json()).toMatchObject({
      kind: 'venue',
      status: 'checked_in',
      checkin: { hangouts: [] },
    });
    t.ctx.clock.offsetMs += 20 * 60_000;
    const s = await tap(sam, vt2.url);
    expect(s.json().checkin.hangouts).toEqual([{ friendId: maya.id, streakWeeks: 3 }]);
    t.ctx.clock.offsetMs = 0;
    const { rows } = await t.ctx.tiger.query('select source from hangouts order by time');
    expect(rows.map((r) => r.source)).toEqual(['tap', 'tap', 'venue']);
  });

  test('client time far from now is rejected', async () => {
    const r = await tap(maya, samTag.url, {
      time: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(r.statusCode).toBe(400);
  });
});

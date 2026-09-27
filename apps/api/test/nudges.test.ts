import { newId, weekIndex } from '@itp/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  nextFridayAfternoon,
  nextMorning,
  reviewReminder,
  weeklyNudge,
} from '../src/services/nudges.ts';
import { devLogin, setupTestApp } from './helpers.ts';

describe('schedule times (New York)', () => {
  test('next Friday 3 PM, strictly after now, across DST', () => {
    expect(nextFridayAfternoon(new Date('2026-09-23T16:00:00Z')).toISOString()).toBe(
      '2026-09-25T19:00:00.000Z',
    );
    expect(nextFridayAfternoon(new Date('2026-09-25T20:00:00Z')).toISOString()).toBe(
      '2026-10-02T19:00:00.000Z',
    );
    expect(nextFridayAfternoon(new Date('2026-11-02T12:00:00Z')).toISOString()).toBe(
      '2026-11-06T20:00:00.000Z',
    );
  });
  test('next morning is 10 AM on the following New York day', () => {
    // 11:30 PM Saturday in New York is already Sunday in UTC.
    expect(nextMorning(new Date('2026-09-27T03:30:00Z')).toISOString()).toBe(
      '2026-09-27T14:00:00.000Z',
    );
  });
});

let t: Awaited<ReturnType<typeof setupTestApp>>;
type Login = Awaited<ReturnType<typeof devLogin>>;
const login = async (username: string, name: string, token = true) => {
  const u = await devLogin(t.app, username);
  await t.app.inject({ method: 'PATCH', url: '/v1/me', headers: u.headers, payload: { name } });
  if (token)
    await t.app.inject({
      method: 'POST',
      url: '/v1/me/push-token',
      headers: u.headers,
      payload: { token: `ExponentPushToken[${username}]` },
    });
  return u;
};
const friends = (a: Login, b: Login, weeks: number, lastWeek: number) => {
  const [x, y] = [a.id, b.id].sort();
  return t.ctx.db.collection('friendships').insertOne({
    _id: `${x}:${y}` as never,
    a: x,
    b: y,
    hangouts: weeks,
    streakWeeks: weeks,
    lastHangoutWeek: lastWeek,
    createdAt: new Date(),
  });
};
const pushesTo = (userId: string) =>
  t.ctx.db.collection('jobs').find({ type: 'push', 'payload.userIds': userId }).toArray();

beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(() => t.teardown());

describe('weekly nudge', () => {
  test('leads with the longest streak ending Sunday; once a week; queues next Friday', async () => {
    const week = weekIndex(t.ctx.clock.now());
    const me = await login('nudged', 'Jack');
    await friends(me, await login('bea_s', 'Bea Smith'), 8, week - 1);
    await friends(me, await login('cal_s', 'Cal'), 3, week - 1);
    await friends(me, await login('dee_s', 'Dee'), 12, week); // already logged this week: safe
    await weeklyNudge(t.ctx, {});
    const [p] = await pushesTo(me.id);
    expect(p?.payload.msg).toMatchObject({
      title: 'Your 8-week streak with Bea ends Sunday',
      data: { kind: 'streak_nudge' },
    });
    await weeklyNudge(t.ctx, {});
    expect(await pushesTo(me.id)).toHaveLength(1);
    const next = await t.ctx.db
      .collection('jobs')
      .findOne({ type: 'weekly_nudge', status: 'pending' });
    expect(next?.runAt.toISOString()).toBe(nextFridayAfternoon(t.ctx.clock.now()).toISOString());
  });

  test('no streak at risk: XP about to expire; nothing to say: no push; no token: skipped', async () => {
    const xp = await login('xp_only', 'Xavi');
    await t.ctx.tiger.query(
      `insert into xp_events (time, user_id, campus, kind, xp, ref_id) values ($1, $2, null, 'checkin', 40, $3)`,
      [new Date(t.ctx.clock.now().getTime() - 26 * 86_400_000), xp.id, newId()],
    );
    const quiet = await login('quiet', 'Quinn');
    const tokenless = await login('tokenless', 'Tia', false);
    await weeklyNudge(t.ctx, {});
    const [p] = await pushesTo(xp.id);
    expect(p?.payload.msg).toMatchObject({
      title: expect.stringMatching(/^40 XP expires \w+day\. Plans\?$/),
      data: { kind: 'xp_expiring' },
    });
    expect(await pushesTo(quiet.id)).toHaveLength(0);
    expect(await pushesTo(tokenless.id)).toHaveLength(0);
  });

  test('dev trigger ignores the weekly cap and returns a preview', async () => {
    const me = await login('devnudge', 'Dana');
    await friends(me, await login('eli_s', 'Eli'), 5, weekIndex(t.ctx.clock.now()) - 1);
    for (let i = 0; i < 2; i++) {
      const r = await t.app.inject({
        method: 'POST',
        url: '/v1/dev/nudge',
        payload: { userId: me.id },
      });
      expect(r.json()).toMatchObject({
        ok: true,
        preview: { title: 'Your 5-week streak with Eli ends Sunday' },
      });
    }
    expect(await pushesTo(me.id)).toHaveLength(2);
  });
});

describe('review reminder', () => {
  const session = (userId: string, reviewed: boolean[]) => {
    const _id = newId();
    return t.ctx.db
      .collection('sessions')
      .insertOne({
        _id: _id as never,
        userId,
        status: 'ended',
        recap: {
          stops: reviewed.map((r, i) => ({
            checkinId: newId(),
            placeName: ['Corner Cafe', 'Green Park', 'Bar'][i],
            reviewed: r,
          })),
        },
      })
      .then(() => _id);
  };

  test('one push the morning after when stops are unreviewed; none when all are', async () => {
    const u = await login('reviewer', 'Rae');
    await reviewReminder(t.ctx, { sessionId: await session(u.id, [false, true, false]) });
    const [p] = await pushesTo(u.id);
    expect(p?.payload.msg).toMatchObject({
      title: 'How were Corner Cafe and 1 more?',
      data: { kind: 'review_reminder' },
    });
    await reviewReminder(t.ctx, { sessionId: await session(u.id, [true]) });
    expect(await pushesTo(u.id)).toHaveLength(1);
  });
});

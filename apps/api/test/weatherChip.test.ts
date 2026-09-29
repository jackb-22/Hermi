import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { nyLocal, nyLocalToUtc } from '../src/domain/weatherDay.ts';
import type { DayForecast, WeatherProvider } from '../src/providers/weather.ts';
import { insertPlaces, ORIGIN, placeDoc } from './fixtures/places.ts';
import { devLogin, setupTestApp } from './helpers.ts';

/** Deterministic forecasts for "Best weather day", controlled per test. */
describe('POST /plans/:id/ask {chip: best_weather_day} with a known forecast', () => {
  let t: Awaited<ReturnType<typeof setupTestApp>>;
  let u: Awaited<ReturnType<typeof devLogin>>;
  let park: string;
  let forecast: DayForecast[] = [];
  const dayAfter = (n: number) =>
    nyLocal(new Date(t.ctx.clock.now().getTime() + n * 86_400_000)).date;
  const day = (date: string, precipChance: number, highF = 70): DayForecast => ({
    date,
    highF,
    lowF: highF - 10,
    precipChance,
    windMph: 5,
  });

  beforeAll(async () => {
    t = await setupTestApp();
    const weather: WeatherProvider = { name: 'stub', daily: async () => forecast };
    t.ctx.providers.weather = weather;
    const [doc] = await insertPlaces(t.ctx.db, [
      placeDoc({ name: 'Riverside Park', category: 'nature', tags: ['park'], at: ORIGIN }),
    ]);
    park = doc!._id;
    u = await devLogin(t.app, 'weatherwise');
  });
  afterAll(() => t.teardown());

  const planOn = async (date: string) =>
    (
      await t.app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: u.headers,
        payload: { startAt: nyLocalToUtc(date, 14, 30).toISOString(), stops: [{ placeId: park }] },
      })
    ).json();
  const ask = (planId: string) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/plans/${planId}/ask`,
      headers: u.headers,
      payload: { chip: 'best_weather_day' },
    });

  test('moves an outdoor plan off a rainy day to the dry one, keeping 2:30 PM', async () => {
    forecast = [
      day(dayAfter(1), 0.9),
      day(dayAfter(2), 0.8),
      day(dayAfter(3), 0.05),
      day(dayAfter(4), 0.6),
    ];
    const p = await planOn(dayAfter(1));
    const body = (await ask(p.id)).json();
    expect(body.via).toBe('code');
    expect(body.message).toMatch(/looks best for this plan: 5% rain, 70°F/);
    expect(body.plan.ghostChanges).toEqual([
      expect.objectContaining({
        kind: 'set_start',
        label: expect.stringMatching(/^Move to \w+day: 5% rain/),
      }),
    ]);
    const after = (
      await t.app.inject({
        method: 'POST',
        url: `/v1/plans/${p.id}/changes/apply`,
        headers: u.headers,
        payload: {},
      })
    ).json();
    expect(nyLocal(new Date(after.startAt))).toMatchObject({
      date: dayAfter(3),
      hour: 14,
      minute: 30,
    });
  });

  test('already on the best day: says so, no changes', async () => {
    forecast = [day(dayAfter(1), 0.9), day(dayAfter(2), 0.0), day(dayAfter(3), 0.7)];
    const p = await planOn(dayAfter(2));
    const body = (await ask(p.id)).json();
    expect(body.plan.ghostChanges).toEqual([]);
    expect(body.message).toMatch(/^Your day is already the best one: 0% rain/);
  });

  test('no forecast: no changes and an honest message', async () => {
    forecast = [];
    const p = await planOn(dayAfter(1));
    const body = (await ask(p.id)).json();
    expect(body.plan.ghostChanges).toEqual([]);
    expect(body.message).toBe('No forecast is available right now.');
  });
});

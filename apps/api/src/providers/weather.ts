import type { LatLng } from '@itp/shared';
import type { Config } from '../config.ts';
import { deadline } from '../util/deadline.ts';
import { appleDevToken } from './appleJwt.ts';

export interface DayForecast {
  date: string; // YYYY-MM-DD local
  highF: number;
  lowF: number;
  precipChance: number; // 0..1
  windMph: number;
}

export interface WeatherProvider {
  readonly name: string;
  daily(loc: LatLng): Promise<DayForecast[]>;
}

/** Deterministic 10-day forecast for tests and offline dev. */
export class FakeWeather implements WeatherProvider {
  readonly name = 'fake';
  constructor(private now: () => Date = () => new Date()) {}
  async daily(): Promise<DayForecast[]> {
    return Array.from({ length: 10 }, (_, i) => {
      const d = new Date(this.now().getTime() + i * 86_400_000);
      return {
        date: d.toISOString().slice(0, 10),
        highF: 60 + ((i * 7) % 20),
        lowF: 50 + ((i * 3) % 10),
        precipChance: [0.1, 0.8, 0.3, 0.05, 0.6][i % 5]!,
        windMph: 5 + (i % 4) * 4,
      };
    });
  }
}

/** Free, keyless; used until WeatherKit is configured. */
export class OpenMeteoWeather implements WeatherProvider {
  readonly name = 'open-meteo';
  async daily(loc: LatLng): Promise<DayForecast[]> {
    const q = new URLSearchParams({
      latitude: String(loc.lat),
      longitude: String(loc.lng),
      daily:
        'temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      timezone: 'America/New_York',
      forecast_days: '10',
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!r.ok) throw new Error(`open-meteo ${r.status}`);
    const d = (await r.json()).daily as Record<string, number[]> & { time: string[] };
    return d.time.map((date, i) => ({
      date,
      highF: d.temperature_2m_max![i]!,
      lowF: d.temperature_2m_min![i]!,
      precipChance: (d.precipitation_probability_max![i] ?? 0) / 100,
      windMph: d.wind_speed_10m_max![i]!,
    }));
  }
}

/** WeatherKit REST, same Apple Developer key family as Maps. */
export class WeatherKit implements WeatherProvider {
  readonly name = 'weatherkit';
  constructor(
    private c: { teamId: string; keyId: string; privateKey: string; serviceId: string },
  ) {}
  async daily(loc: LatLng): Promise<DayForecast[]> {
    const token = await appleDevToken({
      ...this.c,
      header: { id: `${this.c.teamId}.${this.c.serviceId}` },
      sub: this.c.serviceId,
    });
    const r = await fetch(
      `https://weatherkit.apple.com/api/v1/weather/en_US/${loc.lat}/${loc.lng}?dataSets=forecastDaily&timezone=America/New_York`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!r.ok) throw new Error(`weatherkit ${r.status}`);
    const days = (await r.json()).forecastDaily?.days as {
      forecastStart: string;
      temperatureMax: number;
      temperatureMin: number;
      precipitationChance: number;
      windSpeedAvg?: number;
    }[];
    const f = (c: number) => Math.round(c * 1.8 + 32);
    return days.map((d) => ({
      date: d.forecastStart.slice(0, 10),
      highF: f(d.temperatureMax),
      lowF: f(d.temperatureMin),
      precipChance: d.precipitationChance,
      windMph: Math.round((d.windSpeedAvg ?? 0) * 0.621),
    }));
  }
}

class FallbackWeather implements WeatherProvider {
  readonly name: string;
  constructor(private chain: WeatherProvider[]) {
    this.name = chain.map((c) => c.name).join('>');
  }
  async daily(loc: LatLng) {
    for (const p of this.chain) {
      try {
        return await deadline(p.daily(loc), 5000, `${p.name} forecast`);
      } catch (e) {
        console.warn(`[weather] ${p.name} failed: ${(e as Error).message}`);
      }
    }
    return new FakeWeather().daily();
  }
}

export function createWeather(c: Config): WeatherProvider {
  if (c.APPLE_TEAM_ID && c.WEATHERKIT_KEY_ID && c.WEATHERKIT_PRIVATE_KEY && c.APPLE_BUNDLE_ID) {
    return new FallbackWeather([
      new WeatherKit({
        teamId: c.APPLE_TEAM_ID,
        keyId: c.WEATHERKIT_KEY_ID,
        privateKey: c.WEATHERKIT_PRIVATE_KEY,
        serviceId: c.APPLE_BUNDLE_ID,
      }),
      new OpenMeteoWeather(),
    ]);
  }
  return c.FAKE_PROVIDERS ? new FakeWeather() : new OpenMeteoWeather();
}

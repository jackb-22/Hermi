import type { LatLng } from '@itp/shared';
import type { Config } from '../config.ts';
import { estimateLegMin, type Mode } from '../domain/schedule.ts';
import { deadline } from '../util/deadline.ts';
import { appleDevToken } from './appleJwt.ts';

export interface Eta {
  minutes: number;
  meters?: number;
  source: 'apple' | 'google' | 'estimate';
}

export interface EtaProvider {
  readonly name: string;
  eta(origin: LatLng, dest: LatLng, mode: Mode, departAt: Date): Promise<Eta>;
}

export class EstimateEta implements EtaProvider {
  readonly name = 'estimate';
  async eta(o: LatLng, d: LatLng, mode: Mode): Promise<Eta> {
    return { minutes: estimateLegMin(o, d, mode), source: 'estimate' };
  }
}

const APPLE_TYPE: Record<Mode, string> = {
  walk: 'Walking',
  bike: 'Cycling',
  transit: 'Transit',
  car: 'Automobile',
};

/** Apple Maps Server API: developer JWT → short-lived access token → /v1/etas, one leg at a time. */
export class AppleMapsEta implements EtaProvider {
  readonly name = 'apple';
  private access?: { token: string; exp: number };
  constructor(private c: { teamId: string; keyId: string; privateKey: string }) {}

  private async accessToken(): Promise<string> {
    if (this.access && this.access.exp > Date.now() + 60_000) return this.access.token;
    const dev = await appleDevToken(this.c);
    const res = await fetch('https://maps-api.apple.com/v1/token', {
      headers: { Authorization: `Bearer ${dev}` },
    });
    if (!res.ok) throw new Error(`apple token ${res.status}`);
    const b = (await res.json()) as { accessToken: string; expiresInSeconds: number };
    this.access = { token: b.accessToken, exp: Date.now() + b.expiresInSeconds * 1000 };
    return b.accessToken;
  }

  async eta(o: LatLng, d: LatLng, mode: Mode, departAt: Date): Promise<Eta> {
    const q = new URLSearchParams({
      origin: `${o.lat},${o.lng}`,
      destinations: `${d.lat},${d.lng}`,
      transportType: APPLE_TYPE[mode],
      departureDate: departAt.toISOString(),
    });
    const res = await fetch(`https://maps-api.apple.com/v1/etas?${q}`, {
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
    });
    if (!res.ok) throw new Error(`apple etas ${res.status}`);
    const b = (await res.json()) as {
      etas?: { expectedTravelTimeSeconds: number; distanceMeters: number }[];
    };
    const e = b.etas?.[0];
    if (!e) throw new Error('apple etas: empty');
    return {
      minutes: Math.max(1, Math.round(e.expectedTravelTimeSeconds / 60)),
      meters: e.distanceMeters,
      source: 'apple',
    };
  }
}

const GOOGLE_MODE: Record<Mode, string> = {
  walk: 'WALK',
  bike: 'BICYCLE',
  transit: 'TRANSIT',
  car: 'DRIVE',
};

export class GoogleRoutesEta implements EtaProvider {
  readonly name = 'google';
  constructor(private key: string) {}
  async eta(o: LatLng, d: LatLng, mode: Mode, departAt: Date): Promise<Eta> {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.key,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
        destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
        travelMode: GOOGLE_MODE[mode],
        departureTime: departAt > new Date() ? departAt.toISOString() : undefined,
      }),
    });
    if (!res.ok) throw new Error(`google routes ${res.status}`);
    const b = (await res.json()) as { routes?: { duration: string; distanceMeters: number }[] };
    const r = b.routes?.[0];
    if (!r) throw new Error('google routes: empty');
    return {
      minutes: Math.max(1, Math.round(Number.parseInt(r.duration, 10) / 60)),
      meters: r.distanceMeters,
      source: 'google',
    };
  }
}

/** Tries each provider in order, giving each `timeoutMs`; the offline estimate always answers last. */
export class ChainEta implements EtaProvider {
  readonly name: string;
  constructor(
    private chain: EtaProvider[],
    private log: (m: string) => void = console.warn,
    private timeoutMs = 5000,
  ) {
    this.name = chain.map((p) => p.name).join('>');
  }
  async eta(o: LatLng, d: LatLng, mode: Mode, departAt: Date): Promise<Eta> {
    for (const p of this.chain) {
      try {
        return await deadline(p.eta(o, d, mode, departAt), this.timeoutMs, `${p.name} eta`);
      } catch (e) {
        this.log(`[eta] ${p.name} failed: ${(e as Error).message}`);
      }
    }
    return new EstimateEta().eta(o, d, mode);
  }
}

export function createEta(c: Config): EtaProvider {
  const chain: EtaProvider[] = [];
  if (c.APPLE_TEAM_ID && c.APPLE_MAPS_KEY_ID && c.APPLE_MAPS_PRIVATE_KEY) {
    chain.push(
      new AppleMapsEta({
        teamId: c.APPLE_TEAM_ID,
        keyId: c.APPLE_MAPS_KEY_ID,
        privateKey: c.APPLE_MAPS_PRIVATE_KEY,
      }),
    );
  }
  if (c.GOOGLE_MAPS_KEY) chain.push(new GoogleRoutesEta(c.GOOGLE_MAPS_KEY));
  chain.push(new EstimateEta());
  return new ChainEta(chain);
}

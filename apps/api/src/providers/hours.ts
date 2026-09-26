import type { LatLng } from '@itp/shared';
import type { Config } from '../config.ts';

export interface OpeningHours {
  day: number; // 0 = Sunday
  open: string; // "HH:MM" local
  close: string;
}

export interface HoursProvider {
  readonly name: string;
  /** Opening hours for a venue, resolving (and returning) its Google place id when not known yet. */
  hours(p: {
    name: string;
    loc: LatLng;
    googlePlaceId?: string;
  }): Promise<{ googlePlaceId?: string; hours: OpeningHours[] } | null>;
}

/** No data: hours checks are skipped, which the plan allows as a demo fallback. */
export class NoHours implements HoursProvider {
  readonly name = 'none';
  async hours() {
    return null;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

export class GooglePlacesHours implements HoursProvider {
  readonly name = 'google';
  constructor(private key: string) {}
  async hours(p: { name: string; loc: LatLng; googlePlaceId?: string }) {
    const mask = 'places.id,places.regularOpeningHours.periods';
    let place: { id: string; regularOpeningHours?: { periods?: Period[] } } | undefined;
    if (p.googlePlaceId) {
      const r = await fetch(`https://places.googleapis.com/v1/places/${p.googlePlaceId}`, {
        headers: {
          'X-Goog-Api-Key': this.key,
          'X-Goog-FieldMask': 'id,regularOpeningHours.periods',
        },
      });
      if (!r.ok) throw new Error(`places details ${r.status}`);
      place = await r.json();
    } else {
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.key,
          'X-Goog-FieldMask': mask,
        },
        body: JSON.stringify({
          textQuery: p.name,
          maxResultCount: 1,
          locationBias: {
            circle: { center: { latitude: p.loc.lat, longitude: p.loc.lng }, radius: 150 },
          },
        }),
      });
      if (!r.ok) throw new Error(`places search ${r.status}`);
      place = ((await r.json()) as { places?: (typeof place)[] }).places?.[0];
    }
    if (!place) return null;
    const periods = place.regularOpeningHours?.periods ?? [];
    return {
      googlePlaceId: place.id,
      hours: periods.map(
        (x) =>
          x.close
            ? {
                day: x.open.day,
                open: `${pad(x.open.hour)}:${pad(x.open.minute ?? 0)}`,
                close: `${pad(x.close.hour)}:${pad(x.close.minute ?? 0)}`,
              }
            : { day: x.open.day, open: '00:00', close: '00:00' }, // open 24h
      ),
    };
  }
}

interface Period {
  open: { day: number; hour: number; minute?: number };
  close?: { day: number; hour: number; minute?: number };
}

export function createHours(c: Config): HoursProvider {
  return c.GOOGLE_MAPS_KEY ? new GooglePlacesHours(c.GOOGLE_MAPS_KEY) : new NoHours();
}

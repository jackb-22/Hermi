import { describe, expect, test } from 'vitest';
import {
  TAG_DIMS,
  TAGS,
  TASTE_DECK,
  buildTagUrl,
  haversineM,
  latLngToTile,
  localDayKey,
  parseTagUrl,
  tileToLatLng,
  tilesAlongSegment,
  weekIndex,
  weekKey,
} from '../src/index.ts';

describe('geo', () => {
  test('haversine: 1 degree latitude is ~111 km', () => {
    expect(haversineM({ lat: 40, lng: -74 }, { lat: 41, lng: -74 })).toBeCloseTo(111_195, -2);
  });
});

describe('tiles', () => {
  test('Times Square maps to the reference zoom-18 tile', () => {
    expect(latLngToTile({ lat: 40.758, lng: -73.9855 })).toEqual({ x: 77197, y: 98517 });
  });
  test('tile NW corner round-trips back to the same tile', () => {
    const t = { x: 77197, y: 98517 };
    const nw = tileToLatLng(t);
    expect(latLngToTile({ lat: nw.lat - 1e-7, lng: nw.lng + 1e-7 })).toEqual(t);
  });
  test('segments color every tile they cross with no gaps', () => {
    // ~1 km north along Broadway: roughly 9 tiles tall
    const tiles = tilesAlongSegment({ lat: 40.8075, lng: -73.9626 }, { lat: 40.8165, lng: -73.9580 });
    expect(tiles.length).toBeGreaterThanOrEqual(9);
    const ys = [...new Set(tiles.map((t) => t.y))].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBe(1);
  });
});

describe('week', () => {
  test('Sunday 23:59 ET and Monday 00:00 ET are adjacent weeks', () => {
    const sun = new Date('2026-09-28T03:59:00Z'); // Sun 27 Sep 23:59 EDT
    const mon = new Date('2026-09-28T04:00:00Z'); // Mon 28 Sep 00:00 EDT
    expect(localDayKey(sun)).toBe('2026-09-27');
    expect(weekIndex(mon) - weekIndex(sun)).toBe(1);
    expect(weekKey(sun)).toBe('2026-09-21');
    expect(weekKey(mon)).toBe('2026-09-28');
  });
  test('DST fall-back week still counts as one week', () => {
    const before = new Date('2026-11-02T12:00:00Z'); // Mon Nov 2 (after DST end on Nov 1)
    const sunday = new Date('2026-11-01T12:00:00Z');
    expect(weekIndex(before) - weekIndex(sunday)).toBe(1);
  });
});

describe('tag urls', () => {
  test('round trip venue and personal', () => {
    const v = buildTagUrl('https://x.tech/', { kind: 'venue', id: '01ABC', k: 's3cr3t' });
    expect(v).toBe('https://x.tech/c/01ABC?k=s3cr3t');
    expect(parseTagUrl(v)).toEqual({ kind: 'venue', id: '01ABC', k: 's3cr3t' });
    expect(parseTagUrl('https://x.tech/t/T1?k=z')).toEqual({ kind: 'personal', id: 'T1', k: 'z' });
  });
  test('rejects junk', () => {
    expect(parseTagUrl('nope')).toBeNull();
    expect(parseTagUrl('https://x.tech/c/1')).toBeNull();
    expect(parseTagUrl('https://x.tech/q/1?k=a')).toBeNull();
  });
});

describe('vocab', () => {
  test('48 unique tags, deck of 16 using known tags', () => {
    expect(TAG_DIMS).toBe(48);
    expect(new Set(TAGS).size).toBe(48);
    expect(TASTE_DECK).toHaveLength(16);
    for (const c of TASTE_DECK) for (const t of c.tags) expect(TAGS).toContain(t);
  });
});

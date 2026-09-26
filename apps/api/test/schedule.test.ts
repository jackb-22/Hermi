import { describe, expect, test } from 'vitest';
import { type SchedStop, assemble, estimateLegMin, totals, validate } from '../src/domain/schedule.ts';
import { ORIGIN, offset } from './fixtures/places.ts';

const stop = (id: string, northM: number, o: Partial<SchedStop> = {}): SchedStop => ({
  id,
  loc: offset(ORIGIN, northM, 0),
  category: 'food',
  name: id,
  stayMin: 60,
  legMode: 'walk',
  legMin: 10,
  isSlot: false,
  ...o,
});

describe('schedule', () => {
  test('legs: walking 800 m straight line is ~13 min; car overhead applies', () => {
    expect(estimateLegMin(ORIGIN, offset(ORIGIN, 800, 0), 'walk')).toBe(13);
    expect(estimateLegMin(ORIGIN, offset(ORIGIN, 800, 0), 'car')).toBeGreaterThan(4);
    expect(estimateLegMin(ORIGIN, ORIGIN, 'walk')).toBe(0);
  });

  test('assemble: arrival = previous departure + leg; first leg ignored', () => {
    const start = new Date('2026-09-26T18:00:00Z');
    const t = assemble(start, [stop('a', 0, { legMin: 99 }), stop('b', 500, { stayMin: 30, legMin: 12 })]);
    expect(t[0]!.arriveAt.toISOString()).toBe('2026-09-26T18:00:00.000Z');
    expect(t[0]!.departAt.toISOString()).toBe('2026-09-26T19:00:00.000Z');
    expect(t[1]!.arriveAt.toISOString()).toBe('2026-09-26T19:12:00.000Z');
    expect(t[1]!.departAt.toISOString()).toBe('2026-09-26T19:42:00.000Z');
  });

  test('validate: closes before stay ends, opens later, end time, unfilled slot', () => {
    // Sat 26 Sep 2026, 14:00 EDT arrival
    const start = new Date('2026-09-26T18:00:00Z');
    const stops = [
      stop('museum', 0, { hours: [{ day: 6, open: '10:00', close: '14:30' }] }),
      stop('bar', 100, { hours: [{ day: 6, open: '18:00', close: '02:00' }] }),
      stop('slot', 200, { isSlot: true }),
    ];
    const times = assemble(start, stops);
    const issues = validate(stops, times, new Date('2026-09-26T19:00:00Z'));
    expect(issues.map((i) => `${i.stopId}:${i.code}`)).toEqual([
      'museum:CLOSES_BEFORE_STAY_ENDS',
      'bar:OPENS_AFTER_ARRIVAL',
      'slot:UNFILLED_SLOT',
      'slot:ENDS_AFTER_END_TIME',
    ]);
  });

  test('totals: xp preview counts check-ins, completion and km on foot only', () => {
    const stops = [stop('a', 0), stop('b', 1000), stop('c', 2000, { legMode: 'car' })];
    const t = totals(stops, assemble(new Date(), stops));
    expect(t.footKm).toBeCloseTo(1.3, 1);
    expect(t.km).toBeCloseTo(2.6, 1);
    expect(t.xpPreview).toBe(3 * 10 + 20 + Math.round(1.3 * 5));
  });
});

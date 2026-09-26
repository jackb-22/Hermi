import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { ChainEta, EstimateEta, type EtaProvider } from '../src/providers/eta.ts';
import { createProviders } from '../src/providers/index.ts';
import { FakeLlm } from '../src/providers/llm.ts';
import { ORIGIN, offset } from './fixtures/places.ts';

describe('provider selection', () => {
  test('no keys: every provider is a fake or offline fallback', () => {
    const p = createProviders(loadConfig({ FAKE_PROVIDERS: '1' }));
    expect(p.llm.name).toBe('fake');
    expect(p.eta.name).toBe('estimate');
    expect(p.hours.name).toBe('none');
    expect(p.weather.name).toBe('fake');
    expect(p.appleIdentity.name).toBe('fake');
  });

  test('keys switch in real providers, with the estimate always last', () => {
    const p = createProviders(loadConfig({ GOOGLE_MAPS_KEY: 'k', GEMINI_API_KEY: 'g' }));
    expect(p.eta.name).toBe('google>estimate');
    expect(p.hours.name).toBe('google');
    expect(p.llm.name).toBe('gemini');
  });
});

describe('fallbacks', () => {
  test('chain falls through a failing provider to the estimate', async () => {
    const broken: EtaProvider = { name: 'broken', eta: async () => { throw new Error('down'); } };
    const logs: string[] = [];
    const eta = await new ChainEta([broken, new EstimateEta()], (m) => logs.push(m)).eta(ORIGIN, offset(ORIGIN, 800, 0), 'walk', new Date());
    expect(eta).toEqual({ minutes: 13, source: 'estimate' });
    expect(logs[0]).toMatch(/broken failed/);
  });

  test('fake llm returns category defaults and short labels', async () => {
    const llm = new FakeLlm();
    expect(await llm.stayLengths([{ id: 'a', name: 'Met', category: 'culture', arrival: 'Sat 2 PM' }], {})).toEqual([
      { id: 'a', stayMin: 90, reason: 'Typical culture visit' },
    ]);
    expect((await llm.label({ placeName: 'A Very Long Place Name Indeed Here', category: 'food', context: '' })).split(' ').length).toBeLessThanOrEqual(6);
  });
});

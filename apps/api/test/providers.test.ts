import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { ChainEta, EstimateEta, type EtaProvider } from '../src/providers/eta.ts';
import { createProviders } from '../src/providers/index.ts';
import { FakeLlm, GeminiLlm } from '../src/providers/llm.ts';
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
    const broken: EtaProvider = {
      name: 'broken',
      eta: async () => {
        throw new Error('down');
      },
    };
    const logs: string[] = [];
    const eta = await new ChainEta([broken, new EstimateEta()], (m) => logs.push(m)).eta(
      ORIGIN,
      offset(ORIGIN, 800, 0),
      'walk',
      new Date(),
    );
    expect(eta).toEqual({ minutes: 13, source: 'estimate' });
    expect(logs[0]).toMatch(/broken failed/);
  });

  test('a provider that hangs times out and the chain falls through', async () => {
    const hung: EtaProvider = { name: 'hung', eta: () => new Promise(() => {}) };
    const logs: string[] = [];
    const t0 = performance.now();
    const eta = await new ChainEta([hung, new EstimateEta()], (m) => logs.push(m), 100).eta(
      ORIGIN,
      offset(ORIGIN, 800, 0),
      'walk',
      new Date(),
    );
    expect(eta).toEqual({ minutes: 13, source: 'estimate' });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(logs[0]).toMatch(/hung eta timed out after 100 ms/);
  });

  test('fake llm returns category defaults and short labels', async () => {
    const llm = new FakeLlm();
    expect(
      await llm.stayLengths(
        [{ id: 'a', name: 'Met', category: 'culture', arrival: 'Sat 2 PM' }],
        {},
      ),
    ).toEqual([{ id: 'a', stayMin: 90, reason: 'Typical culture visit' }]);
    expect(
      (
        await llm.label({
          placeName: 'A Very Long Place Name Indeed Here',
          category: 'food',
          context: '',
        })
      ).split(' ').length,
    ).toBeLessThanOrEqual(6);
  });
});

describe('Gemini client', () => {
  const stub = (fail: Record<string, { status: number } | undefined>) => {
    const llm = new GeminiLlm('k', 'main-model', 'backup-model');
    const calls: { model: string; config: Record<string, unknown> }[] = [];
    (llm.ai.models as unknown as { generateContent: unknown }).generateContent = async (p: {
      model: string;
      config: Record<string, unknown>;
    }) => {
      calls.push(p);
      const err = fail[p.model];
      if (err) throw Object.assign(new Error(`{"error":{"code":${err.status}}}`), err);
      return { text: JSON.stringify({ label: `from ${p.model}` }) };
    };
    return { llm, calls };
  };
  const labelSchema = { type: 'object', properties: { label: { type: 'string' } } };

  test('an overloaded or out-of-quota model is retried once on the backup model', async () => {
    for (const status of [503, 429]) {
      const { llm, calls } = stub({ 'main-model': { status } });
      expect(await llm.json('x', labelSchema, [], 5000)).toEqual({ label: 'from backup-model' });
      expect(calls.map((c) => c.model)).toEqual(['main-model', 'backup-model']);
    }
  });

  test("budgets under Gemini's 10 s server minimum are enforced by an abort, not a server deadline", async () => {
    const { llm, calls } = stub({});
    await llm.json('x', labelSchema, [], 5000);
    expect(calls[0]!.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(calls[0]!.config).not.toHaveProperty('httpOptions');
  });

  test('other errors are not retried', async () => {
    const { llm, calls } = stub({ 'main-model': { status: 400 } });
    await expect(llm.json('x', labelSchema)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});

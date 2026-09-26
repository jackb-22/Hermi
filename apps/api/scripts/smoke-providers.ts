/**
 * Live check of every configured provider (run after adding a key to .env):
 *   pnpm --filter @itp/api exec tsx --env-file=../../.env scripts/smoke-providers.ts
 */
import { loadConfig } from '../src/config.ts';
import { createProviders, describeProviders } from '../src/providers/index.ts';

const p = createProviders(loadConfig());
const from = { lat: 40.8075, lng: -73.9626 }; // Columbia gate
const to = { lat: 40.8003, lng: -73.9582 }; // Morningside Park
console.log('providers', describeProviders(p));

const run = async (name: string, f: () => Promise<unknown>) => {
  const t0 = Date.now();
  try {
    const out = await f();
    console.log(`✓ ${name} (${Date.now() - t0}ms)`, JSON.stringify(out).slice(0, 300));
  } catch (e) {
    console.log(`✗ ${name}: ${(e as Error).message}`);
  }
};

await run('eta walk', () => p.eta.eta(from, to, 'walk', new Date(Date.now() + 3600_000)));
await run('eta transit', () =>
  p.eta.eta(from, { lat: 40.7411, lng: -74.0048 }, 'transit', new Date(Date.now() + 3600_000)),
);
await run('hours', () =>
  p.hours.hours({ name: 'Hungarian Pastry Shop', loc: { lat: 40.8036, lng: -73.9637 } }),
);
await run('weather', () => p.weather.daily(from));
await run('stay lengths', () =>
  p.llm.stayLengths(
    [
      { id: 's1', name: 'The Met', category: 'culture', arrival: 'Sat 2:00 PM' },
      { id: 's2', name: "Tom's Restaurant", category: 'food', arrival: 'Sat 5:00 PM' },
    ],
    {},
  ),
);
await run('label', () =>
  p.llm.label({
    placeName: 'Pier 45',
    category: 'nature',
    context: 'sunset in 40 minutes, clear sky',
  }),
);
await run('moderate', () => p.llm.moderate({ text: 'Best pierogi in the city, would go again' }));

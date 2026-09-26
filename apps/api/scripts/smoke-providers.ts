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
await run('ghost rerank', () =>
  p.llm.rerankGhosts(
    [
      {
        id: 'a',
        name: 'Pier 45',
        category: 'nature',
        tags: ['waterfront'],
        walkMin: 9,
        fallbackLabel: 'Stroll through Pier 45',
      },
      {
        id: 'b',
        name: 'Joe’s Pizza',
        category: 'food',
        tags: ['pizza'],
        walkMin: 4,
        fallbackLabel: 'Dinner at Joe’s Pizza',
      },
    ],
    'Leaving at Sat 6:10 PM; sunset Sat 6:45 PM; 68°F high, 10% chance of rain. Plan so far: Stonewall Inn (culture).',
  ),
);
await run('ask maps', () => p.llm.askMaps('Which cafes near here have outdoor seating?', from));
await run('function calling', () =>
  p.llm.runTools({
    system: 'Use the tool, then answer in one sentence.',
    prompt: 'What time is it in New York?',
    tools: [
      {
        name: 'now',
        description: 'Current New York time',
        parameters: { type: 'object', properties: {} },
      },
    ],
    exec: async () => new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
  }),
);
if (p.backboard.enabled)
  await run('backboard', async () => {
    const assistantId = await p.backboard.createAssistant('itp-smoke', 'Answer briefly.');
    await p.backboard.addMemory(assistantId, 'Prefers no museums before noon');
    return p.backboard.send({
      assistantId,
      content: 'What should I avoid scheduling?',
      systemPrompt: 'Answer briefly.',
      tools: [],
    });
  });

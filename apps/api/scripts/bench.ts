/**
 * Latency benchmark for the read endpoints the app hits most (map, social poll, feed, profile, ghosts), run
 * in-process against a seeded database. `--rtt` puts a TCP proxy in front of Mongo and Postgres that delays
 * every packet by half the round trip, so per-request database round trips show up the way they will against
 * Atlas and Tiger Cloud from App Platform.
 *
 *   pnpm --filter @itp/api exec tsx --env-file=../../.env scripts/bench.ts --user maya --rtt 6 --n 30
 *
 * Read-only: it signs in with the dev route and only issues GETs.
 */
import net from 'node:net';
import { parseArgs } from 'node:util';
import { buildApp } from '../src/app.ts';
import { closeContext, createContext } from '../src/boot.ts';
import { loadConfig } from '../src/config.ts';

const { values } = parseArgs({
  options: {
    user: { type: 'string', default: 'maya' },
    rtt: { type: 'string', default: '0' },
    n: { type: 'string', default: '30' },
    only: { type: 'string', default: '' },
  },
});
const RTT = Number(values.rtt);
const N = Number(values.n);

/** Forwards TCP to `target`, delaying each chunk by `ms` in both directions (order preserved). */
function delayProxy(target: { host: string; port: number }, ms: number): Promise<number> {
  const server = net.createServer((client) => {
    const upstream = net.connect(target);
    // Without this, Nagle plus delayed ACKs add their own ~40 ms stalls on top of the simulated latency.
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    const pipe = (from: net.Socket, to: net.Socket) =>
      from.on('data', (d) => setTimeout(() => to.write(d), ms));
    pipe(client, upstream);
    pipe(upstream, client);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', close).on('close', close);
    upstream.on('error', close).on('close', close);
  });
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () => r((server.address() as net.AddressInfo).port)),
  );
}

const env: Record<string, string | undefined> = {
  ...process.env,
  NODE_ENV: 'test',
  FAKE_PROVIDERS: '1',
  RUN_WORKER: 'off',
};
if (RTT > 0) {
  const mongo = new URL(env.MONGO_URI ?? 'mongodb://localhost:27017/?directConnection=true');
  const tiger = new URL(env.TIGER_URL ?? 'postgres://postgres:postgres@localhost:5432/itp');
  const mp = await delayProxy({ host: mongo.hostname, port: Number(mongo.port || 27017) }, RTT / 2);
  const tp = await delayProxy({ host: tiger.hostname, port: Number(tiger.port || 5432) }, RTT / 2);
  mongo.host = `127.0.0.1:${mp}`;
  mongo.searchParams.set('directConnection', 'true');
  tiger.host = `127.0.0.1:${tp}`;
  env.MONGO_URI = mongo.toString();
  env.TIGER_URL = tiger.toString();
}

const ctx = await createContext(loadConfig(env));
const app = await buildApp(ctx);
await app.ready();
const login = await app.inject({
  method: 'POST',
  url: '/v1/auth/dev',
  payload: { username: values.user },
});
const { token, user } = login.json();
const headers = { authorization: `Bearer ${token}` };
const place = await ctx.db
  .collection('places')
  .findOne({ name: { $exists: true }, been: { $gt: 0 } });
const plan = await ctx.db
  .collection('plans')
  .findOne({ hostId: user.id, status: { $ne: 'cancelled' } });

// Morningside Heights: a zoomed-in screen (~1 km) and a whole-borough screen (all of Manhattan).
const cases: [string, string][] = [
  ['places bbox (block)', '/v1/places?bbox=-73.970,40.800,-73.955,40.812&cat=all'],
  ['places bbox (borough)', '/v1/places?bbox=-74.03,40.70,-73.90,40.88&cat=all'],
  ['places bbox food (borough)', '/v1/places?bbox=-74.03,40.70,-73.90,40.88&cat=food'],
  ['places near', '/v1/places/near?lat=40.8075&lng=-73.9626&cat=food&r=400'],
  ...(place ? [['place sheet', `/v1/places/${place._id}`] as [string, string]] : []),
  ['social (30 s poll)', '/v1/social?bbox=-74.03,40.70,-73.90,40.88'],
  ['feed', '/v1/feed?lat=40.8075&lng=-73.9626'],
  ['profile me', '/v1/profile/me'],
  ['friends', '/v1/friends'],
  ['plans list', '/v1/plans?scope=all'],
  ['stats', '/v1/stats'],
  ['tiles', '/v1/tiles'],
  ['ghosts', '/v1/ghosts?lat=40.8075&lng=-73.9626'],
  ...(plan ? [['plan', `/v1/plans/${plan._id}`] as [string, string]] : []),
];

const pct = (xs: number[], p: number) =>
  xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!;
console.log(`user=${values.user} rtt=${RTT}ms n=${N}`);
console.log(`${'endpoint'.padEnd(28)} ${'p50 ms'.padStart(8)} ${'p90 ms'.padStart(8)}  status`);
for (const [name, url] of cases) {
  if (values.only && !name.includes(values.only)) continue;
  const times: number[] = [];
  let status = 0;
  for (let i = 0; i < N + 2; i++) {
    const t = performance.now();
    const r = await app.inject({ method: 'GET', url, headers });
    const dt = performance.now() - t;
    status = r.statusCode;
    if (i >= 2) times.push(dt); // first two warm caches and JIT
  }
  times.sort((a, b) => a - b);
  console.log(
    `${name.padEnd(28)} ${pct(times, 50).toFixed(1).padStart(8)} ${pct(times, 90).toFixed(1).padStart(8)}  ${status}`,
  );
}
await app.close();
await closeContext(ctx);
process.exit(0);

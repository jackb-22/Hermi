import { randomBytes } from 'node:crypto';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  classifyPlace,
  type Endpoint,
  hostOf,
  nonEmptyCollections,
  runFreshDb,
  sample,
} from '../scripts/lib/freshDb.ts';
import { fakeDataBlocker } from '../scripts/lib/noFakeData.ts';
import { loadConfig } from '../src/config.ts';
import { testSuffix } from './globalSetup.ts';
import { setupTestApp, testEnv } from './helpers.ts';

// itp_test_<time>_<rand> is the name globalSetup's stale sweep recognizes, so an interrupted run is cleaned up.
const scratch = () => `itp_test_${testSuffix(randomBytes(3).toString('hex'))}`;
const point = (lng: number, lat: number) => ({ type: 'Point', coordinates: [lng, lat] });
const place = (
  _id: string,
  name: string,
  lng: number,
  lat: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  _id,
  name,
  category: 'food',
  tags: ['coffee'],
  loc: point(lng, lat),
  confidence: 0.9,
  adultOnly: false,
  been: 0,
  wouldGoAgain: { yes: 0, total: 0 },
  createdAt: new Date('2026-09-01T12:00:00Z'),
  ...extra,
});

const NOW = new Date('2026-10-01T09:30:00Z');
const butler = place('p_butler', 'Butler Library', -73.9631, 40.8065, {
  overtureId: 'ov-butler',
  address: '535 W 114th St, New York',
  been: 12,
  wouldGoAgain: { yes: 3, total: 4 },
  reviewSummary: { text: 'Quiet and big.', count: 4, at: NOW },
  venueTagId: 'tag_butler',
  seed: true,
  hours: [{ open: '08:00', close: '23:00', day: 1 }],
  googlePlaceId: 'g_butler',
  someFutureField: { nested: [1, 2, 3] },
});
const cafe = place('p_cafe', 'Williamsburg Cafe', -73.9573, 40.7081, { overtureId: 'ov-cafe' });
const hall = place('p_hall', 'Demo Hall', -73.9639, 40.8069, { overtureId: 'demo-hall', been: 5 });
const fortLee = place('p_fortlee', 'Fort Lee Pizza', -73.9701, 40.8512, { overtureId: 'ov-fl' });
const weehawken = place('p_weehawken', 'Weehawken Deli', -74.02, 40.77, { overtureId: 'ov-wk' });
const intrepid = place('p_intrepid', 'USS Intrepid', -74.0008, 40.7648, { overtureId: 'ov-intr' });
const nowhere = place('p_nowhere', 'No Coordinates', 0, 0);
delete (nowhere as { loc?: unknown }).loc;

describe('classifyPlace', () => {
  test.each([
    ['a Columbia library', butler, 'nyc'],
    ['a Brooklyn cafe', cafe, 'nyc'],
    ['Demo Hall, wherever it sits', hall, 'demo-hall'],
    ['Fort Lee, across the river from Washington Heights', fortLee, 'new-jersey'],
    ['Weehawken', weehawken, 'new-jersey'],
    ['a ship moored on the Hudson, east of the state line', intrepid, 'outside-nyc'],
    ['no location at all', nowhere, 'no-location'],
    ['an impossible latitude', place('x', 'x', 0, 123), 'no-location'],
  ])('%s -> %s', (_why, doc, expected) => {
    expect(classifyPlace(doc as never)).toBe(expected);
  });
});

describe('hostOf', () => {
  test('keeps the scheme and hosts, never credentials, path or options', () => {
    expect(
      hostOf('mongodb+srv://jack:p%40ss@cluster0.ab1cd.mongodb.net/itp?retryWrites=true'),
    ).toBe('mongodb+srv://cluster0.ab1cd.mongodb.net');
    expect(hostOf('mongodb://u:p@a.example:27017,b.example:27017/?replicaSet=rs')).toBe(
      'mongodb://a.example:27017,b.example:27017',
    );
    // An unescaped @ in the password must not leak the part after it.
    expect(hostOf('mongodb://u:pa@ss@host.example/db')).toBe('mongodb://host.example');
    expect(hostOf('mongodb://localhost:27017/?directConnection=true')).toBe(
      'mongodb://localhost:27017',
    );
    expect(() => hostOf('postgres://x')).toThrow(/mongodb/);
  });
});

describe('sample', () => {
  test('spreads about n rows from north to south', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `${i}`, name: `r${i}`, lat: i }));
    const s = sample(rows, 10);
    expect(s).toHaveLength(10);
    expect(s[0]!.lat).toBe(99);
    expect(s[9]!.lat).toBeLessThan(15);
    expect(sample(rows.slice(0, 4), 10)).toHaveLength(4);
  });
});

describe('the fake-data guard', () => {
  test('production and the production database are refused, a demo database is not', () => {
    expect(fakeDataBlocker({ NODE_ENV: 'production', MONGO_DB: 'itp' })).toMatch(/production/);
    expect(fakeDataBlocker({ NODE_ENV: 'development', MONGO_DB: 'hermi' })).toMatch(/hermi/);
    expect(fakeDataBlocker({ NODE_ENV: 'production', MONGO_DB: 'hermi' })).toBeDefined();
    expect(fakeDataBlocker({ NODE_ENV: 'development', MONGO_DB: 'itp' })).toBeUndefined();
    expect(fakeDataBlocker({ NODE_ENV: 'test', MONGO_DB: 'itp_test_1' })).toBeUndefined();
  });
});

describe('fresh database copy', () => {
  const uri = loadConfig({ ...testEnv(), NODE_ENV: 'test' }).MONGO_URI;
  const client = new MongoClient(uri);
  const srcName = scratch();
  const dstName = scratch();
  const emptyName = scratch();
  // The label is display only: a password in the URI must never reach the output.
  const host = hostOf(`mongodb://user:hunter2-secret@${new URL(uri).host}/?directConnection=true`);
  const ep = (dbName: string): Endpoint => ({ client, dbName, host });
  const src = () => client.db(srcName);
  const dst = () => client.db(dstName);
  let lines: string[] = [];
  const run = (o: { apply?: boolean; force?: boolean; to?: string; from?: string } = {}) => {
    lines = [];
    return runFreshDb({
      source: ep(o.from ?? srcName),
      target: ep(o.to ?? dstName),
      apply: o.apply ?? false,
      force: o.force ?? false,
      log: (l) => lines.push(l),
    });
  };
  const dump = (db: Db, coll: string) => db.collection(coll).find().sort({ _id: 1 }).toArray();
  const dbNames = async () =>
    (await client.db().admin().listDatabases({ nameOnly: true })).databases.map((d) => d.name);
  const indexNames = async (db: Db) =>
    Object.fromEntries(
      await Promise.all(
        (await db.listCollections().toArray()).map(async (c) => [
          c.name,
          (await db.collection(c.name).indexes()).map((i) => i.name).sort(),
        ]),
      ),
    );

  let before: { places: unknown[]; users: unknown[]; plans: unknown[] };
  beforeAll(async () => {
    await client.connect();
    await src()
      .collection('places')
      .insertMany([butler, cafe, hall, fortLee, weehawken, intrepid, nowhere] as never[]);
    await src()
      .collection('users')
      .insertMany([
        { _id: 'u_maya', username: 'maya', seed: true },
        { _id: 'u_sam', username: 'sam', seed: true },
      ] as never[]);
    await src()
      .collection('plans')
      .insertOne({ _id: 'plan_1', hostId: 'u_maya' } as never);
    before = {
      places: await dump(src(), 'places'),
      users: await dump(src(), 'users'),
      plans: await dump(src(), 'plans'),
    };
  });
  afterAll(async () => {
    for (const name of [srcName, dstName, emptyName])
      await client
        .db(name)
        .dropDatabase()
        .catch(() => {});
    await client.close();
  });

  test('a dry run reports the plan and writes nothing', async () => {
    const report = await run();
    expect(report.applied).toBe(false);
    expect(report.blocked).toBeUndefined();
    expect(report.plan).toMatchObject({ total: 7, counterResets: 1 });
    expect(report.plan.demoHall.map((r) => r.name)).toEqual(['Demo Hall']);
    expect(report.plan.newJersey.map((r) => r.name).sort()).toEqual([
      'Fort Lee Pizza',
      'Weehawken Deli',
    ]);
    expect(report.plan.outsideNyc.map((r) => r.name)).toEqual(['USS Intrepid']);
    expect(report.plan.noLocation.map((r) => r.name)).toEqual(['No Coordinates']);
    // A person can sanity-check the New Jersey rows: name and coordinates are printed.
    const text = lines.join('\n');
    expect(text).toMatch(/Fort Lee Pizza\s+\(40\.85120, -73\.97010\)/);
    expect(text).toContain('source mongodb://');
    expect(text).toContain('DRY RUN');
    expect(text).not.toContain('hunter2');
    // Nothing was created, not even the target database, and the source is untouched.
    expect(await dbNames()).not.toContain(dstName);
    expect(await dump(src(), 'places')).toEqual(before.places);
  });

  test('refuses the same database as source and target, and a source with no places', async () => {
    await expect(run({ to: srcName })).rejects.toThrow(/same database/);
    await expect(run({ from: emptyName })).rejects.toThrow(/no places/);
    expect(await dbNames()).not.toContain(dstName);
    expect(await dbNames()).not.toContain(emptyName);
  });

  test('apply copies only places, minus Demo Hall and New Jersey, with counters reset', async () => {
    const report = await run({ apply: true });
    expect(report).toMatchObject({ applied: true, ok: true, copied: 7, dropped: 3, places: 4 });
    expect(report.countersReset).toBe(1);
    expect(report.has2dsphere).toBe(true);
    expect(report.strays).toEqual([]);

    // Only places holds data; the other collections exist (created like the API's boot does) but are empty.
    expect(await nonEmptyCollections(dst())).toEqual([{ name: 'places', count: 4 }]);
    const names = (await dst().listCollections().toArray()).map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['places', 'users', 'plans', 'posts', 'sessions']),
    );
    expect(await dst().collection('users').countDocuments()).toBe(0);
    expect(await dst().collection('plans').countDocuments()).toBe(0);

    const copied = await dump(dst(), 'places');
    expect(copied.map((p) => p._id)).toEqual(['p_butler', 'p_cafe', 'p_intrepid', 'p_nowhere']);
    expect(await dst().collection('places').countDocuments({ overtureId: 'demo-hall' })).toBe(0);

    // _id and every other field survive; only the counters and demo marks change.
    const { reviewSummary, venueTagId, seed, ...rest } = butler;
    expect(copied[0]).toEqual({ ...rest, been: 0, wouldGoAgain: { yes: 0, total: 0 } });
    expect(copied[0]).not.toHaveProperty('reviewSummary');
    expect(copied[0]).not.toHaveProperty('venueTagId');
    expect(copied[0]).not.toHaveProperty('seed');
    expect(copied[1]).toEqual(before.places.find((p) => (p as { _id: string })._id === 'p_cafe'));

    const geo = (await dst().collection('places').indexes()).filter(
      (i) => i.key.loc === '2dsphere',
    );
    expect(geo.length).toBeGreaterThan(0);
    expect(
      (await dst().collection('places').indexes()).find((i) => i.key.overtureId === 1)?.unique,
    ).toBe(true);

    // The source was only read.
    expect(await dump(src(), 'places')).toEqual(before.places);
    expect(await dump(src(), 'users')).toEqual(before.users);
    expect(await dump(src(), 'plans')).toEqual(before.plans);
    expect(lines.join('\n')).not.toContain('hunter2');
  });

  test('a target that already holds data is refused unless --force', async () => {
    const copied = await dump(dst(), 'places');
    await expect(run({ apply: true })).rejects.toThrow(/not empty \(places\).*--force/);
    // A dry run says so too, without throwing.
    const dry = await run();
    expect(dry.blocked).toMatch(/not empty/);
    expect(dry.ok).toBe(false);
    expect(await dump(dst(), 'places')).toEqual(copied);

    // --force resumes: same result, no duplicates.
    const again = await run({ apply: true, force: true });
    expect(again).toMatchObject({ ok: true, places: 4 });
    expect(await dump(dst(), 'places')).toEqual(copied);
  });

  test('--force reports data in another collection instead of hiding it', async () => {
    await dst()
      .collection('users')
      .insertOne({ _id: 'u_stray' } as never);
    const report = await run({ apply: true, force: true });
    expect(report.ok).toBe(false);
    expect(report.strays).toEqual([{ name: 'users', count: 1 }]);
    expect(lines.join('\n')).toMatch(/PROBLEM: collections besides places hold data: users/);
    await dst().collection('users').deleteMany({});
  });

  test('the API booting on the prepared database changes nothing', async () => {
    const places = await dump(dst(), 'places');
    const indexes = await indexNames(dst());
    const collections = (await dst().listCollections().toArray()).map((c) => c.name).sort();
    // setupTestApp boots exactly like production: createContext + ensureSchema (Mongo indexes and Tiger).
    const t = await setupTestApp({ MONGO_DB: dstName });
    try {
      expect(await dump(dst(), 'places')).toEqual(places);
      expect(await indexNames(dst())).toEqual(indexes);
      expect((await dst().listCollections().toArray()).map((c) => c.name).sort()).toEqual(
        collections,
      );
    } finally {
      await t.teardown();
    }
  });
});

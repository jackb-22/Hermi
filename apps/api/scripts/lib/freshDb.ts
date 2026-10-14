/**
 * The logic of scripts/fresh-db.ts (copy `places` into a new database for production), importable so a test can
 * drive it without spawning a process. Writes only ever go to the target; the source is only read.
 */
import { latLngToTile } from '@itp/shared';
import type { AnyBulkWriteOperation, Collection, Db, MongoClient } from 'mongodb';
import { ensureMongoIndexes } from '../../src/db/indexes.ts';
import type { PlaceDoc } from '../../src/db/placeTypes.ts';
import { boroughOf } from '../../src/services/boroughs.ts';

/** Demo-only fields (`seed`) are not in the app's type. */
type Place = PlaceDoc & { seed?: boolean };

export const DEMO_HALL_ID = 'demo-hall';
const BATCH = 1000;

/**
 * New Jersey west of the Hudson, as far as the old Manhattan-box import (lng -74.02..-73.91, lat 40.70..40.88)
 * could have reached: the state line, running north, then closed on the other sides well outside that box.
 * The state line is Overture's division_area for region US-NJ (class maritime), simplified to about 10 m.
 * Checked against the Overture address region of every place in the NYC download (see the notes in fresh-db.ts).
 */
const NJ_BANK: [number, number][] = [
  [-74.3, 40.7001],
  [-74.0264, 40.7001],
  [-74.0214, 40.7275],
  [-74.0142, 40.7566],
  [-74.0016, 40.7745],
  [-73.993, 40.7864],
  [-73.9847, 40.7977],
  [-73.9771, 40.808],
  [-73.9677, 40.8208],
  [-73.9615, 40.831],
  [-73.9558, 40.8445],
  [-73.9528, 40.851],
  [-73.9488, 40.8577],
  [-73.9342, 40.8815],
  [-73.9298, 40.8887],
  [-73.9271, 40.8955],
  [-73.9189, 40.9161],
  [-73.9143, 40.928],
  [-73.9139, 40.93],
  [-74.3, 40.93],
];

const inRing = (x: number, y: number, r: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export type PlaceClass = 'nyc' | 'demo-hall' | 'new-jersey' | 'outside-nyc' | 'no-location';

const isCoord = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Math.abs(v) <= max;

/**
 * demo-hall and new-jersey are dropped. Everything else is kept: nyc is inside a borough's land tiles (the rule
 * import-overture.ts applies), outside-nyc is outside them but not provably New Jersey (a Hudson pier, Central
 * Park's lake, Long Island), and no-location has no usable coordinates. The last two are reported, never deleted.
 */
export function classifyPlace(p: Pick<PlaceDoc, 'overtureId' | 'loc'>): PlaceClass {
  if (p.overtureId === DEMO_HALL_ID) return 'demo-hall';
  const [lng, lat] = p.loc?.coordinates ?? [];
  if (!isCoord(lng, 180) || !isCoord(lat, 90)) return 'no-location';
  if (boroughOf(latLngToTile({ lat, lng }))) return 'nyc';
  return inRing(lng, lat, NJ_BANK) ? 'new-jersey' : 'outside-nyc';
}

export interface Row {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
}

export interface Plan {
  total: number;
  demoHall: Row[];
  newJersey: Row[];
  outsideNyc: Row[];
  noLocation: Row[];
  /** Rows that stay but still carry visit counters, a review summary, a venue tag or a seed mark. */
  counterResets: number;
}

const needsReset = (p: Place) =>
  p.been !== 0 ||
  p.wouldGoAgain?.yes !== 0 ||
  p.wouldGoAgain?.total !== 0 ||
  p.reviewSummary !== undefined ||
  p.venueTagId !== undefined ||
  p.seed !== undefined;

/** Classifies every place in a collection (reads only). */
export async function scanPlaces(coll: Collection<Place>): Promise<Plan> {
  const plan: Plan = {
    total: 0,
    demoHall: [],
    newJersey: [],
    outsideNyc: [],
    noLocation: [],
    counterResets: 0,
  };
  const projection = {
    name: 1,
    loc: 1,
    overtureId: 1,
    been: 1,
    wouldGoAgain: 1,
    reviewSummary: 1,
    venueTagId: 1,
    seed: 1,
  };
  for await (const p of coll.find({}, { projection })) {
    plan.total++;
    const kind = classifyPlace(p);
    const [lng, lat] = p.loc?.coordinates ?? [];
    const row: Row = { id: p._id, name: p.name ?? '(no name)', lat, lng };
    if (kind === 'demo-hall') plan.demoHall.push(row);
    else if (kind === 'new-jersey') plan.newJersey.push(row);
    else {
      if (kind === 'outside-nyc') plan.outsideNyc.push(row);
      if (kind === 'no-location') plan.noLocation.push(row);
      if (needsReset(p)) plan.counterResets++;
    }
  }
  return plan;
}

/** About n rows spread evenly north to south, so a person sees the whole set and not one corner of it. */
export function sample(rows: Row[], n = 10): Row[] {
  const sorted = [...rows].sort((a, b) => (b.lat ?? 0) - (a.lat ?? 0));
  if (sorted.length <= n) return sorted;
  return Array.from({ length: n }, (_, i) => sorted[Math.floor((i * sorted.length) / n)]!);
}

/** `mongodb+srv://cluster0.abc.mongodb.net`: the scheme and host of a URI, never its credentials or options. */
export function hostOf(uri: string): string {
  const m = /^(mongodb(?:\+srv)?):\/\/([^/?]*)/i.exec(uri.trim());
  if (!m) throw new Error('not a mongodb:// or mongodb+srv:// URI');
  const authority = m[2]!;
  return `${m[1]!.toLowerCase()}://${authority.slice(authority.lastIndexOf('@') + 1)}`;
}

export interface Endpoint {
  client: MongoClient;
  dbName: string;
  /** hostOf(uri), for display and the same-database check. */
  host: string;
}

export interface Stray {
  name: string;
  count: number;
}

/** Collections that hold at least one document (empty ones, like those created at boot, don't count). */
export async function nonEmptyCollections(db: Db): Promise<Stray[]> {
  const out: Stray[] = [];
  for (const { name } of await db
    .listCollections({ type: 'collection' }, { nameOnly: true })
    .toArray()) {
    if (name.startsWith('system.')) continue;
    const count = await db.collection(name).countDocuments({});
    if (count) out.push({ name, count });
  }
  return out;
}

/** A replica set's name, or a standalone's address: equal for two URIs that reach the same cluster. */
async function serverIdentity(client: MongoClient) {
  const hello = await client.db('admin').command({ hello: 1 });
  return String(hello.setName ?? hello.me);
}

async function assertDifferentDb(source: Endpoint, target: Endpoint) {
  if (source.dbName !== target.dbName) return;
  const same = (why: string) => {
    throw new Error(`source and target are the same database (${source.dbName}${why})`);
  };
  if (source.client === target.client) same('');
  if (source.host.toLowerCase() === target.host.toLowerCase()) same(` on ${source.host}`);
  if ((await serverIdentity(source.client)) === (await serverIdentity(target.client)))
    same(', reached through two different URIs');
}

export interface RunOptions {
  source: Endpoint;
  target: Endpoint;
  apply: boolean;
  /** Write into a target that already holds data (a copy that was interrupted can be resumed). */
  force: boolean;
  log?: (line: string) => void;
}

export interface Report {
  applied: boolean;
  /** What the source holds and what would happen to it. */
  plan: Plan;
  /** Non-empty collections the target had before this run. */
  targetData: Stray[];
  /** Why --apply refuses (set in a dry run too, so the operator learns it before applying). */
  blocked?: string;
  copied: number;
  dropped: number;
  countersReset: number;
  /** Target after an apply: places, any other non-empty collection, and whether the geo index exists. */
  places: number;
  strays: Stray[];
  has2dsphere: boolean;
  /** Dry run: nothing blocks it. Apply: the target holds only clean places and the geo index. */
  ok: boolean;
}

const n = (x: number) => x.toLocaleString('en-US');
const where = (r: Row) =>
  r.lat === undefined || r.lng === undefined
    ? `${r.name}  (no coordinates)`
    : `${r.name}  (${r.lat.toFixed(5)}, ${r.lng.toFixed(5)})`;

function printPlan(log: (l: string) => void, plan: Plan, targetData: Stray[]) {
  const dropped = plan.demoHall.length + plan.newJersey.length;
  const list = (title: string, rows: Row[]) => {
    log(title);
    for (const r of sample(rows)) log(`      ${where(r)}`);
  };
  log(`source places: ${n(plan.total)}`);
  log(
    plan.demoHall.length
      ? `  Demo Hall (overtureId '${DEMO_HALL_ID}'): found ${plan.demoHall.length} -> dropped`
      : `  Demo Hall (overtureId '${DEMO_HALL_ID}'): not found`,
  );
  log(`  New Jersey rows: ${n(plan.newJersey.length)} -> dropped`);
  if (plan.newJersey.length) list('    samples, north to south (lat, lng):', plan.newJersey);
  if (plan.outsideNyc.length) {
    log(
      `  outside the boroughs but not New Jersey: ${n(plan.outsideNyc.length)} -> kept, check them`,
    );
    list('    samples (lat, lng):', plan.outsideNyc);
  }
  if (plan.noLocation.length)
    log(`  without usable coordinates: ${n(plan.noLocation.length)} -> kept, check them`);
  log(`  counters reset on ${n(plan.counterResets)} kept places`);
  log(`places the target will hold: ${n(plan.total - dropped)}`);
  log(
    targetData.length
      ? `target already holds data: ${targetData.map((c) => `${c.name} (${n(c.count)})`).join(', ')}`
      : 'target is empty (or does not exist yet)',
  );
}

export async function runFreshDb(o: RunOptions): Promise<Report> {
  const log = o.log ?? console.log;
  await assertDifferentDb(o.source, o.target);
  const sourceDb = o.source.client.db(o.source.dbName);
  const targetDb = o.target.client.db(o.target.dbName);
  const from = sourceDb.collection<Place>('places');
  const to = targetDb.collection<Place>('places');

  log(o.apply ? 'Fresh database: APPLY' : 'Fresh database: DRY RUN, nothing is written');
  log(`  source ${o.source.host}  db=${o.source.dbName}`);
  log(`  target ${o.target.host}  db=${o.target.dbName}`);

  const plan = await scanPlaces(from);
  if (plan.total === 0)
    throw new Error(`${o.source.dbName} has no places (is --from the right database?)`);
  const targetData = await nonEmptyCollections(targetDb);
  const blocked =
    targetData.length && !o.force
      ? `target ${o.target.dbName} is not empty (${targetData.map((c) => c.name).join(', ')}); ` +
        'pass --force to write into it anyway'
      : undefined;
  printPlan(log, plan, targetData);

  const report: Report = {
    applied: false,
    plan,
    targetData,
    blocked,
    copied: 0,
    dropped: 0,
    countersReset: 0,
    places: 0,
    strays: [],
    has2dsphere: false,
    ok: !blocked,
  };
  if (!o.apply) {
    log(blocked ? `--apply would refuse: ${blocked}` : 'Dry run only. Add --apply to write.');
    return report;
  }
  if (blocked) throw new Error(blocked);

  // 1. Copy every field of every place, _id included. Upserts, so a resumed copy leaves no duplicates.
  let batch: AnyBulkWriteOperation<Place>[] = [];
  const flush = async () => {
    if (!batch.length) return;
    await to.bulkWrite(batch, { ordered: false });
    report.copied += batch.length;
    batch = [];
    if (report.copied % (10 * BATCH) === 0) log(`  copied ${n(report.copied)} of ${n(plan.total)}`);
  };
  for await (const { _id, ...replacement } of from.find({}).batchSize(BATCH)) {
    batch.push({ replaceOne: { filter: { _id }, replacement, upsert: true } });
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  log(`copied ${n(report.copied)} places`);

  // 2. Drop Demo Hall and the New Jersey rows from the target (the source is never written).
  const doomed = await scanPlaces(to);
  const ids = [...doomed.demoHall, ...doomed.newJersey].map((r) => r.id);
  for (let i = 0; i < ids.length; i += BATCH)
    report.dropped += (await to.deleteMany({ _id: { $in: ids.slice(i, i + BATCH) } })).deletedCount;
  log(`dropped ${n(report.dropped)} (Demo Hall and New Jersey)`);

  // 3. Counters and demo marks back to a place nobody has visited.
  report.countersReset = (
    await to.updateMany(
      {},
      {
        $set: { been: 0, wouldGoAgain: { yes: 0, total: 0 } },
        $unset: { reviewSummary: '', venueTagId: '', seed: '' },
      },
    )
  ).modifiedCount;
  log(`counters reset on ${n(report.countersReset)} places`);

  // 4. The indexes the API builds at boot, so `places` has its 2dsphere index before the first request.
  await ensureMongoIndexes(targetDb, (m) => log(`  ${m}`));

  // 5. What is in the target now.
  const after = await scanPlaces(to);
  report.applied = true;
  report.places = after.total;
  report.strays = (await nonEmptyCollections(targetDb)).filter((c) => c.name !== 'places');
  report.has2dsphere = (await to.indexes()).some((i) => i.key.loc === '2dsphere');
  const leftover = after.demoHall.length + after.newJersey.length + after.counterResets;
  report.ok = after.total > 0 && leftover === 0 && report.strays.length === 0 && report.has2dsphere;

  const planned = plan.total - plan.demoHall.length - plan.newJersey.length;
  log(`target ${o.target.dbName} now: ${n(after.total)} places (the plan said ${n(planned)})`);
  log(`  2dsphere index on places.loc: ${report.has2dsphere ? 'yes' : 'MISSING'}`);
  if (leftover) log(`  PROBLEM: ${leftover} Demo Hall, New Jersey or unreset rows remain`);
  if (report.strays.length)
    log(
      `  PROBLEM: collections besides places hold data: ${report.strays.map((c) => c.name).join(', ')}`,
    );
  log(report.ok ? 'Done: the target holds only places.' : 'NOT clean: see the problems above.');
  return report;
}

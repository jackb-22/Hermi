/**
 * Starts production on fresh data (docs/DEPLOYMENT.md T4): copies only `places` from the demo database into a
 * new one (default itp -> hermi), minus Demo Hall and the stale New Jersey rows, with every counter back to
 * zero, then builds the API's indexes. Users, plans, posts, tags and the rest are never copied.
 *
 * The source URI is MONGO_URI from the env file (never typed here or stored in the script). Run from a laptop
 * against Atlas, first the dry run, which prints counts and samples and writes nothing, then the same with --apply:
 *
 *   pnpm --filter @itp/api exec tsx --env-file=../../.env.demo scripts/fresh-db.ts
 *   pnpm --filter @itp/api exec tsx --env-file=../../.env.demo scripts/fresh-db.ts --apply
 *
 * Options:
 *   --from itp      source database (the URI's cluster is never written to)
 *   --to hermi      target database; refused when it equals the source on the same cluster
 *   --to-uri URI    target on another cluster (or env TARGET_MONGO_URI, which keeps the password out of the
 *                   shell history); default is the source cluster
 *   --apply         write; without it nothing is written
 *   --force         write into a target that already holds data (resumes an interrupted copy; it removes
 *                   nothing else, so any stray collection is reported at the end)
 *
 * The Atlas user needs read on the source and readWrite on the target database. Copying ~65k places is ~65k
 * writes, which Atlas M0 (100 ops/s) and Flex (500 ops/s) throttle: expect a few minutes, not seconds. It is
 * safe to rerun with --force if it is interrupted.
 *
 * Which rows go (decided on the target after the copy, by scripts/lib/freshDb.ts, shown in the dry run):
 *  - Demo Hall: overtureId 'demo-hall', the plan's filter.
 *  - New Jersey: outside every borough's land tiles (boroughOf, the rule import-overture.ts applies today) AND
 *    west of the NY/NJ state line within the box the old Manhattan import covered. Places keep no state or
 *    region (only "street, locality"), so an address rule is impossible, and a longitude cut fails: Fort Lee
 *    (-73.96) lies east of Tribeca's piers (-74.01). Checked against the Overture address region of every
 *    place in the NYC download: all 1,881 rows that import's Manhattan box left outside the boroughs and in the
 *    polygon are NJ, none are NY, and none of that box's NJ rows were missed. Residual risk: a real NJ row
 *    outside the polygon (south of lat 40.70, e.g. Bayonne) is not recognized, so it is kept.
 *  - Outside the boroughs but not New Jersey (about 140 Hudson/East River piers, Central Park's lake, ...): kept
 *    and listed in the dry run, because they are real places that only fail the land-tile test (water-centered
 *    tiles). Rows with no usable coordinates are kept and listed too. Nothing unclassified is deleted.
 */
import { parseArgs } from 'node:util';
import { MongoClient } from 'mongodb';
import { hostOf, runFreshDb } from './lib/freshDb.ts';
import { PRODUCTION_DB } from './lib/noFakeData.ts';

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: 'itp' },
    to: { type: 'string', default: PRODUCTION_DB },
    'to-uri': { type: 'string' },
    apply: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
});

const fromUri = process.env.MONGO_URI;
if (!fromUri) {
  console.error(
    'MONGO_URI is not set: pass the env file that holds the source cluster (--env-file=...)',
  );
  process.exit(2);
}
const toUri = values['to-uri'] ?? process.env.TARGET_MONGO_URI ?? fromUri;

const source = new MongoClient(fromUri);
const target = toUri === fromUri ? source : new MongoClient(toUri);
let code = 1;
try {
  const report = await runFreshDb({
    source: { client: source, dbName: values.from!, host: hostOf(fromUri) },
    target: { client: target, dbName: values.to!, host: hostOf(toUri) },
    apply: values.apply,
    force: values.force,
  });
  code = report.ok ? 0 : 1;
} catch (err) {
  console.error(`Refused: ${(err as Error).message}`);
} finally {
  await Promise.allSettled([source.close(), target.close()]);
}
process.exit(code);

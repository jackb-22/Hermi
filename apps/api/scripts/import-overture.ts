/**
 * Loads Overture places (geojsonseq from `overturemaps download --type=place`) into MongoDB `places`,
 * mapped onto the seven pin types. Idempotent: upserts by overtureId.
 *
 *   uvx --python 3.12 overturemaps download --no-stac --bbox=-74.02,40.70,-73.91,40.88 \
 *     -f geojsonseq --type=place -o apps/api/data/manhattan_places.geojsonseq
 *   pnpm --filter @itp/api exec tsx --env-file=../../.env scripts/import-overture.ts data/manhattan_places.geojsonseq
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { newId } from '@itp/shared';
import type { AnyBulkWriteOperation } from 'mongodb';
import { closeContext, createContext, ensureSchema } from '../src/boot.ts';
import type { PlaceDoc } from '../src/db/placeTypes.ts';
import { mapOvertureCategory } from '../src/domain/overtureCategories.ts';

const MIN_CONFIDENCE = 0.6;
const file = process.argv[2];
if (!file) throw new Error('usage: import-overture.ts <file.geojsonseq>');

const ctx = await createContext();
await ensureSchema(ctx);
const places = ctx.db.collection<PlaceDoc>('places');

let read = 0;
let kept = 0;
let batch: AnyBulkWriteOperation<PlaceDoc>[] = [];
const flush = async () => {
  if (batch.length) await places.bulkWrite(batch, { ordered: false });
  batch = [];
};

const rl = createInterface({ input: createReadStream(file), crlfDelay: Number.POSITIVE_INFINITY });
for await (const raw of rl) {
  const line = raw.replace(/^\x1e/, '').trim();
  if (!line) continue;
  read++;
  const f = JSON.parse(line);
  const p = f.properties ?? {};
  const name: string | undefined = p.names?.primary;
  if (!name || (p.confidence ?? 0) < MIN_CONFIDENCE) continue;
  if (p.operating_status && p.operating_status !== 'open') continue;
  const mapped = mapOvertureCategory(p.taxonomy?.primary ?? p.categories?.primary, p.basic_category);
  if (!mapped) continue;
  const a = p.addresses?.[0];
  kept++;
  batch.push({
    updateOne: {
      filter: { overtureId: f.id },
      update: {
        $set: {
          name,
          category: mapped.category,
          tags: mapped.tags,
          adultOnly: !!mapped.adultOnly,
          loc: { type: 'Point', coordinates: f.geometry.coordinates },
          address: a?.freeform ? `${a.freeform}${a.locality ? `, ${a.locality}` : ''}` : undefined,
          confidence: p.confidence,
        },
        $setOnInsert: { _id: newId(), been: 0, wouldGoAgain: { yes: 0, total: 0 }, createdAt: new Date() },
      },
      upsert: true,
    },
  });
  if (batch.length >= 1000) await flush();
}
await flush();

// The live check-in at the demo table needs a place at the venue's coordinates.
const hallLat = Number(process.env.DEMO_HALL_LAT ?? 40.8069);
const hallLng = Number(process.env.DEMO_HALL_LNG ?? -73.9639);
await places.updateOne(
  { overtureId: 'demo-hall' },
  {
    $set: { name: 'Demo Hall', category: 'culture', tags: ['indoor'], adultOnly: false, confidence: 1, loc: { type: 'Point', coordinates: [hallLng, hallLat] } },
    $setOnInsert: { _id: newId(), been: 0, wouldGoAgain: { yes: 0, total: 0 }, createdAt: new Date() },
  },
  { upsert: true },
);

const byCat = await places.aggregate([{ $group: { _id: '$category', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
console.log(`read ${read}, kept ${kept}`, byCat);
await closeContext(ctx);

/**
 * Precomputes the zoom-18 tile set of each NYC borough (tile center inside the land polygon), stored as
 * per-row x ranges so "6% of Manhattan colored" is a lookup. Source: Overture division_area (counties).
 *
 *   uvx --python 3.12 overturemaps download --no-stac --bbox=-74.26,40.49,-73.70,40.92 -f geojsonseq --type=division_area -o data/nyc_divisions.geojsonseq
 *   uvx --python 3.12 overturemaps download --no-stac --bbox=-74.26,40.49,-73.70,40.92 -f geojsonseq --type=water -o data/nyc_water.geojsonseq
 *   tsx scripts/build-borough-tiles.ts data/nyc_divisions.geojsonseq data/nyc_water.geojsonseq
 *
 * County polygons include the rivers and bays around them, so tiles whose center is in water are dropped.
 */
import { writeFileSync } from 'node:fs';
import { latLngToTile, tileToLatLng } from '@itp/shared';
import { readGeojsonseq } from './lib/geojsonseq.ts';

const COUNTIES: Record<string, string> = {
  'New York County': 'Manhattan',
  'Kings County': 'Brooklyn',
  'Queens County': 'Queens',
  'Bronx County': 'Bronx',
  'Richmond County': 'Staten Island',
};

type Ring = [number, number][];
const inRing = (x: number, y: number, r: Ring) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPolygon = (x: number, y: number, rings: Ring[]) =>
  inRing(x, y, rings[0]!) && !rings.slice(1).some((h) => inRing(x, y, h));

// Water polygons (rivers, bays, lakes, reservoirs) with bounding boxes for a quick reject.
const WATER_SUBTYPES = new Set(['river', 'water', 'lake', 'reservoir', 'ocean', 'canal']);
const water: { rings: Ring[]; box: [number, number, number, number] }[] = [];
for (const f of readGeojsonseq(process.argv[3]!)) {
  if (!WATER_SUBTYPES.has(f.properties.subtype) || f.properties.class === 'swimming_pool') continue;
  const polys: Ring[][] =
    f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates]
      : f.geometry.type === 'MultiPolygon'
        ? f.geometry.coordinates
        : [];
  for (const rings of polys) {
    const xs = rings[0]!.map((c) => c[0]);
    const ys = rings[0]!.map((c) => c[1]);
    water.push({
      rings,
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    });
  }
}
const inWater = (x: number, y: number) =>
  water.some(
    (w) =>
      x >= w.box[0] && x <= w.box[2] && y >= w.box[1] && y <= w.box[3] && inPolygon(x, y, w.rings),
  );

const out: Record<string, { total: number; rows: Record<number, [number, number][]> }> = {};
for (const f of readGeojsonseq(process.argv[2]!)) {
  const p = f.properties;
  const name = COUNTIES[p.names?.primary];
  if (!name || p.subtype !== 'county' || p.region !== 'US-NY' || p.class !== 'land') continue;
  const polys: Ring[][] =
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const all = polys.flatMap((poly) => poly[0]!);
  const lngs = all.map((c) => c[0]);
  const lats = all.map((c) => c[1]);
  const nw = latLngToTile({ lat: Math.max(...lats), lng: Math.min(...lngs) });
  const se = latLngToTile({ lat: Math.min(...lats), lng: Math.max(...lngs) });
  const rows: Record<number, [number, number][]> = {};
  let total = 0;
  for (let y = nw.y; y <= se.y; y++) {
    let run: [number, number] | null = null;
    for (let x = nw.x; x <= se.x + 1; x++) {
      const a = tileToLatLng({ x, y });
      const b = tileToLatLng({ x: x + 1, y: y + 1 });
      const cx = (a.lng + b.lng) / 2;
      const cy = (a.lat + b.lat) / 2;
      const hit = x <= se.x && polys.some((poly) => inPolygon(cx, cy, poly)) && !inWater(cx, cy);
      if (hit) {
        total++;
        if (run) run[1] = x;
        else run = [x, x];
      } else if (run) {
        rows[y] = [...(rows[y] ?? []), run];
        run = null;
      }
    }
  }
  out[name] = { total, rows };
  console.log(`${name}: ${total} tiles`);
}
writeFileSync(new URL('../src/data/boroughTiles.json', import.meta.url), JSON.stringify(out));

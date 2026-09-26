import type { Tile } from '@itp/shared';
import data from '../data/boroughTiles.json' with { type: 'json' };

type Rows = Record<string, [number, number][]>;
const BOROUGHS = data as unknown as Record<string, { total: number; rows: Rows }>;
export const BOROUGH_ORDER = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];

export function boroughOf(t: Tile): string | null {
  for (const name of BOROUGH_ORDER) {
    const runs = BOROUGHS[name]?.rows[t.y];
    if (runs?.some(([a, b]) => t.x >= a && t.x <= b)) return name;
  }
  return null;
}

/** Colored tiles over each borough's land tile count. */
export function boroughStats(tiles: Tile[]) {
  const colored = new Map<string, number>();
  for (const t of tiles) {
    const b = boroughOf(t);
    if (b) colored.set(b, (colored.get(b) ?? 0) + 1);
  }
  return BOROUGH_ORDER.map((name) => {
    const total = BOROUGHS[name]!.total;
    const c = colored.get(name) ?? 0;
    return { name, colored: c, total, pct: Math.round((1000 * c) / total) / 10 };
  });
}

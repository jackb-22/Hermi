import { readFileSync } from 'node:fs';

// biome-ignore lint/suspicious/noExplicitAny: third-party GeoJSON with open-ended properties, read by one-off scripts
type Loose = any;
export interface Feature {
  id?: string;
  properties: Record<string, Loose>;
  geometry: { type: string; coordinates: Loose };
}

const RS = String.fromCharCode(0x1e);

/** Features from a GeoJSON text sequence file (records may start with the RS 0x1E separator). */
export function readGeojsonseq(path: string): Feature[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => (l.startsWith(RS) ? l.slice(1) : l).trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

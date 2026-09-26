import { type PinType, type Tag, newId } from '@itp/shared';
import type { Db } from 'mongodb';
import type { PlaceDoc } from '../../src/db/placeTypes.ts';

/** Columbia's main gate on Broadway; fixtures sit around it. */
export const ORIGIN = { lat: 40.8075, lng: -73.9626 };

/** Offset a point by meters north/east. */
export function offset(p: { lat: number; lng: number }, northM: number, eastM: number) {
  return { lat: p.lat + northM / 111_195, lng: p.lng + eastM / (111_195 * Math.cos((p.lat * Math.PI) / 180)) };
}

export function placeDoc(o: { name: string; category: PinType; tags?: Tag[]; at: { lat: number; lng: number }; adultOnly?: boolean; been?: number }): PlaceDoc {
  return {
    _id: newId(),
    name: o.name,
    category: o.category,
    tags: o.tags ?? [],
    loc: { type: 'Point', coordinates: [o.at.lng, o.at.lat] },
    confidence: 0.9,
    adultOnly: !!o.adultOnly,
    been: o.been ?? 0,
    wouldGoAgain: { yes: 0, total: 0 },
    createdAt: new Date(),
  };
}

export async function insertPlaces(db: Db, docs: PlaceDoc[]) {
  await db.collection<PlaceDoc>('places').insertMany(docs);
  return docs;
}

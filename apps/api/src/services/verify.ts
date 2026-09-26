import { fromGeoJSONPoint } from '@itp/shared';
import type { VerifySchema } from '@itp/shared/api';
import type { z } from 'zod';
import type { AppContext } from '../context.ts';
import { getCheckin, media } from './media.ts';
import { places } from './places.ts';
import { users } from './users.ts';

/** Public credential for a capture: only once it has been posted (captures stay private until the recap). */
export async function verifyInfo(
  ctx: AppContext,
  sha256: string,
): Promise<z.infer<typeof VerifySchema> | null> {
  const m = await media(ctx.db).findOne({ sha256, status: 'verified', posted: true });
  if (!m) return null;
  const [c, place, author] = await Promise.all([
    getCheckin(ctx.tiger, m.checkinId),
    places(ctx.db).findOne({ _id: m.placeId }),
    users(ctx.db).findOne({ _id: m.userId }),
  ]);
  if (!c || !place) return null;
  return {
    sha256: m.sha256,
    verified: true,
    kind: m.kind,
    place: { name: place.name, loc: fromGeoJSONPoint(place.loc) },
    capturedAt: m.capturedAt.toISOString(),
    checkin: { tier: c.tier, at: c.time.toISOString(), attested: c.attested },
    capturedInApp: true,
    author: { username: author?.username ?? null },
    credential: {
      c2pa: !!m.c2pa,
      manifestUrl: m.c2pa ? ctx.providers.storage.publicUrl(m.c2pa.manifestKey) : null,
    },
  };
}

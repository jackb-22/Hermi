/**
 * Registers NFC/QR tags and prints the URL to write with the NFC Tools app (then lock the tag read-only).
 * Only the secret's hash is stored; the printed URL is the only copy of the secret.
 *
 *   tsx --env-file=../../.env scripts/register-tags.ts venue --place <placeId>
 *   tsx --env-file=../../.env scripts/register-tags.ts venue --name "Demo Hall"
 *   tsx --env-file=../../.env scripts/register-tags.ts personal --count 10      (unbound; bound at onboarding)
 */
import { parseArgs } from 'node:util';
import { buildTagUrl } from '@itp/shared';
import { closeContext, createContext } from '../src/boot.ts';
import { places } from '../src/services/places.ts';
import { hashSecret, newSecret, newTagId, tags } from '../src/services/tags.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    place: { type: 'string' },
    name: { type: 'string' },
    count: { type: 'string', default: '1' },
    chip: { type: 'string', default: 'NTAG215' },
  },
});
const kind = positionals[0];
if (kind !== 'venue' && kind !== 'personal')
  throw new Error('usage: register-tags.ts venue|personal [--place id | --name "..."] [--count n]');

const ctx = await createContext();
let placeId: string | undefined;
if (kind === 'venue') {
  const p = values.place
    ? await places(ctx.db).findOne({ _id: values.place })
    : await places(ctx.db).findOne({ name: values.name });
  if (!p) throw new Error(`place not found: ${values.place ?? values.name}`);
  placeId = p._id;
  console.log(`# venue tags for ${p.name} (${p._id})`);
}
for (let i = 0; i < Number(values.count); i++) {
  const id = newTagId();
  const k = newSecret();
  await tags(ctx.db).insertOne({
    _id: id,
    kind,
    placeId,
    secretHash: hashSecret(k),
    chip: values.chip!,
    createdAt: new Date(),
  });
  if (placeId) await places(ctx.db).updateOne({ _id: placeId }, { $set: { venueTagId: id } });
  console.log(buildTagUrl(ctx.config.PUBLIC_BASE_URL, { kind, id, k }));
}
await closeContext(ctx);

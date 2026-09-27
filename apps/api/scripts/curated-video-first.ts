/**
 * One-off: in seeded multi-part posts, move the clip to the front (the Feed and place pages open on it).
 *   pnpm exec tsx --env-file=../../.env.demo scripts/curated-video-first.ts
 */
import { closeContext, createContext } from '../src/boot.ts';

const ctx = await createContext();
const posts = ctx.db.collection<{ _id: string; mediaIds: string[]; seed?: boolean }>('posts');
const media = ctx.db.collection<{ _id: string; kind: string }>('media');
let changed = 0;
for await (const post of posts.find({ seed: true, 'mediaIds.1': { $exists: true } })) {
  const kinds = new Map(
    (await media.find({ _id: { $in: post.mediaIds } }).toArray()).map((m) => [m._id, m.kind]),
  );
  const ordered = [...post.mediaIds].sort(
    (a, b) => Number(kinds.get(b) === 'video') - Number(kinds.get(a) === 'video'),
  );
  if (ordered.join() !== post.mediaIds.join()) {
    await posts.updateOne({ _id: post._id }, { $set: { mediaIds: ordered } });
    changed++;
  }
}
console.log(`clip moved to the front in ${changed} posts`);
await closeContext(ctx);

/**
 * Curated demo content: real photos, short videos and reviews the team collected for places around
 * Columbia, posted by seed users (never under the original reviewers' names).
 * Run after seed.ts:
 *
 *   pnpm exec tsx --env-file=../../.env.demo scripts/seed-curated.ts [--dir ~/Downloads/realplaces/Realplaces] [--dry-run]
 *
 * Folder layout: <category>/<place name>/{photos…, videos…, review text.rtf}. Photos become JPEGs (≤1080 px);
 * videos are cut to 15 s at 720p. Each place gets multi-part posts (up to 3 photos + a clip, captioned with a
 * review line), then one review post per remaining review; "% would go again" and the review summary update.
 * Everything is marked `seed`, so `seed.ts --reset` removes it.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { newId } from '@itp/shared';
import { closeContext, createContext, ensureSchema } from '../src/boot.ts';
import type { PlaceDoc } from '../src/db/placeTypes.ts';
import { processMedia } from '../src/jobs/processMedia.ts';
import type { MediaDoc } from '../src/services/media.ts';
import type { PostDoc } from '../src/services/posts.ts';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: join(homedir(), 'Downloads/realplaces/Realplaces') },
    'dry-run': { type: 'boolean', default: false },
  },
});
const dry = values['dry-run'];

/** Folder name → how to find the place (or create it, for places missing from the Overture import). */
const PLACES: Record<
  string,
  {
    match: RegExp;
    create?: {
      name: string;
      category: PlaceDoc['category'];
      lat: number;
      lng: number;
      address: string;
    };
  }
> = {
  'Alfred Lerner Hall': {
    match: /^alfred lerner hall$/i,
    create: {
      name: 'Alfred Lerner Hall',
      category: 'culture',
      lat: 40.80675,
      lng: -73.96398,
      address: '2920 Broadway, New York',
    },
  },
  'Butler Library': { match: /^butler library$/i },
  'Dig Inn': { match: /^dig inn$/i },
  'Qahwah House - Broadway': {
    match: /qahwah house/i,
    create: {
      name: 'Qahwah House',
      category: 'food',
      lat: 40.80588,
      lng: -73.96551,
      address: 'Broadway, New York',
    },
  },
  'The Hungarian Pastry Shop': { match: /hungarian pastry/i },
  sweetgreen: { match: /^sweetgreen$/i },
  'Smoke Jazz Club': { match: /smoke jazz/i },
  'Movement Harlem': { match: /^movement harlem$/i },
  'Sakura Park - Riverside Dr': {
    match: /^sakura park$/i,
    create: {
      name: 'Sakura Park',
      category: 'nature',
      lat: 40.81282,
      lng: -73.96216,
      address: 'Riverside Dr & W 122nd St, New York',
    },
  },
  'Dodge Fitness Center': {
    match: /^dodge fitness center$/i,
    create: {
      name: 'Dodge Fitness Center',
      category: 'sports',
      lat: 40.80985,
      lng: -73.96251,
      address: '3030 Broadway, New York',
    },
  },
};
const COLUMBIA: [number, number] = [-73.963, 40.807];

// ---------- files ----------
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (name.startsWith('.') || name === '__MACOSX') return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const PHOTO = new Set(['.png', '.jpg', '.jpeg', '.heic']);
const VIDEO = new Set(['.mp4', '.mov']);

/** Reviews from the team's RTF notes: quoted blocks (with an optional "N/5") and unattributed paragraphs. */
function parseReviews(file: string): { text: string; again: boolean }[] {
  const raw = readFileSync(file, 'latin1');
  let text = raw
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) =>
      Buffer.from([Number.parseInt(hex, 16)]).toString('latin1'),
    )
    .replace(/\\\r?\n/g, '\n')
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\{\\(fonttbl|colortbl)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '');
  // cp1252 quotes/apostrophes (decoded as latin1 control chars above)
  text = text
    .replace(/\x93|\x94/g, '"')
    .replace(/\x92|\x91/g, "'")
    .replace(/\x96|\x97/g, '-');
  const lines = text.split('\n').map((l) => l.trim());
  const reviews: { text: string; again: boolean }[] = [];
  let quote: string[] | null = null;
  for (const line of lines) {
    if (!line) continue;
    if (quote) {
      quote.push(line);
      if (line.includes('"')) {
        push(quote.join(' '));
        quote = null;
      }
      continue;
    }
    if (line.startsWith('"')) {
      if (line.slice(1).includes('"')) push(line);
      else quote = [line];
    } else if (line.length > 60) {
      push(line); // an unattributed review paragraph
    }
  }
  if (quote) push(quote.join(' '));
  return reviews;

  function push(block: string) {
    const rating = block.match(/(\d(?:\.\d)?)\s*\/\s*5/);
    const body = block
      .replace(/"?\s*\d(?:\.\d)?\s*\/\s*5(?:\s*stars?)?\s*$/i, '')
      .replace(/^"|"\s*$/g, '')
      .trim();
    if (body.length < 8) return;
    reviews.push({ text: body.slice(0, 480), again: rating ? Number(rating[1]) >= 3.5 : true });
  }
}

const work = mkdtempSync(join(tmpdir(), 'hermi-curated-'));
function photoJpeg(file: string): Buffer {
  const out = join(work, `${newId()}.jpg`);
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    file,
    '-vf',
    "scale='min(1080,iw)':-2",
    '-q:v',
    '3',
    '-frames:v',
    '1',
    out,
  ]);
  return readFileSync(out);
}
function videoClip(file: string): Buffer {
  const out = join(work, `${newId()}.mp4`);
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-t',
    '15',
    '-i',
    file,
    '-vf',
    'scale=-2:720',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '26',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-movflags',
    '+faststart',
    out,
  ]);
  return readFileSync(out);
}

// ---------- plan the content ----------
const folders = readdirSync(values.dir!).flatMap((category) => {
  const path = join(values.dir!, category);
  if (category.startsWith('.') || category === '__MACOSX' || !statSync(path).isDirectory())
    return [];
  return readdirSync(path)
    .filter((p) => !p.startsWith('.') && statSync(join(path, p)).isDirectory())
    .map((p) => join(path, p));
});

const ctx = await createContext();
if (!dry) await ensureSchema(ctx);
const { db, tiger } = ctx;
const places = db.collection<PlaceDoc>('places');
const authors = await db
  .collection('users')
  .find({ seed: true, campus: { $exists: true } })
  .project({ _id: 1, name: 1 })
  .limit(25)
  .toArray();
if (!authors.length) throw new Error('No seed users: run scripts/seed.ts first.');
let authorTurn = 0;
const nextAuthor = () => authors[authorTurn++ % authors.length]!;

let postCount = 0;
let mediaCount = 0;
let reviewCount = 0;
const now = Date.now();
const DAY = 86_400_000;

for (const folder of folders) {
  const key = basename(folder).trim();
  const spec = PLACES[key];
  if (!spec) {
    console.log(`skip ${key}: no place mapping`);
    continue;
  }
  const files = walk(folder);
  const photos = files.filter((f) => PHOTO.has(extname(f).toLowerCase())).sort();
  const videos = files.filter((f) => VIDEO.has(extname(f).toLowerCase())).sort();
  const reviews = files.filter((f) => /\.(rtf|txt)$/i.test(f)).flatMap(parseReviews);

  // Nearest match to Columbia (there are several Sweetgreens on Broadway).
  let place = await places.findOne({
    name: { $regex: spec.match },
    loc: { $near: { $geometry: { type: 'Point', coordinates: COLUMBIA }, $maxDistance: 3000 } },
  });
  if (!place && spec.create) {
    const c = spec.create;
    if (!dry) {
      await places.updateOne(
        { overtureId: `curated-${key}` },
        {
          $set: {
            name: c.name,
            category: c.category,
            tags: [],
            adultOnly: false,
            confidence: 1,
            address: c.address,
            loc: { type: 'Point', coordinates: [c.lng, c.lat] },
          },
          $setOnInsert: {
            _id: newId(),
            been: 0,
            wouldGoAgain: { yes: 0, total: 0 },
            createdAt: new Date(),
            seed: true,
          },
        },
        { upsert: true },
      );
      place = await places.findOne({ overtureId: `curated-${key}` });
    }
    console.log(`${key}: ${dry ? 'would create' : 'created'} place "${c.name}"`);
  }
  console.log(
    `${key} → ${place?.name ?? '(would create)'}: ${photos.length} photos, ${videos.length} videos, ${reviews.length} reviews`,
  );
  if (dry && reviews[0])
    console.log(`   e.g. ${reviews[0].again ? '👍' : '👎'} ${reviews[0].text.slice(0, 110)}`);
  if (!place || dry) continue;

  // Multi-part posts: up to 3 photos plus one clip each, captioned with a short review line.
  // Captions use short, positive review lines; the rest become review posts.
  const captions = reviews.filter((r) => r.text.length <= 140 && r.again);
  const groups: { photos: string[]; video?: string }[] = [];
  for (let i = 0, v = 0; i < photos.length || v < videos.length; i += 3, v++) {
    const group = { photos: photos.slice(i, i + 3), video: videos[v] };
    if (!group.photos.length && !group.video) break;
    groups.push(group);
  }
  const loc = { lat: place.loc.coordinates[1], lng: place.loc.coordinates[0] };
  for (const [g, group] of groups.entries()) {
    const author = nextAuthor();
    const time = new Date(now - (1 + g * 2 + Math.random()) * DAY);
    const checkinId = `seed_ci_${newId()}`;
    await tiger.query(
      'insert into checkins (time, id, user_id, place_id, tier, plan_id, session_id, lat, lng, accuracy, attested, tag_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [time, checkinId, author._id, place._id, 'tag', null, null, loc.lat, loc.lng, 10, true, null],
    );
    const mediaIds: string[] = [];
    const parts: { bytes: Buffer; kind: 'photo' | 'video'; contentType: string }[] = [
      // The clip leads each multi-part post.
      ...(group.video
        ? [{ bytes: videoClip(group.video), kind: 'video' as const, contentType: 'video/mp4' }]
        : []),
      ...group.photos.map((f) => ({
        bytes: photoJpeg(f),
        kind: 'photo' as const,
        contentType: 'image/jpeg',
      })),
    ];
    for (const part of parts) {
      const mediaId = newId();
      const storageKey = `orig/${author._id}/${mediaId}.${part.kind === 'video' ? 'mp4' : 'jpg'}`;
      await ctx.providers.storage.put(storageKey, part.bytes, part.contentType);
      const m: MediaDoc & { seed: boolean } = {
        _id: mediaId,
        userId: author._id,
        checkinId,
        placeId: place._id,
        kind: part.kind,
        contentType: part.contentType,
        sha256: createHash('sha256').update(part.bytes).digest('hex'),
        bytes: part.bytes.length,
        key: storageKey,
        status: 'verified',
        capturedAt: new Date(time.getTime() + 10 * 60_000),
        at: place.loc,
        attested: true,
        posted: true,
        createdAt: time,
        verifiedAt: time,
        seed: true,
      };
      await db.collection('media').insertOne(m as never);
      await processMedia(ctx, { mediaId });
      mediaIds.push(mediaId);
      mediaCount++;
    }
    const post: PostDoc & { seed: boolean } = {
      _id: newId(),
      authorId: author._id,
      type: parts.length === 1 && parts[0]!.kind === 'video' ? 'clip' : 'photos',
      status: 'live',
      placeId: place._id,
      loc: place.loc,
      mediaIds,
      text: captions[g]?.text,
      stamp: { placeName: place.name, time, tier: 'tag' },
      hiddenFrom: [],
      createdAt: new Date(time.getTime() + 3600_000),
      liveAt: new Date(time.getTime() + 3600_000),
      seed: true,
    };
    await db.collection('posts').insertOne(post as never);
    postCount++;
  }

  // Review posts for the reviews not used as captions; every review counts toward "% would go again".
  const used = new Set(captions.slice(0, groups.length).map((r) => r.text));
  for (const [r, review] of reviews.entries()) {
    if (!used.has(review.text)) {
      const author = nextAuthor();
      const time = new Date(now - (0.5 + r * 1.5 + Math.random()) * DAY);
      const post: PostDoc & { seed: boolean } = {
        _id: newId(),
        authorId: author._id,
        type: 'review',
        status: 'live',
        placeId: place._id,
        loc: place.loc,
        mediaIds: [],
        text: review.text,
        again: review.again,
        stamp: { placeName: place.name, time, tier: 'tag' },
        hiddenFrom: [],
        createdAt: time,
        liveAt: time,
        seed: true,
      };
      await db.collection('posts').insertOne(post as never);
      postCount++;
    }
    reviewCount++;
  }
  if (reviews.length) {
    const yes = reviews.filter((r) => r.again).length;
    const quotes = reviews
      .filter((r) => r.text.length <= 120)
      .slice(0, 2)
      .map((r) => `“${r.text}”`);
    await places.updateOne(
      { _id: place._id },
      {
        $inc: {
          'wouldGoAgain.yes': yes,
          'wouldGoAgain.total': reviews.length,
          been: groups.length,
        },
        $set: {
          reviewSummary: {
            text: quotes.length
              ? `People say ${quotes.join(' and ')}`
              : reviews[0]!.text.slice(0, 160),
            count: reviews.length,
            at: new Date(),
          },
        },
      },
    );
  }
}

console.log(
  dry
    ? 'dry run: nothing written'
    : `curated: ${postCount} posts (${mediaCount} photos/clips, ${reviewCount} reviews)`,
);
await closeContext(ctx);

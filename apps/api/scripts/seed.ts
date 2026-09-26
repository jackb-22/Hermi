/**
 * Demo seed: makes the social map, feed and ranks look alive around Morningside Heights.
 * Everything written is marked (Mongo `seed: true`, Tiger ids/refs starting with "seed"), so --reset removes exactly it.
 *
 *   tsx --env-file=../../.env scripts/seed.ts --reset --demo maya,sam [--media-dir ./captures]
 *
 *  - 25 obviously fake verified Columbia users with varied taste decks and 30 days of history
 *    (check-ins at real places, XP, walks, colored tiles, sessions, reviews)
 *  - 40 light campus users (XP only) so "#41 at Columbia" is a real rank
 *  - each --demo user: 30 days of their own history, friends with 8 seed users, streaks 1–14 weeks, one ending Sunday
 *  - 20 live photo posts (from --media-dir captures if given, else generated placeholders), rendered by the media worker
 *  - 5 upcoming open plans: 3 friends-visible from the demo users' friends, 2 Find someone
 * Ends with refresh_continuous_aggregate on xp_daily and movement_daily (backfilled rows sit outside the refresh window).
 * The refresh stops at the start of today: materializing today's bucket would hide live XP from the real-time Score.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  fromGeoJSONPoint,
  haversineM,
  type LatLng,
  localDayKey,
  newId,
  TASTE_DECK,
  tileKey,
  tilesAlongPath,
  toGeoJSONPoint,
  weekIndex,
  XP,
} from '@itp/shared';
import { closeContext, createContext, ensureSchema } from '../src/boot.ts';
import type { PlaceDoc } from '../src/db/placeTypes.ts';
import type { UserDoc } from '../src/db/types.ts';
import { buildPrefs } from '../src/domain/prefs.ts';
import { processMedia } from '../src/jobs/processMedia.ts';
import type { MediaDoc } from '../src/services/media.ts';
import { loadPlaces, normalizeStops, type PlanDoc, recompute } from '../src/services/plans.ts';
import type { PostDoc } from '../src/services/posts.ts';
import { newUser } from '../src/services/users.ts';

const { values } = parseArgs({
  options: {
    reset: { type: 'boolean', default: false },
    demo: { type: 'string', default: '' },
    'media-dir': { type: 'string' },
    campus: { type: 'string', default: 'Columbia' },
    seed: { type: 'string', default: '7' },
  },
});

// Deterministic randomness (mulberry32).
let state = Number(values.seed) >>> 0;
const rand = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
const between = (a: number, b: number) => a + rand() * (b - a);
const sid = (p: string) => `seed_${p}_${newId()}`;

const DAY = 86_400_000;
const CAMPUS_GATE = { lat: 40.8075, lng: -73.9626 };
const NAMES = [
  'Pixel Pat',
  'Quest Quinn',
  'Sprite Sasha',
  'Tile Toni',
  'Map Morgan',
  'Dither Dana',
  'Sidequest Sam',
  'Overworld Omar',
  'Level Lee',
  'Chiptune Chris',
  'Checkpoint Cam',
  'Respawn Riley',
  'Loot Logan',
  'Boss Blair',
  'Warp Winnie',
  'Combo Casey',
  'Power-up Parker',
  'Save-point Sky',
  'Joystick Jo',
  'Arcade Avery',
  'Bonus Bailey',
  'Glitch Gray',
  'Hi-score Hayden',
  'Coin Cory',
  'Portal Peyton',
];

const ctx = await createContext();
await ensureSchema(ctx);
const { db, tiger } = ctx;
const now = new Date();

async function reset() {
  const seedUsers = (
    await db
      .collection('users')
      .find({ seed: true }, { projection: { _id: 1 } })
      .toArray()
  ).map((u) => u._id as unknown as string);
  for (const c of ['users', 'plans', 'posts', 'media', 'sessions', 'reviews', 'saves', 'folders'])
    await db.collection(c).deleteMany({ seed: true });
  await db
    .collection('friendships')
    .deleteMany({ $or: [{ seed: true }, { a: { $in: seedUsers } }, { b: { $in: seedUsers } }] });
  await db.collection('user_tiles').deleteMany({ seed: true });
  await tiger.query(`delete from checkins where id like 'seed%'`);
  await tiger.query(`delete from xp_events where ref_id like 'seed%'`);
  await tiger.query(`delete from movement_segments where session_id like 'seed%'`);
  await tiger.query(`delete from hangouts where source = 'seed'`);
  console.log(`reset: removed ${seedUsers.length} seed users and all seed-marked rows`);
}

if (values.reset) await reset();

// Real places around campus to visit.
const near = await db
  .collection<PlaceDoc>('places')
  .find({
    loc: { $nearSphere: { $geometry: toGeoJSONPoint(CAMPUS_GATE), $maxDistance: 2500 } },
    adultOnly: { $ne: true },
  })
  .limit(400)
  .toArray();
if (near.length < 20)
  throw new Error('Too few places near campus: run scripts/import-overture.ts first');
const byCat = new Map<string, PlaceDoc[]>();
for (const p of near) byCat.set(p.category, [...(byCat.get(p.category) ?? []), p]);

// ---------- users ----------
const deck = TASTE_DECK.filter((c) => !c.requires21);
const mkUser = (name: string, username: string, fields: Partial<UserDoc> = {}) => {
  const swipes = deck.map((c) => ({ cardId: c.id, liked: rand() < 0.55 }));
  const prefs = buildPrefs(swipes, false);
  return {
    ...newUser(new Date(now.getTime() - 60 * DAY), {
      name,
      username,
      campus: values.campus,
      gradYear: pick([2026, 2027, 2028, 2029]),
      verifiedAt: new Date(now.getTime() - 50 * DAY),
      prefVector: prefs.prefVector,
      dislikes: prefs.dislikes,
      tasteDone: true,
      openToPlans: rand() < 0.6,
      ...fields,
    }),
    seed: true,
  };
};
const seedUsers = NAMES.map((n, i) =>
  mkUser(n, `seed_${n.toLowerCase().replace(/[^a-z]+/g, '_')}`.slice(0, 20), { is21: i % 3 === 0 }),
);
const campusUsers = Array.from({ length: 40 }, (_, i) =>
  mkUser(`Classmate ${i + 1}`, `seed_classmate_${i + 1}`),
);
await db.collection('users').insertMany([...seedUsers, ...campusUsers] as never[]);

const demo: UserDoc[] = [];
for (const username of values.demo!.split(',').filter(Boolean)) {
  let u = await db.collection<UserDoc>('users').findOne({ username });
  if (!u) {
    u = { ...newUser(now, { username, name: username, tasteDone: true }), seed: true } as UserDoc;
    await db.collection<UserDoc>('users').insertOne(u);
    console.log(
      `created placeholder demo user @${username} (sign in with /auth/dev, or rename your real account to it and re-run)`,
    );
  }
  if (!u.campus) {
    const verified = { campus: values.campus, verifiedAt: now, gradYear: 2027 };
    await db.collection<UserDoc>('users').updateOne({ _id: u._id }, { $set: verified });
    Object.assign(u, verified);
  }
  demo.push(u);
}

// ---------- 30 days of history ----------
const tileSeen = new Map<string, Set<string>>();
const checkinRows: unknown[][] = [];
const xpRows: unknown[][] = [];
const moveRows: unknown[][] = [];
const sessionDocs: object[] = [];
const reviewDocs: object[] = [];
const tileDocs: object[] = [];
const recentCheckins = new Map<
  string,
  { id: string; placeId: string; time: Date; tier: 'gps' | 'tag' }[]
>();

function outing(user: UserDoc, day: number) {
  const anchor = pick(near);
  const stops = [anchor];
  const n = 1 + Math.floor(rand() * 3);
  for (let i = 1; i < n; i++) {
    const cands = near.filter(
      (p) =>
        !stops.includes(p) &&
        haversineM(fromGeoJSONPoint(p.loc), fromGeoJSONPoint(stops.at(-1)!.loc)) < 900,
    );
    if (cands.length) stops.push(pick(cands));
  }
  const date = new Date(now.getTime() - day * DAY);
  const start = new Date(
    Date.parse(`${localDayKey(date)}T00:00:00-04:00`) + between(11, 19) * 3600_000,
  );
  if (start > now) return;
  const sessionId = sid('sess');
  const path: LatLng[] = [];
  let t = start.getTime();
  let meters = 0;
  const seenPlaces = new Set<string>();
  for (const [i, p] of stops.entries()) {
    const loc = fromGeoJSONPoint(p.loc);
    if (i > 0) {
      const d = haversineM(path.at(-1)!, loc) * 1.3;
      meters += d;
      t += (d / 80) * 60_000;
    }
    path.push(loc);
    const time = new Date(t);
    if (time > now) break;
    const tier = rand() < 0.35 ? 'tag' : 'gps';
    const id = sid('chk');
    checkinRows.push([
      time,
      id,
      user._id,
      p._id,
      tier,
      null,
      sessionId,
      loc.lat,
      loc.lng,
      12,
      true,
      null,
    ]);
    xpRows.push([
      time,
      user._id,
      user.campus ?? null,
      tier === 'tag' ? 'checkin_tag' : 'checkin_gps',
      tier === 'tag' ? XP.checkinTag : XP.checkinGps,
      id,
    ]);
    const key = `${user._id}:${p._id}`;
    if (!seenPlaces.has(key) && !firstVisits.has(key)) {
      firstVisits.add(key);
      xpRows.push([time, user._id, user.campus ?? null, 'first_visit', XP.firstVisit, id]);
    }
    seenPlaces.add(key);
    if (rand() < 0.4)
      reviewDocs.push({
        _id: newId(),
        userId: user._id,
        placeId: p._id,
        checkinId: id,
        again: rand() < 0.8,
        tier,
        createdAt: time,
        seed: true,
      });
    if (day <= 6)
      recentCheckins.set(user._id, [
        ...(recentCheckins.get(user._id) ?? []),
        { id, placeId: p._id, time, tier },
      ]);
    t += between(35, 100) * 60_000;
  }
  const end = new Date(Math.min(t, now.getTime()));
  const km = meters / 1000;
  const ref = `seed:${sessionId}`;
  if (km > 0) {
    xpRows.push([
      end,
      user._id,
      user.campus ?? null,
      'distance',
      Math.round(km * XP.perKmOnFootOrBike),
      ref,
    ]);
    moveRows.push([start, end, user._id, sessionId, 'walk', meters, Math.round(km * 1300)]);
  }
  const mine = tileSeen.get(user._id) ?? new Set();
  tileSeen.set(user._id, mine);
  let fresh = 0;
  for (const tile of tilesAlongPath(path)) {
    const k = tileKey(tile);
    if (mine.has(k)) continue;
    mine.add(k);
    fresh++;
    tileDocs.push({ userId: user._id, x: tile.x, y: tile.y, firstAt: end, sessionId, seed: true });
  }
  if (fresh) xpRows.push([end, user._id, user.campus ?? null, 'tiles', fresh * XP.newTile, ref]);
  if (stops.length >= 2)
    xpRows.push([end, user._id, user.campus ?? null, 'completed_plan', XP.completedPlan, ref]);
  sessionDocs.push({
    _id: sessionId,
    userId: user._id,
    kind: 'headout',
    status: 'ended',
    startedAt: start,
    endedAt: end,
    pointsAccepted: 0,
    pointsRejected: 0,
    seed: true,
  });
}
const firstVisits = new Set<string>();

for (const u of [...seedUsers, ...demo])
  for (let day = 29; day >= 0; day--) if (rand() < 0.45) outing(u as UserDoc, day);
for (const u of campusUsers) {
  for (let i = 0; i < 1 + Math.floor(rand() * 6); i++) {
    xpRows.push([
      new Date(now.getTime() - between(0, 29) * DAY),
      u._id,
      values.campus,
      'checkin_gps',
      XP.checkinGps + Math.floor(rand() * 30),
      'seed:campus',
    ]);
  }
}

const bulk = async (sql: string, cols: number, rows: unknown[][]) => {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const params = chunk.flat();
    const tuples = chunk
      .map(
        (_, r) => `(${Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}`).join(', ')})`,
      )
      .join(', ');
    await tiger.query(`${sql} values ${tuples}`, params);
  }
};
await bulk(
  'insert into checkins (time, id, user_id, place_id, tier, plan_id, session_id, lat, lng, accuracy, attested, tag_id)',
  12,
  checkinRows,
);
await bulk('insert into xp_events (time, user_id, campus, kind, xp, ref_id)', 6, xpRows);
await bulk(
  'insert into movement_segments (time, end_time, user_id, session_id, mode, meters, steps)',
  7,
  moveRows,
);
if (sessionDocs.length) await db.collection('sessions').insertMany(sessionDocs as never[]);
if (reviewDocs.length) await db.collection('reviews').insertMany(reviewDocs as never[]);
if (tileDocs.length)
  await db
    .collection('user_tiles')
    .bulkWrite(tileDocs.map((d) => ({ insertOne: { document: d } })) as never, { ordered: false })
    .catch(() => {});

// Place caches from the seeded truth: been = distinct visitors, wouldGoAgain from reviews.
const { rows: beenRows } = await tiger.query<{ place_id: string; n: number }>(
  'select place_id, count(distinct user_id)::int as n from checkins group by place_id',
);
const rev = await db
  .collection('reviews')
  .aggregate<{ _id: string; yes: number; total: number }>([
    { $group: { _id: '$placeId', yes: { $sum: { $cond: ['$again', 1, 0] } }, total: { $sum: 1 } } },
  ])
  .toArray();
const revBy = new Map(rev.map((r) => [r._id, r]));
await db.collection<PlaceDoc>('places').bulkWrite(
  beenRows.map((r) => ({
    updateOne: {
      filter: { _id: r.place_id },
      update: {
        $set: {
          been: r.n,
          wouldGoAgain: {
            yes: revBy.get(r.place_id)?.yes ?? 0,
            total: revBy.get(r.place_id)?.total ?? 0,
          },
        },
      },
    },
  })),
);

// ---------- friendships and streaks for the demo phones ----------
const thisWeek = weekIndex(now);
for (const [di, d] of demo.entries()) {
  const friends = seedUsers.slice(di * 4, di * 4 + 8);
  for (const [i, f] of friends.entries()) {
    const endsSunday = i === 0; // last hangout was last week: "Your 8-week streak with … ends Sunday"
    const streak = endsSunday ? 8 : 1 + ((i * 13 + di * 5) % 14);
    const last = endsSunday ? thisWeek - 1 : thisWeek;
    const [a, b] = [d._id, f._id].sort();
    const hangouts = streak + Math.floor(rand() * streak);
    await db.collection('friendships').updateOne(
      { _id: `${a}:${b}` as never },
      {
        $set: {
          a,
          b,
          since: new Date(now.getTime() - (streak * 7 + 3) * DAY),
          hangouts,
          streakWeeks: streak,
          lastHangoutWeek: last,
          lastHangoutDay: 'seed',
          seed: true,
        },
      },
      { upsert: true },
    );
    for (let w = 0; w < streak; w++) {
      await tiger.query(`insert into hangouts (time, pair_key, source) values ($1, $2, 'seed')`, [
        new Date(now.getTime() - ((endsSunday ? 7 : 0) + w * 7 + 1) * DAY),
        `${a}:${b}`,
      ]);
    }
  }
  // Demo phones are friends with each other too.
  for (const other of demo.slice(di + 1)) {
    const [a, b] = [d._id, other._id].sort();
    await db.collection('friendships').updateOne(
      { _id: `${a}:${b}` as never },
      {
        $setOnInsert: {
          a,
          b,
          since: now,
          hangouts: 1,
          streakWeeks: 1,
          lastHangoutWeek: thisWeek,
          lastHangoutDay: 'seed',
          seed: true,
        },
      },
      { upsert: true },
    );
  }
}
// Seed users also know each other a bit, so profiles show friend counts.
for (let i = 0; i < seedUsers.length; i++) {
  const x = seedUsers[i]!;
  const y = seedUsers[(i + 1) % seedUsers.length]!;
  const [a, b] = [x._id, y._id].sort();
  await db.collection('friendships').updateOne(
    { _id: `${a}:${b}` as never },
    {
      $setOnInsert: {
        a,
        b,
        since: now,
        hangouts: 3,
        streakWeeks: 2,
        lastHangoutWeek: thisWeek,
        lastHangoutDay: 'seed',
        seed: true,
      },
    },
    { upsert: true },
  );
}

// ---------- posts with real media (renditions made by the media worker) ----------
const dir = mkdtempSync(join(tmpdir(), 'itp-seed-'));
const captures: { bytes: Buffer; contentType: string; kind: 'photo' | 'video' }[] = [];
if (values['media-dir']) {
  for (const f of readdirSync(values['media-dir']).sort()) {
    const ext = extname(f).toLowerCase();
    const type = (
      {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.heic': 'image/heic',
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
      } as Record<string, string>
    )[ext];
    if (type)
      captures.push({
        bytes: readFileSync(join(values['media-dir'], f)),
        contentType: type,
        kind: type.startsWith('video') ? 'video' : 'photo',
      });
  }
}
for (let i = captures.length; i < 20; i++) {
  const out = join(dir, `p${i}.jpg`);
  const hue = Math.floor(rand() * 360);
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=1080x1350:rate=1,hue=h=${hue},scale=270:338,scale=1080:1350:flags=neighbor`,
    '-frames:v',
    '1',
    '-vf',
    'format=yuvj420p',
    out,
  ]);
  captures.push({ bytes: readFileSync(out), contentType: 'image/jpeg', kind: 'photo' });
}
const posters = [...recentCheckins.entries()].flatMap(([userId, cs]) =>
  cs.map((c) => ({ userId, ...c })),
);
let made = 0;
for (const cap of captures.slice(0, Math.max(20, captures.length))) {
  const c = posters[made % posters.length];
  if (!c) break;
  const place = near.find((p) => p._id === c.placeId)!;
  const mediaId = newId();
  const key = `orig/${c.userId}/${mediaId}.${cap.kind === 'video' ? 'mp4' : 'jpg'}`;
  await ctx.providers.storage.put(key, cap.bytes, cap.contentType);
  const m: MediaDoc & { seed: boolean } = {
    _id: mediaId,
    userId: c.userId,
    checkinId: c.id,
    placeId: c.placeId,
    kind: cap.kind,
    contentType: cap.contentType,
    sha256: createHash('sha256').update(cap.bytes).digest('hex'),
    bytes: cap.bytes.length,
    key,
    status: 'verified',
    capturedAt: new Date(c.time.getTime() + 10 * 60_000),
    at: place.loc,
    attested: true,
    posted: true,
    createdAt: c.time,
    verifiedAt: c.time,
    seed: true,
  };
  await db.collection('media').insertOne(m as never);
  await processMedia(ctx, { mediaId });
  const post: PostDoc & { seed: boolean } = {
    _id: newId(),
    authorId: c.userId,
    type: cap.kind === 'video' ? 'clip' : 'photos',
    status: 'live',
    placeId: c.placeId,
    loc: place.loc,
    mediaIds: [mediaId],
    text: pick([
      'would go again',
      'the light here though',
      'found this on a walk',
      'new favorite spot',
      undefined,
      undefined,
    ]),
    stamp: { placeName: place.name, time: c.time, tier: c.tier },
    hiddenFrom: [],
    createdAt: new Date(c.time.getTime() + 60 * 60_000),
    liveAt: new Date(c.time.getTime() + 60 * 60_000),
    seed: true,
  };
  await db.collection('posts').insertOne(post as never);
  made++;
}

// ---------- open plans ----------
const hosts = [
  ...(demo.length ? seedUsers.slice(0, 3) : seedUsers.slice(0, 3)),
  seedUsers[20]!,
  seedUsers[21]!,
];
for (const [i, host] of hosts.entries()) {
  const cats = [
    ['food', 'nature'],
    ['culture', 'food'],
    ['shopping', 'food', 'music'],
    ['nature', 'food'],
    ['music', 'food'],
  ][i]!;
  const stops = cats.flatMap((c) => (byCat.get(c)?.length ? [pick(byCat.get(c)!)] : []));
  const startAt = new Date(
    Math.ceil((now.getTime() + (i + 1) * 20 * 3600_000) / (15 * 60_000)) * 15 * 60_000,
  );
  const byId = await loadPlaces(
    db,
    stops.map((s) => s._id),
  );
  const plan: PlanDoc & { seed: boolean } = {
    _id: newId(),
    hostId: host._id,
    name: [
      'Bagels then the park',
      'Museum mile warm-up',
      'Thrift and tunes',
      'Riverside sunset',
      'Late jazz crawl',
    ][i]!,
    nameIsDefault: false,
    startAt,
    mode: 'walk',
    visibility: i < 3 ? 'friends' : 'find',
    status: 'planned',
    stops: normalizeStops(
      stops.map((s) => ({ placeId: s._id })),
      [],
      'walk',
      byId,
      now,
    ),
    members: i === 0 ? [{ userId: seedUsers[5]!._id, status: 'joined', at: now }] : [],
    ghostChanges: [],
    shareToken: randomBytes(9).toString('base64url'),
    createdAt: now,
    updatedAt: now,
    seed: true,
  };
  recompute(plan, byId);
  await db.collection('plans').insertOne(plan as never);
}

await tiger.query(`call refresh_continuous_aggregate('xp_daily', null, date_trunc('day', now()))`);
await tiger.query(
  `call refresh_continuous_aggregate('movement_daily', null, date_trunc('day', now()))`,
);
console.log(
  `seeded ${seedUsers.length} users + ${campusUsers.length} campus users, ${checkinRows.length} check-ins, ${xpRows.length} XP events, ${tileDocs.length} tiles, ${made} posts, ${hosts.length} open plans` +
    (demo.length ? `; demo users: ${demo.map((d) => `@${d.username}`).join(', ')}` : ''),
);
await closeContext(ctx);

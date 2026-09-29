/**
 * The Photon agent without a phone: type (or pipe) texts as someone, in a DM or a group, and see Hermi's replies and
 * the plans they produce. Real handler, real Gemini/Routes when keys are set, local databases only.
 *
 *   pnpm --filter @itp/api exec tsx --env-file=../../.env scripts/photon-cli.ts
 *   printf '/as ava +12125550001\nSat 2pm: Hungarian Pastry Shop then Riverside Park with ben\n/plan ava\n' | …photon-cli.ts
 *
 * Commands:
 *   /as <username> <phone>          sign up/link that user to that phone and text as it (DM)
 *   /from <phone>                    text as another phone (linked or not)
 *   /group <name> <phone,phone,…>    switch to a group chat with those members (the agent is implied)
 *   /dm                              back to a DM with the agent
 *   /friends <username> <username>   make two users friends
 *   /plan <username>                 print that user's drafts and upcoming plans (stops, times, legs, members)
 *   /quit
 * Anything else is sent as a text.
 */
import { createInterface } from 'node:readline';
import { buildApp } from '../src/app.ts';
import { closeContext, createContext } from '../src/boot.ts';
import { loadConfig } from '../src/config.ts';
import { FakeMessenger } from '../src/providers/messenger.ts';
import { startGroupChat } from '../src/services/groupChat.ts';
import { loadPlaces, plans, toSchedStops } from '../src/services/plans.ts';
import { pairKey } from '../src/services/social.ts';
import { users } from '../src/services/users.ts';

const config = loadConfig({ ...process.env, RUN_WORKER: 'off', LOG_LEVEL: 'warn' });
if (!/localhost|127\.0\.0\.1/.test(config.MONGO_URI)) {
  console.error('photon-cli writes users and plans: point MONGO_URI at the local docker database');
  process.exit(2);
}
const ctx = await createContext(config);
const app = await buildApp(ctx);
await app.ready();
const fake = new FakeMessenger();
ctx.providers.messenger = fake;
startGroupChat(ctx);
console.log(`llm=${ctx.providers.llm.name} eta=${ctx.providers.eta.name} db=${config.MONGO_DB}`);

let from = '+12125550001';
let space = `dm:${from}`;
let group = false;
let seq = 0;
const clock = (d: Date) =>
  d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

async function printPlans(username: string) {
  const u = await users(ctx.db).findOne({ username });
  if (!u) return console.log(`  no user ${username}`);
  const list = await plans(ctx.db)
    .find({ hostId: u._id, status: { $in: ['draft', 'planned'] } })
    .sort({ updatedAt: -1 })
    .limit(3)
    .toArray();
  for (const p of list) {
    const byId = await loadPlaces(
      ctx.db,
      p.stops.map((s) => s.placeId),
    );
    const sched = toSchedStops(p.stops, byId);
    console.log(
      `  ▸ ${p.name} [${p.status}/${p.visibility}] from ${clock(p.startAt)}${p.imessageThreadId ? ` · thread ${p.imessageThreadId}` : ''}`,
    );
    p.stops.forEach((s, i) => {
      if (i) console.log(`      ↓ ${s.legMode} ${s.legMin} min (${s.legSource})`);
      console.log(
        `    ${i + 1}. ${sched[i]!.name}  ${clock(s.arriveAt)} → ${clock(s.departAt)}  stay ${s.stayMin} (${s.staySource})`,
      );
    });
    const members = await users(ctx.db)
      .find({ _id: { $in: p.members.map((m) => m.userId) } })
      .toArray();
    for (const m of p.members)
      console.log(
        `    · ${members.find((x) => x._id === m.userId)?.username ?? m.userId}: ${m.status}`,
      );
  }
}

async function line(text: string) {
  const [cmd, ...args] = text.trim().split(/\s+/);
  switch (cmd) {
    case '/as': {
      const [username, phone] = args;
      await app.inject({ method: 'POST', url: '/v1/auth/dev', payload: { username } });
      await app.inject({
        method: 'POST',
        url: '/v1/dev/imessage/link',
        payload: { username, handle: phone },
      });
      from = phone!;
      if (!group) space = `dm:${from}`;
      return console.log(`  texting as @${username} (${from})${group ? ` in ${space}` : ''}`);
    }
    case '/from':
      from = args[0]!;
      if (!group) space = `dm:${from}`;
      return console.log(`  texting as ${from}`);
    case '/group':
      group = true;
      space = `group:${args[0]}`;
      fake.groups.set(space, (args[1] ?? '').split(',').filter(Boolean));
      return console.log(`  in ${space} with ${fake.groups.get(space)?.join(', ')}`);
    case '/dm':
      group = false;
      space = `dm:${from}`;
      return console.log('  DM with Hermi');
    case '/friends': {
      const [a, b] = await Promise.all(args.map((n) => users(ctx.db).findOne({ username: n })));
      if (!a || !b) return console.log('  both users must exist (/as them first)');
      const [x, y] = [a._id, b._id].sort() as [string, string];
      await ctx.db
        .collection('friendships')
        .updateOne(
          { _id: pairKey(x, y) as never },
          {
            $setOnInsert: {
              a: x,
              b: y,
              since: new Date(),
              hangouts: 0,
              streakWeeks: 0,
              lastHangoutWeek: 0,
            },
          },
          { upsert: true },
        );
      return console.log(`  @${args[0]} and @${args[1]} are friends`);
    }
    case '/plan':
      return printPlans(args[0] ?? '');
    case '/quit':
      return 'quit';
    default: {
      if (!text.trim()) return;
      const before = fake.sent.length;
      const t0 = Date.now();
      await fake.receive({
        spaceId: space,
        group,
        text,
        senderId: from,
        messageId: `cli-${Date.now()}-${seq++}`,
      });
      for (const s of fake.sent.slice(before))
        console.log(`  Hermi → ${s.spaceId}:\n${s.text.replace(/^/gm, '    ')}`);
      if (fake.sent.length === before) console.log(`  (no reply, ${Date.now() - t0} ms)`);
      else console.log(`  (${Date.now() - t0} ms)`);
    }
  }
}

const rl = createInterface({ input: process.stdin, prompt: '> ', terminal: process.stdin.isTTY });
if (process.stdin.isTTY) rl.prompt();
for await (const text of rl) {
  if (!process.stdin.isTTY) console.log(`> ${text}`);
  if ((await line(text)) === 'quit') break;
  if (process.stdin.isTTY) rl.prompt();
}
await app.close();
await closeContext(ctx);

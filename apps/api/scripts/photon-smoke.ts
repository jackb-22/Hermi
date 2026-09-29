/**
 * Live check of the Photon (Spectrum iMessage) agent: does it receive DMs and group texts, can it reply, list a
 * group's members and rebuild a thread from its id? Only replies to what you text it.
 *
 *   pnpm --filter @itp/api exec tsx --env-file=../../.env.demo scripts/photon-smoke.ts [--minutes 10]
 *
 * Stop scripts/demo-up.sh first: two processes on one project would split the messages between them.
 * On a shared-pool line (the default plan) the agent must text you first: add --hello <your phone>, then
 * reply to that message. Then, from your iPhone:
 *   1. text "ping" to PHOTON_AGENT_ADDRESS                → expect "pong 1 (dm)"
 *   2. make a group with the agent and one more person, send "ping"   → "pong 2 (group)"
 *   3. in the group, send a line that doesn't mention it  → logged; tells us whether every group text arrives
 *   4. in the group, send "members"                       → the agent lists the participants
 *   5. send "rebuild" anywhere                            → it replies through space.get(id) instead of the event's space
 * A summary prints on exit (Ctrl-C or --minutes).
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.ts';

const { values } = parseArgs({
  options: { minutes: { type: 'string', default: '10' }, hello: { type: 'string' } },
});
const config = loadConfig();
if (!config.SPECTRUM_PROJECT_ID || !config.SPECTRUM_PROJECT_SECRET) {
  console.error(
    'SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET are not set (use --env-file=../../.env.demo)',
  );
  process.exit(2);
}
const { Spectrum } = await import('spectrum-ts');
const { imessage } = await import('spectrum-ts/providers/imessage');

type AnySpace = {
  id: string;
  send(text: string): Promise<unknown>;
  getMembers(): Promise<{ id: string }[]>;
};
type AnyMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  content: { type: string; text?: string };
  sender?: { id?: string } | null;
};
const app = (await Spectrum({
  projectId: config.SPECTRUM_PROJECT_ID,
  projectSecret: config.SPECTRUM_PROJECT_SECRET,
  providers: [imessage.config()],
})) as unknown as { messages: AsyncIterable<[AnySpace, AnyMessage]>; stop(): Promise<void> };
const platform = (
  imessage as unknown as (a: unknown) => {
    space: { get(id: string): Promise<AnySpace>; create(user: string): Promise<AnySpace> };
  }
)(app);
console.log(
  `▶ listening as ${config.PHOTON_AGENT_ADDRESS ?? '(PHOTON_AGENT_ADDRESS unset)'} for ${values.minutes} min`,
);

const seen = {
  dm: 0,
  group: 0,
  groupNoMention: 0,
  replies: 0,
  errors: [] as string[],
  ids: new Set<string>(),
  dupes: 0,
};
let pongs = 0;
const reply = async (space: AnySpace, text: string) => {
  try {
    await space.send(text);
    seen.replies++;
  } catch (e) {
    seen.errors.push(`send: ${(e as Error).message}`);
    console.log(`  ✗ send failed: ${(e as Error).message}`);
  }
};

// Shared-pool lines: the agent texts first; the person replies to whichever pool number that came from.
if (values.hello) {
  try {
    const dm = await platform.space.create(values.hello);
    await dm.send('Hi from Hermi 🦀 Reply "ping" to test me.');
    console.log(`→ texted ${values.hello} first (space ${dm.id}); reply to that message`);
  } catch (e) {
    console.log(`✗ could not text ${values.hello}: ${(e as Error).message}`);
  }
}

const done = new Promise<void>((resolve) => {
  setTimeout(resolve, Number(values.minutes) * 60_000);
  process.on('SIGINT', resolve);
});
const loop = (async () => {
  for await (const [space, message] of app.messages) {
    const type = (imessage as unknown as (s: AnySpace) => { type?: string })(space).type ?? '?';
    const text = message.content.text ?? `<${message.content.type}>`;
    console.log(
      `${new Date().toISOString()} ${message.direction} ${type} space=${space.id} msg=${message.id} from=${message.sender?.id ?? '-'}: ${text}`,
    );
    if (message.direction !== 'inbound') continue;
    if (seen.ids.has(message.id)) seen.dupes++;
    seen.ids.add(message.id);
    if (type === 'group') {
      seen.group++;
      if (!/\b(ping|members|rebuild|hermi)\b/i.test(text)) seen.groupNoMention++;
    } else seen.dm++;
    const t = text.trim().toLowerCase();
    if (t === 'ping') await reply(space, `pong ${++pongs} (${type})`);
    else if (t === 'members')
      try {
        const members = await space.getMembers();
        await reply(space, `members: ${members.map((m) => m.id).join(', ') || '(none)'}`);
      } catch (e) {
        await reply(space, `members failed: ${(e as Error).message}`);
      }
    else if (t === 'rebuild')
      try {
        const again = await platform.space.get(space.id);
        await reply(again, `rebuilt ${space.id} from its id ✓`);
      } catch (e) {
        await reply(space, `space.get failed: ${(e as Error).message}`);
      }
  }
})().catch((e) => seen.errors.push(`stream: ${(e as Error).message}`));

await Promise.race([done, loop]);
await app.stop().catch(() => {});
console.log('\n── summary');
console.log(`DMs received: ${seen.dm}`);
console.log(
  `group texts received: ${seen.group} (of which without a keyword: ${seen.groupNoMention})`,
);
console.log(`replies sent: ${seen.replies}; duplicate deliveries: ${seen.dupes}`);
if (seen.errors.length) console.log(`errors:\n  ${seen.errors.join('\n  ')}`);
process.exit(0);

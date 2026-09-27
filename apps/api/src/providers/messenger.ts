import type { Config } from '../config.ts';

export interface InboundMessage {
  /** The conversation (Spectrum space id); a plan binds to it. */
  spaceId: string;
  group: boolean;
  text: string;
  senderId: string | null;
}

/**
 * The plan's group chat in iMessage, through Photon Spectrum. The host creates the group (our agent's number plus
 * the plan link); the agent binds the thread from the link's token and posts into it from then on.
 */
export interface Messenger {
  readonly name: string;
  readonly enabled: boolean;
  /** The agent's iMessage address people add to the group. */
  readonly address: string | null;
  /** True once this process runs the stream (the worker); only then can it reach threads. */
  readonly listening: boolean;
  start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void>;
  /** False when the thread is not reachable now (Spectrum has no "get space by id"; it is known once it speaks). */
  send(spaceId: string, text: string): Promise<boolean>;
  stop(): Promise<void>;
}

export class OffMessenger implements Messenger {
  readonly name = 'off';
  readonly enabled = false;
  readonly address = null;
  readonly listening = false;
  async start() {}
  async send() {
    return false;
  }
  async stop() {}
}

/** Records sends; `receive` plays an inbound message. Every thread that has spoken is reachable. */
export class FakeMessenger implements Messenger {
  readonly name = 'fake';
  readonly enabled = true;
  readonly address = '+15550001234';
  listening = false;
  sent: { spaceId: string; text: string }[] = [];
  private live = new Set<string>();
  private handler?: (m: InboundMessage) => Promise<void>;
  async start(onMessage: (m: InboundMessage) => Promise<void>) {
    this.handler = onMessage;
    this.listening = true;
  }
  async receive(m: InboundMessage) {
    this.live.add(m.spaceId);
    await this.handler?.(m);
  }
  forget(spaceId: string) {
    this.live.delete(spaceId);
  }
  async send(spaceId: string, text: string) {
    if (!this.live.has(spaceId)) return false;
    this.sent.push({ spaceId, text });
    return true;
  }
  async stop() {}
}

interface SpaceLike {
  id: string;
  send(text: string): Promise<unknown>;
}
interface MessageLike {
  direction: 'inbound' | 'outbound';
  platform: string;
  content: { type: string; text?: string };
  sender?: { id?: string } | null;
}

/** Spectrum cloud iMessage: one long-lived stream in the worker process. */
export class PhotonMessenger implements Messenger {
  readonly name = 'photon';
  readonly enabled = true;
  listening = false;
  private spaces = new Map<string, SpaceLike>();
  private app?: { messages: AsyncIterable<[SpaceLike, MessageLike]>; stop(): Promise<void> };
  constructor(
    private projectId: string,
    private secret: string,
    readonly address: string | null,
  ) {}

  async start(onMessage: (m: InboundMessage) => Promise<void>) {
    this.listening = true;
    const { Spectrum } = await import('spectrum-ts');
    const { imessage } = await import('spectrum-ts/providers/imessage');
    this.app = (await Spectrum({
      projectId: this.projectId,
      projectSecret: this.secret,
      providers: [imessage.config()],
    })) as unknown as PhotonMessenger['app'];
    void (async () => {
      for await (const [space, message] of this.app!.messages) {
        this.spaces.set(space.id, space);
        if (message.direction !== 'inbound' || message.content.type !== 'text') continue;
        const type = (imessage as unknown as (s: SpaceLike) => { type?: string })(space).type;
        await onMessage({
          spaceId: space.id,
          group: type === 'group',
          text: message.content.text ?? '',
          senderId: message.sender?.id ?? null,
        }).catch((e) => console.warn(`[photon] handler failed: ${(e as Error).message}`));
      }
    })().catch((e) => console.warn(`[photon] stream ended: ${(e as Error).message}`));
  }

  async send(spaceId: string, text: string) {
    const space = this.spaces.get(spaceId);
    if (!space) return false;
    await space.send(text);
    return true;
  }

  async stop() {
    await this.app?.stop();
  }
}

export function createMessenger(c: Config): Messenger {
  return c.SPECTRUM_PROJECT_ID && c.SPECTRUM_PROJECT_SECRET
    ? new PhotonMessenger(
        c.SPECTRUM_PROJECT_ID,
        c.SPECTRUM_PROJECT_SECRET,
        c.PHOTON_AGENT_ADDRESS ?? null,
      )
    : new OffMessenger();
}

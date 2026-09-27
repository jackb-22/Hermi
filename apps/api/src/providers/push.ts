import type { Config } from '../config.ts';

export interface PushMessage {
  title: string;
  body: string;
  /** Deep-link data for the app, e.g. { kind: 'plan_invite', planId }. */
  data?: Record<string, string>;
}

export interface PushProvider {
  readonly name: string;
  /** Returns tokens Expo reports as no longer registered, so they can be dropped. */
  send(tokens: string[], msg: PushMessage): Promise<{ invalid: string[] }>;
}

/** Records instead of sending (tests, and before any device has registered). */
export class FakePush implements PushProvider {
  readonly name = 'fake';
  sent: { tokens: string[]; msg: PushMessage }[] = [];
  async send(tokens: string[], msg: PushMessage) {
    this.sent.push({ tokens, msg });
    return { invalid: [] };
  }
}

/** Expo push service (APNs underneath); no credentials needed for Expo-built apps. */
export class ExpoPush implements PushProvider {
  readonly name = 'expo';
  async send(tokens: string[], msg: PushMessage) {
    const valid = tokens.filter((t) => /^Expo(nent)?PushToken\[.+\]$/.test(t));
    if (!valid.length) return { invalid: tokens };
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(
        valid.map((to) => ({
          to,
          title: msg.title,
          body: msg.body,
          data: msg.data,
          sound: 'default',
        })),
      ),
    });
    if (!res.ok) throw new Error(`expo push ${res.status}: ${await res.text()}`);
    const tickets = (
      (await res.json()) as { data: { status: string; details?: { error?: string } }[] }
    ).data;
    const invalid = valid.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
    return { invalid: [...invalid, ...tokens.filter((t) => !valid.includes(t))] };
  }
}

export function createPush(c: Config): PushProvider {
  return c.NODE_ENV === 'test' || c.FAKE_PROVIDERS ? new FakePush() : new ExpoPush();
}

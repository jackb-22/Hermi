import http2, { type ClientHttp2Session, type OutgoingHttpHeaders } from 'node:http2';
import { APNS_TOKEN_RE } from '@itp/shared/api';
import type { Config } from '../config.ts';
import { appleDevToken } from './appleJwt.ts';

export interface PushMessage {
  title: string;
  body: string;
  /** Deep-link data for the app, e.g. { kind: 'plan_invite', planId }. */
  data?: Record<string, string>;
}

export interface PushProvider {
  readonly name: string;
  /**
   * Returns the tokens that can never receive a push (malformed, unregistered, wrong app or environment), so they
   * can be dropped. Throws only when nothing at all was delivered, so the job queue retries without re-sending to
   * devices that already got it.
   */
  send(tokens: string[], msg: PushMessage): Promise<{ invalid: string[] }>;
  /** Releases connections on shutdown. */
  close?(): Promise<void>;
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

const AUTHORITY = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};
/** APNs rejects provider tokens older than an hour and throttles minting more than one per 20 minutes. */
const TOKEN_TTL_MS = 50 * 60_000;
/** A regular alert payload may not exceed 4 KB. */
const MAX_PAYLOAD_BYTES = 4096;
/** 400 reasons that mean this token will never work for this app and environment. Any 410 means the same. */
const DEAD_TOKEN_REASONS = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic']);

export interface ApnsOptions {
  teamId: string;
  keyId: string;
  /** PKCS#8 PEM of the .p8; literal \n allowed. */
  privateKey: string;
  /** The app's bundle id, sent as apns-topic. */
  bundleId: string;
  sandbox?: boolean;
  /** Overrides the APNs host (tests point it at a local server; http:// speaks cleartext HTTP/2). */
  authority?: string;
  /** Requests in flight at once over the one session (APNs allows far more). */
  concurrency?: number;
  /** Per request, from first byte queued to response end. */
  timeoutMs?: number;
  /** A session with no traffic this long is closed; the next send reconnects. */
  idleMs?: number;
  now?: () => number;
}

type Outcome = { kind: 'sent' } | { kind: 'invalid' } | { kind: 'failed'; why: string };

/** Runs fn over items, at most `limit` at a time; fn must not reject. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

/**
 * Apple Push Notification service over HTTP/2 (node:http2; fetch has no HTTP/2). One long-lived session carries
 * every request, authenticated by a provider JWT from the shared Sign in with Apple .p8.
 */
export class ApnsPush implements PushProvider {
  readonly name: string;
  /** The APNs host in use, readable so boot logs and tests can see which environment was picked. */
  readonly authority: string;
  private concurrency: number;
  private timeoutMs: number;
  private idleMs: number;
  private now: () => number;
  private session?: ClientHttp2Session;
  private token?: { jwt: string; at: number };
  private minting?: Promise<string>;

  constructor(private o: ApnsOptions) {
    this.name = o.sandbox ? 'apns-sandbox' : 'apns';
    this.authority = o.authority ?? (o.sandbox ? AUTHORITY.sandbox : AUTHORITY.production);
    this.concurrency = o.concurrency ?? 20;
    this.timeoutMs = o.timeoutMs ?? 10_000;
    this.idleMs = o.idleMs ?? 10 * 60_000;
    this.now = o.now ?? Date.now;
  }

  async send(tokens: string[], msg: PushMessage) {
    const invalid: string[] = [];
    const valid: string[] = [];
    // Anything that is not an APNs hex token (an old Expo token, say) can never work, so it gets pruned.
    for (const t of new Set(tokens)) (APNS_TOKEN_RE.test(t) ? valid : invalid).push(t);
    if (!valid.length) return { invalid };

    const payload = this.payload(msg);
    const outcomes = await mapLimit(valid, this.concurrency, (t) => this.deliver(t, payload));

    const failures = new Map<string, number>();
    let sent = 0;
    outcomes.forEach((r, i) => {
      if (r.kind === 'sent') sent++;
      else if (r.kind === 'invalid') invalid.push(valid[i]!);
      else failures.set(r.why, (failures.get(r.why) ?? 0) + 1);
    });
    const failed = [...failures.values()].reduce((a, b) => a + b, 0);
    if (failed) {
      const why = [...failures].map(([w, n]) => `${w} x${n}`).join(', ');
      // Nothing delivered: throw so the queue retries. Some delivered: a retry would notify those devices twice.
      if (!sent) throw new Error(`apns: all ${failed} sends failed (${why})`);
      console.warn(`[apns] ${failed} of ${valid.length} sends failed: ${why}`);
    }
    return { invalid };
  }

  /** Closes the session, letting requests in flight finish (each is bounded by the timeout). */
  async close() {
    const s = this.session;
    this.session = undefined;
    if (!s || s.destroyed) return;
    await new Promise<void>((resolve) => {
      s.once('close', () => resolve());
      s.close();
    });
  }

  /** Custom keys sit beside `aps` (Apple's layout); spreading them first means they can never replace it. */
  private payload(msg: PushMessage) {
    const body = Buffer.from(
      JSON.stringify({
        ...msg.data,
        aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' },
      }),
    );
    if (body.length > MAX_PAYLOAD_BYTES)
      throw new Error(`apns: payload is ${body.length} bytes, over the ${MAX_PAYLOAD_BYTES} limit`);
    return body;
  }

  private async deliver(token: string, payload: Buffer): Promise<Outcome> {
    try {
      let jwt = await this.bearer();
      let r = await this.post(token, payload, jwt);
      if (r.status === 403 && r.reason === 'ExpiredProviderToken') {
        // Ours aged out (or the clock drifted): mint a new one and retry this request once.
        jwt = await this.bearer(jwt);
        r = await this.post(token, payload, jwt);
      }
      if (r.status === 200) return { kind: 'sent' };
      if (r.status === 410 || (r.status === 400 && DEAD_TOKEN_REASONS.has(r.reason ?? '')))
        return { kind: 'invalid' };
      return { kind: 'failed', why: `${r.status} ${r.reason ?? 'no reason'}` };
    } catch (err) {
      return { kind: 'failed', why: (err as Error).message };
    }
  }

  /** The cached provider token, or a new one when it is old or `stale` (the one APNs just refused). */
  private bearer(stale?: string): Promise<string> {
    const t = this.token;
    if (t && t.jwt !== stale && this.now() - t.at < TOKEN_TTL_MS) return Promise.resolve(t.jwt);
    // Requests that fail together share one mint, so a burst cannot trip APNs's refresh throttle.
    this.minting ??= this.mint().finally(() => {
      this.minting = undefined;
    });
    return this.minting;
  }

  private async mint() {
    const at = this.now();
    const jwt = await appleDevToken({
      teamId: this.o.teamId,
      keyId: this.o.keyId,
      privateKey: this.o.privateKey,
      ttlS: null,
      issuedAt: new Date(at),
    });
    this.token = { jwt, at };
    return jwt;
  }

  /** One POST /3/device/<token>; resolves with the status and APNs's `reason` for any response. */
  private post(token: string, payload: Buffer, jwt: string) {
    return new Promise<{ status: number; reason?: string }>((resolve, reject) => {
      const headers: OutgoingHttpHeaders = {
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        'apns-topic': this.o.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
      };
      const { session, req } = this.open(headers);
      let status = 0;
      const chunks: Buffer[] = [];
      // The timer stays referenced on purpose: the session does not hold the process open, a request in flight does.
      const timer = setTimeout(() => {
        req.close(http2.constants.NGHTTP2_CANCEL);
        // A connection that swallows requests would otherwise swallow every later one too.
        this.retire(session);
        reject(new Error(`apns: no response in ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      req.on('response', (h) => {
        status = Number(h[':status']);
      });
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let reason: string | undefined;
        try {
          reason = JSON.parse(Buffer.concat(chunks).toString() || '{}').reason;
        } catch {}
        resolve({ status, reason });
      });
      req.on('error', reject);
      // Settles only if neither 'end' nor 'error' did (a reset stream), and always stops the timer.
      req.on('close', () => {
        clearTimeout(timer);
        reject(new Error(`apns: stream closed (code ${req.rstCode})`));
      });
      req.end(payload);
    });
  }

  /** A request on the shared session; a session that went away since we last looked is replaced once. */
  private open(headers: OutgoingHttpHeaders) {
    for (let attempt = 0; ; attempt++) {
      const session = this.connect();
      try {
        return { session, req: session.request(headers) };
      } catch (err) {
        this.retire(session);
        if (attempt) throw err;
      }
    }
  }

  private connect(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
    const s = http2.connect(this.authority);
    // Shutdown does not have to wait for an idle connection (close() is the orderly way).
    s.unref();
    s.setTimeout(this.idleMs, () => this.retire(s));
    const forget = () => {
      if (this.session === s) this.session = undefined;
    };
    // Requests on a failed session reject with the same error; this listener only keeps it from being unhandled.
    s.on('error', (err) => {
      console.warn(`[apns] session error: ${err.message}`);
      forget();
    });
    s.on('goaway', forget);
    s.on('close', forget);
    this.session = s;
    return s;
  }

  /** Stops using a session: no new requests, those in flight get one more timeout to finish. */
  private retire(s: ClientHttp2Session) {
    if (this.session === s) this.session = undefined;
    if (s.destroyed) return;
    s.close();
    setTimeout(() => s.destroy(), this.timeoutMs).unref();
  }
}

let warnedFake = false;

export function createPush(c: Config): PushProvider {
  if (c.NODE_ENV === 'test' || c.FAKE_PROVIDERS) return new FakePush();
  if (c.APPLE_AUTH_KEY_ID && c.APPLE_AUTH_PRIVATE_KEY && c.APPLE_TEAM_ID && c.APPLE_BUNDLE_ID)
    return new ApnsPush({
      teamId: c.APPLE_TEAM_ID,
      keyId: c.APPLE_AUTH_KEY_ID,
      privateKey: c.APPLE_AUTH_PRIVATE_KEY,
      bundleId: c.APPLE_BUNDLE_ID,
      sandbox: c.APNS_SANDBOX,
    });
  if (!warnedFake) {
    warnedFake = true;
    console.warn(
      '[push] APPLE_AUTH_KEY_ID, APPLE_AUTH_PRIVATE_KEY, APPLE_TEAM_ID and APPLE_BUNDLE_ID are not all set: push is faked, no notification will be delivered',
    );
  }
  return new FakePush();
}

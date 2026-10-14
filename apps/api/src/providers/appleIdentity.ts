import { createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, decodeJwt, type JWTVerifyGetKey, jwtVerify } from 'jose';
import type { Config } from '../config.ts';
import { appleDevToken } from './appleJwt.ts';

export interface AppleIdentity {
  readonly name: string;
  /**
   * Returns Apple's stable user id (sub) for a valid identity token whose nonce claim is
   * SHA-256 hex of rawNonce, or throws.
   */
  verify(identityToken: string, rawNonce: string): Promise<{ sub: string; email?: string }>;
  /**
   * Trades the single-use authorization code for Apple's refresh token, which revoke() needs when the
   * account is deleted. sub is the user the identity token was verified for; throws if the code is for
   * anyone else or Apple refuses it.
   */
  exchangeCode(code: string, sub: string): Promise<string>;
  /** Ends the app's access for this user on Apple's side (App Store rule for account deletion). Throws if Apple refuses. */
  revoke(refreshToken: string): Promise<void>;
}

const APPLE_ISSUER = 'https://appleid.apple.com';
/** A user waits on these calls (sign-in, delete account), so give up sooner than the 15 s other providers allow. */
const APPLE_TIMEOUT_MS = 10_000;
/** Apple accepts a client secret for up to 6 months; ours is minted per call, so it only has to outlive the request. */
const CLIENT_SECRET_TTL_S = 300;

export interface RealAppleOptions {
  /** APPLE_BUNDLE_ID: the identity token's audience and, for a native app, the client_id. */
  clientId: string;
  /** The .p8 shared with APNs signs the client secret. Optional so token checks work without it; exchange and revoke then throw. */
  teamId?: string;
  keyId?: string;
  privateKey?: string;
  /** Apple's public keys; tests pass a local set. */
  jwks?: JWTVerifyGetKey;
  /** Tests stub Apple's endpoints here instead of reaching the network. */
  fetch?: typeof fetch;
}

/** Apple puts SHA-256 hex (lowercase) of the nonce the app sent into the token; compare it to the raw one the app gave us. */
function nonceMatches(rawNonce: string, claim: unknown) {
  if (typeof claim !== 'string') return false;
  const want = Buffer.from(createHash('sha256').update(rawNonce).digest('hex'));
  const got = Buffer.from(claim);
  return want.length === got.length && timingSafeEqual(want, got);
}

export class RealAppleIdentity implements AppleIdentity {
  readonly name = 'apple';
  private jwks: JWTVerifyGetKey;
  constructor(private o: RealAppleOptions) {
    this.jwks = o.jwks ?? createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));
  }

  async verify(token: string, rawNonce: string) {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: APPLE_ISSUER,
      audience: this.o.clientId,
    });
    if (!payload.sub) throw new Error('no sub');
    if (!nonceMatches(rawNonce, payload.nonce)) throw new Error('nonce missing or mismatched');
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  }

  async exchangeCode(code: string, sub: string) {
    const res = await this.post('token', { grant_type: 'authorization_code', code });
    const body = (await res.json()) as { refresh_token?: unknown; id_token?: unknown };
    if (typeof body.refresh_token !== 'string' || !body.refresh_token)
      throw new Error('apple token response has no refresh_token');
    // Straight from Apple over TLS, so decoding without checking the signature is enough to see whose it is.
    if (typeof body.id_token !== 'string' || decodeJwt(body.id_token).sub !== sub)
      throw new Error('apple token response is for a different user');
    return body.refresh_token;
  }

  async revoke(refreshToken: string) {
    const res = await this.post('revoke', {
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });
    await res.body?.cancel();
  }

  /** Form POST to Apple's token endpoints with a fresh client secret. Errors carry Apple's error code only, never the request. */
  private async post(path: 'token' | 'revoke', params: Record<string, string>) {
    const { clientId, teamId, keyId, privateKey } = this.o;
    if (!teamId || !keyId || !privateKey)
      throw new Error(
        'Sign in with Apple key not configured (APPLE_TEAM_ID, APPLE_AUTH_KEY_ID, APPLE_AUTH_PRIVATE_KEY)',
      );
    const clientSecret = await appleDevToken({
      teamId,
      keyId,
      privateKey,
      ttlS: CLIENT_SECRET_TTL_S,
      sub: clientId,
      audience: APPLE_ISSUER,
    });
    const res = await (this.o.fetch ?? fetch)(`${APPLE_ISSUER}/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        ...params,
      }).toString(),
      signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const code = ((await res.json().catch(() => null)) as { error?: unknown } | null)?.error;
      throw new Error(
        `apple ${path} ${res.status}${typeof code === 'string' && /^\w{1,40}$/.test(code) ? ` ${code}` : ''}`,
      );
    }
    return res;
  }
}

/** Dev/test: accepts "fake:<sub>" so flows can be exercised before the Apple account exists. */
export class FakeAppleIdentity implements AppleIdentity {
  readonly name = 'fake';
  /** Refresh tokens passed to revoke(), for tests. */
  readonly revoked: string[] = [];
  /** The nonce and code are not checked: there is no Apple to have issued them. */
  async verify(token: string) {
    const m = /^fake:([\w.-]{1,64})$/.exec(token);
    if (!m) throw new Error('fake apple identity expects "fake:<sub>"');
    return { sub: m[1]! };
  }
  async exchangeCode(_code: string, sub: string) {
    return `fake-refresh:${sub}`;
  }
  async revoke(refreshToken: string) {
    this.revoked.push(refreshToken);
  }
}

export function createAppleIdentity(c: Config): AppleIdentity {
  return c.APPLE_BUNDLE_ID
    ? new RealAppleIdentity({
        clientId: c.APPLE_BUNDLE_ID,
        teamId: c.APPLE_TEAM_ID,
        keyId: c.APPLE_AUTH_KEY_ID,
        privateKey: c.APPLE_AUTH_PRIVATE_KEY,
      })
    : new FakeAppleIdentity();
}

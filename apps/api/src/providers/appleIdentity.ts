import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Config } from '../config.ts';

export interface AppleIdentity {
  readonly name: string;
  /** Returns Apple's stable user id (sub) for a valid identity token, or throws. */
  verify(identityToken: string): Promise<{ sub: string; email?: string }>;
}

const APPLE_ISSUER = 'https://appleid.apple.com';

export class RealAppleIdentity implements AppleIdentity {
  readonly name = 'apple';
  private jwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
  constructor(private audience: string) {}
  async verify(token: string) {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: APPLE_ISSUER,
      audience: this.audience,
    });
    if (!payload.sub) throw new Error('no sub');
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  }
}

/** Dev/test: accepts "fake:<sub>" so flows can be exercised before the Apple account exists. */
export class FakeAppleIdentity implements AppleIdentity {
  readonly name = 'fake';
  async verify(token: string) {
    const m = /^fake:([\w.-]{1,64})$/.exec(token);
    if (!m) throw new Error('fake apple identity expects "fake:<sub>"');
    return { sub: m[1]! };
  }
}

export function createAppleIdentity(c: Config): AppleIdentity {
  return c.APPLE_BUNDLE_ID ? new RealAppleIdentity(c.APPLE_BUNDLE_ID) : new FakeAppleIdentity();
}

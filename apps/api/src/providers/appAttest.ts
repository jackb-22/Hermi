import { verifyAssertion, verifyAttestation } from 'node-app-attest';
import type { Config } from '../config.ts';

export interface AppAttestVerifier {
  readonly name: string;
  attestation(o: { attestation: Buffer; challenge: string; keyId: string }): { publicKey: string };
  assertion(o: { assertion: Buffer; payload: Buffer | string; publicKey: string; signCount: number }): { signCount: number };
}

/** Apple App Attest (real devices only; the Simulator cannot attest). */
export class RealAppAttest implements AppAttestVerifier {
  readonly name = 'apple';
  constructor(
    private bundleIdentifier: string,
    private teamIdentifier: string,
    private allowDev: boolean,
  ) {}
  attestation(o: { attestation: Buffer; challenge: string; keyId: string }) {
    const r = verifyAttestation({ ...o, bundleIdentifier: this.bundleIdentifier, teamIdentifier: this.teamIdentifier, allowDevelopmentEnvironment: this.allowDev });
    return { publicKey: r.publicKey as string };
  }
  assertion(o: { assertion: Buffer; payload: Buffer | string; publicKey: string; signCount: number }) {
    const r = verifyAssertion({ ...o, bundleIdentifier: this.bundleIdentifier, teamIdentifier: this.teamIdentifier });
    return { signCount: r.signCount as number };
  }
}

/** Without Apple credentials nothing can be verified; everything reads as unattested. */
export class UnavailableAppAttest implements AppAttestVerifier {
  readonly name = 'unavailable';
  attestation(): never {
    throw new Error('App Attest not configured (APPLE_TEAM_ID / APPLE_BUNDLE_ID)');
  }
  assertion(): never {
    throw new Error('App Attest not configured');
  }
}

export function createAppAttest(c: Config): AppAttestVerifier {
  return c.APPLE_TEAM_ID && c.APPLE_BUNDLE_ID ? new RealAppAttest(c.APPLE_BUNDLE_ID, c.APPLE_TEAM_ID, c.NODE_ENV !== 'production' || c.DEV_ROUTES) : new UnavailableAppAttest();
}

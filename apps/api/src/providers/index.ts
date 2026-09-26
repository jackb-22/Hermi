import type { Config } from '../config.ts';
import { type AppleIdentity, createAppleIdentity } from './appleIdentity.ts';
import { type EmailProvider, createEmail } from './email.ts';

/** Every external service sits behind an interface with a fake, chosen by which keys are configured. */
export interface Providers {
  email: EmailProvider;
  appleIdentity: AppleIdentity;
}

export function createProviders(c: Config): Providers {
  return { email: createEmail(c), appleIdentity: createAppleIdentity(c) };
}

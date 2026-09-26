import type { Config } from '../config.ts';
import { type AppAttestVerifier, createAppAttest } from './appAttest.ts';
import { type AppleIdentity, createAppleIdentity } from './appleIdentity.ts';
import { type EmailProvider, createEmail } from './email.ts';
import { type EtaProvider, createEta } from './eta.ts';
import { type HoursProvider, createHours } from './hours.ts';
import { type Llm, createLlm } from './llm.ts';
import { type Storage, createStorage } from './storage.ts';
import { type WeatherProvider, createWeather } from './weather.ts';

/** Every external service sits behind an interface with a fake, chosen by which keys are configured. */
export interface Providers {
  email: EmailProvider;
  appleIdentity: AppleIdentity;
  appAttest: AppAttestVerifier;
  eta: EtaProvider;
  hours: HoursProvider;
  llm: Llm;
  weather: WeatherProvider;
  storage: Storage;
}

export function createProviders(c: Config): Providers {
  return {
    email: createEmail(c),
    appleIdentity: createAppleIdentity(c),
    appAttest: createAppAttest(c),
    eta: createEta(c),
    hours: createHours(c),
    llm: createLlm(c),
    weather: createWeather(c),
    storage: createStorage(c),
  };
}

/** One line per provider for boot logs and /health debugging. */
export const describeProviders = (p: Providers) =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, (v as { name: string }).name]));

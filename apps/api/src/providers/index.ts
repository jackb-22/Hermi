import type { Config } from '../config.ts';
import { type AppAttestVerifier, createAppAttest } from './appAttest.ts';
import { type AppleIdentity, createAppleIdentity } from './appleIdentity.ts';
import { type Backboard, createBackboard } from './backboard.ts';
import { type Credentials, createCredentials } from './c2pa.ts';
import { createDetector, type Detector } from './detector.ts';
import { createEmail, type EmailProvider } from './email.ts';
import { createEta, type EtaProvider } from './eta.ts';
import { createHours, type HoursProvider } from './hours.ts';
import { createLlm, type Llm } from './llm.ts';
import { createMessenger, type Messenger } from './messenger.ts';
import { createPush, type PushProvider } from './push.ts';
import { createStorage, type Storage } from './storage.ts';
import { createWeather, type WeatherProvider } from './weather.ts';

/** Every external service sits behind an interface with a fake, chosen by which keys are configured. */
export interface Providers {
  email: EmailProvider;
  appleIdentity: AppleIdentity;
  appAttest: AppAttestVerifier;
  eta: EtaProvider;
  hours: HoursProvider;
  llm: Llm;
  backboard: Backboard;
  weather: WeatherProvider;
  storage: Storage;
  push: PushProvider;
  c2pa: Credentials;
  detector: Detector;
  messenger: Messenger;
}

export function createProviders(c: Config): Providers {
  return {
    email: createEmail(c),
    appleIdentity: createAppleIdentity(c),
    appAttest: createAppAttest(c),
    eta: createEta(c),
    hours: createHours(c),
    llm: createLlm(c),
    backboard: createBackboard(c),
    weather: createWeather(c),
    storage: createStorage(c),
    push: createPush(c),
    c2pa: createCredentials(c),
    detector: createDetector(c),
    messenger: createMessenger(c),
  };
}

/** One line per provider for boot logs and /health debugging. */
export const describeProviders = (p: Providers) =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, (v as { name: string }).name]));

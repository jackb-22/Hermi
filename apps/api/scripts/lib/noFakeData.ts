import type { Config } from '../../src/config.ts';

/** The MongoDB database production data lives in (docs/DEPLOYMENT.md T4: MONGO_DB=hermi). */
export const PRODUCTION_DB = 'hermi';

/** Why fake people or demo rows must not be written under this config, or undefined when they may. */
export function fakeDataBlocker(c: Pick<Config, 'NODE_ENV' | 'MONGO_DB'>): string | undefined {
  if (c.NODE_ENV === 'production') return 'NODE_ENV is production';
  if (c.MONGO_DB === PRODUCTION_DB) return `MONGO_DB is ${PRODUCTION_DB}, the production database`;
  return undefined;
}

/**
 * First line of any script that writes fake users, fake check-ins or demo places (production has no fake
 * people, DEPLOYMENT.md D2). Exits with the reason; a demo database needs its own MONGO_DB and a non-production
 * NODE_ENV (a variable already in the shell wins over --env-file).
 */
export function refuseFakeData(script: string, c: Pick<Config, 'NODE_ENV' | 'MONGO_DB'>) {
  const why = fakeDataBlocker(c);
  if (!why) return;
  console.error(
    `${script} writes fake people or demo data, so it refuses to run here: ${why}.\n` +
      `Use a demo database (MONGO_DB other than ${PRODUCTION_DB}) with NODE_ENV=development.`,
  );
  process.exit(2);
}

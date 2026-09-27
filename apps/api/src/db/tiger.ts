import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// timestamptz -> Date is default; bigint sums come back as strings, parse them.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v));

/** Tiger Cloud signs its servers with its own root (O=Timescale Inc, CN=ca.timescale.com), not a public CA. */
const TIGER_CA = fileURLToPath(new URL('./tiger-ca.pem', import.meta.url));

/**
 * TLS for Tiger Cloud, fully verified (chain and hostname) against Tiger's root CA, or `caPem` when given.
 * sslmode comes out of the URL because pg turns it into its own ssl settings, which would replace these.
 */
export function tigerConnection(
  url: string,
  caPem?: string,
): { connectionString: string; ssl?: pg.PoolConfig['ssl'] } {
  const u = new URL(url);
  if (!caPem && !u.hostname.endsWith('.tsdb.cloud.timescale.com')) return { connectionString: url };
  u.searchParams.delete('sslmode');
  const ca = caPem ? caPem.replace(/\\n/g, '\n') : readFileSync(TIGER_CA, 'utf8');
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}

export function createTigerPool(url: string, schema = 'public', caPem?: string): pg.Pool {
  return new pg.Pool({
    ...tigerConnection(url, caPem),
    max: 10,
    options: schema === 'public' ? undefined : `-c search_path=${schema},public`,
  });
}

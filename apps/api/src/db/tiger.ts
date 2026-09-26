import pg from 'pg';

// timestamptz -> Date is default; bigint sums come back as strings, parse them.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v));

export function createTigerPool(url: string, schema = 'public'): pg.Pool {
  const ssl = /sslmode=require|tsdb\.cloud|timescale\.com/.test(url)
    ? { rejectUnauthorized: false }
    : undefined;
  return new pg.Pool({
    connectionString: url,
    max: 10,
    ssl,
    options: schema === 'public' ? undefined : `-c search_path=${schema},public`,
  });
}

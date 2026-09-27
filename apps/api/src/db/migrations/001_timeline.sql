-- Tiger holds things that happened. Tiger rows are the source of truth for events.
-- Every statement is re-runnable: they run outside a transaction, so a crash mid-file is finished next boot.

CREATE TABLE IF NOT EXISTS location_points (
  time       timestamptz NOT NULL,
  user_id    text NOT NULL,
  session_id text NOT NULL,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  accuracy   real,
  speed      real
) WITH (tsdb.hypertable, tsdb.partition_column = 'time', tsdb.segmentby = 'user_id');
CREATE INDEX IF NOT EXISTS location_points_session ON location_points (session_id, time);

CREATE TABLE IF NOT EXISTS movement_segments (
  time       timestamptz NOT NULL,
  end_time   timestamptz NOT NULL,
  user_id    text NOT NULL,
  session_id text NOT NULL,
  mode       text NOT NULL,
  meters     double precision NOT NULL,
  steps      integer NOT NULL DEFAULT 0
) WITH (tsdb.hypertable, tsdb.partition_column = 'time', tsdb.segmentby = 'user_id');

CREATE TABLE IF NOT EXISTS checkins (
  time       timestamptz NOT NULL,
  id         text NOT NULL,
  user_id    text NOT NULL,
  place_id   text NOT NULL,
  tier       text NOT NULL,
  plan_id    text,
  session_id text,
  lat        double precision,
  lng        double precision,
  accuracy   real,
  attested   boolean NOT NULL DEFAULT false,
  tag_id     text
) WITH (tsdb.hypertable, tsdb.partition_column = 'time', tsdb.segmentby = 'user_id');
CREATE INDEX IF NOT EXISTS checkins_id ON checkins (id);
CREATE INDEX IF NOT EXISTS checkins_user_place ON checkins (user_id, place_id, time DESC);
CREATE INDEX IF NOT EXISTS checkins_place ON checkins (place_id, time DESC);

CREATE TABLE IF NOT EXISTS tag_reads (
  time      timestamptz NOT NULL,
  id        text NOT NULL,
  user_id   text NOT NULL,
  tag_id    text NOT NULL,
  tag_kind  text NOT NULL,
  lat       double precision,
  lng       double precision,
  accuracy  real,
  attested  boolean NOT NULL DEFAULT false
) WITH (tsdb.hypertable, tsdb.partition_column = 'time', tsdb.segmentby = 'user_id');
CREATE INDEX IF NOT EXISTS tag_reads_tag ON tag_reads (tag_id, time DESC);
CREATE INDEX IF NOT EXISTS tag_reads_user ON tag_reads (user_id, time DESC);

CREATE TABLE IF NOT EXISTS hangouts (
  time      timestamptz NOT NULL,
  pair_key  text NOT NULL,
  source    text NOT NULL,
  place_id  text
) WITH (tsdb.hypertable, tsdb.partition_column = 'time', tsdb.segmentby = 'pair_key');

CREATE TABLE IF NOT EXISTS xp_events (
  time    timestamptz NOT NULL,
  user_id text NOT NULL,
  campus  text,
  kind    text NOT NULL,
  xp      integer NOT NULL,
  ref_id  text
) WITH (tsdb.hypertable, tsdb.partition_column = 'time', tsdb.segmentby = 'user_id');
CREATE INDEX IF NOT EXISTS xp_events_user ON xp_events (user_id, time DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS xp_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 day', time) AS day, user_id, campus, sum(xp) AS xp
FROM xp_events
GROUP BY day, user_id, campus
WITH NO DATA;

SELECT add_continuous_aggregate_policy('xp_daily',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes',
  if_not_exists => true);

CREATE MATERIALIZED VIEW IF NOT EXISTS movement_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 day', time) AS day, user_id, mode, sum(meters) AS meters, sum(steps) AS steps
FROM movement_segments
GROUP BY day, user_id, mode
WITH NO DATA;

SELECT add_continuous_aggregate_policy('movement_daily',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes',
  if_not_exists => true);

SELECT add_retention_policy('location_points', INTERVAL '90 days', if_not_exists => true);

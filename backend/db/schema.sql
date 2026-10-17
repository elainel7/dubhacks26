-- Posture tracking schema for Tiger Data (TimescaleDB on Postgres)

CREATE TABLE IF NOT EXISTS users (
  user_id      TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posture_events (
  time       TIMESTAMPTZ NOT NULL,
  user_id    TEXT NOT NULL,
  label      TEXT NOT NULL,            -- e.g. 'good', 'slouching', 'leaning_forward', 'head_tilt'
  confidence DOUBLE PRECISION
) WITH (
  tsdb.hypertable,
  tsdb.segmentby = 'user_id',
  tsdb.orderby = 'time DESC'
);

CREATE INDEX IF NOT EXISTS posture_events_user_time_idx ON posture_events (user_id, time DESC);

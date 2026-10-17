-- Per-user, per-minute rollup for the dashboard
CREATE MATERIALIZED VIEW IF NOT EXISTS posture_per_minute
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  user_id,
  count(*)                                  AS samples,
  count(*) FILTER (WHERE label = 'good')    AS good_samples,
  count(*) FILTER (WHERE label <> 'good')   AS bad_samples,
  avg(confidence)                           AS avg_confidence
FROM posture_events
GROUP BY bucket, user_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('posture_per_minute',
  start_offset => INTERVAL '1 hour',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => true);

CREATE TABLE IF NOT EXISTS section_engagement (
  doc_type TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  term TEXT NOT NULL,
  section_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, doc_id, term, section_id)
);

-- Covering index for the suggestions read: equality filter on
-- (doc_type, doc_id, term), then ORDER BY count DESC, section_id ASC for the
-- deterministic top-N, plus SUM(count) for the sample-size gate. SQLite uses
-- type affinity, so INTEGER (matching the 0002 idiom) ensures D1 returns
-- `count` and its SUM as JS numbers rather than strings.
CREATE INDEX IF NOT EXISTS idx_section_engagement_lookup
  ON section_engagement(doc_type, doc_id, term, count DESC, section_id);

-- Per-client, per-minute write rate-limit buckets for /api/events. `bucket` is
-- a short-lived hash derived from the client IP and epoch minute; raw IPs are
-- never stored. `expiresAt` (ms) lets the limiter opportunistically prune stale
-- rows. Best-effort: a missing/erroring store never blocks a write.
CREATE TABLE IF NOT EXISTS engagement_rate (
  bucket    TEXT NOT NULL PRIMARY KEY,
  count     INTEGER NOT NULL DEFAULT 0,
  expiresAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_engagement_rate_expires
  ON engagement_rate(expiresAt);

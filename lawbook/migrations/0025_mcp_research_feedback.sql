-- Private research snapshots share the parent activity's 30-day lifecycle.
CREATE TABLE mcp_research (
  activityId TEXT PRIMARY KEY REFERENCES mcp_activity(id) ON DELETE CASCADE,
  requestText TEXT NOT NULL,
  replyText TEXT NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  rating TEXT CHECK (rating IN ('helpful', 'not_helpful')),
  comment TEXT,
  sharedAnswer TEXT,
  ratedAt INTEGER
);

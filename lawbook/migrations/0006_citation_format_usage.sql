CREATE TABLE IF NOT EXISTS citation_format_usage (
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('legal', 'apa7', 'mla', 'chicago')),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  firstUsedAt INTEGER NOT NULL,
  lastUsedAt INTEGER NOT NULL,
  PRIMARY KEY (userId, format)
);

CREATE INDEX IF NOT EXISTS idx_citation_format_usage_user_last
  ON citation_format_usage (userId, lastUsedAt DESC);

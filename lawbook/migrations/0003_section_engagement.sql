CREATE TABLE IF NOT EXISTS section_engagement (
  doc_type TEXT NOT NULL CHECK (doc_type IN ('judgment', 'statute')),
  doc_id TEXT NOT NULL,
  term TEXT NOT NULL,
  section_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (doc_type, doc_id, term, section_id)
);

CREATE INDEX IF NOT EXISTS idx_section_engagement_lookup
  ON section_engagement (doc_type, doc_id, term, count DESC);

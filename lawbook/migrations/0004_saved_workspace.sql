CREATE TABLE IF NOT EXISTS saved_authorities (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  docType TEXT NOT NULL CHECK (docType IN ('judgment', 'statute')),
  docId TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_authorities_user_doc
  ON saved_authorities (userId, docType, docId);

CREATE INDEX IF NOT EXISTS idx_saved_authorities_user_created
  ON saved_authorities (userId, createdAt DESC, id DESC);

CREATE TABLE IF NOT EXISTS saved_highlights (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  docType TEXT NOT NULL CHECK (docType IN ('judgment', 'statute')),
  docId TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  sectionId TEXT,
  selectedText TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_highlights_user_created
  ON saved_highlights (userId, createdAt DESC, id DESC);

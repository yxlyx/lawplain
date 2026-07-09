CREATE TABLE IF NOT EXISTS recently_viewed_documents (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  docType TEXT NOT NULL CHECK (docType IN ('judgment', 'statute', 'hansard', 'bills', 'subsidiary', 'practice')),
  docId TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  viewedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recently_viewed_documents_user_doc
  ON recently_viewed_documents(userId, docType, docId);

CREATE INDEX IF NOT EXISTS idx_recently_viewed_documents_user_viewed
  ON recently_viewed_documents(userId, viewedAt DESC, id DESC);

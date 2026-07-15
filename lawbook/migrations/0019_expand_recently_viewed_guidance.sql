CREATE TABLE recently_viewed_documents_new (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  docType TEXT NOT NULL CHECK (docType IN ('judgment', 'statute', 'hansard', 'bills', 'subsidiary', 'practice', 'guidance')),
  docId TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  viewedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

INSERT INTO recently_viewed_documents_new (
  id,
  userId,
  docType,
  docId,
  title,
  path,
  viewedAt,
  createdAt,
  updatedAt
)
SELECT
  id,
  userId,
  docType,
  docId,
  title,
  path,
  viewedAt,
  createdAt,
  updatedAt
FROM recently_viewed_documents;

DROP TABLE recently_viewed_documents;
ALTER TABLE recently_viewed_documents_new RENAME TO recently_viewed_documents;

CREATE UNIQUE INDEX idx_recently_viewed_documents_user_doc
  ON recently_viewed_documents (userId, docType, docId);

CREATE INDEX idx_recently_viewed_documents_user_viewed
  ON recently_viewed_documents (userId, viewedAt DESC, updatedAt DESC, id DESC);

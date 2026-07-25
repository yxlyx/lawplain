-- Document-level private notes (#194).
--
-- One note per authority per owner, enforced by a unique index rather than by
-- application code, so a double submit cannot leave a reader with two competing
-- scratchpads for the same judgment. The owner-bound composite foreign key is
-- the same shape passage_annotations uses, so a note can never reference another
-- user's authority root.
CREATE TABLE document_notes (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  authorityId TEXT NOT NULL,
  title TEXT NOT NULL,
  citation TEXT NOT NULL,
  path TEXT NOT NULL,
  -- Length-bounded rather than enum-bounded, matching annotation labels: new
  -- templates ship without a table rebuild, and a note written under a template
  -- this release does not know still resolves to a readable name.
  template TEXT NOT NULL
    CHECK (length(template) BETWEEN 1 AND 64),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 50000),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (userId, authorityId)
    REFERENCES saved_authorities (userId, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_document_notes_owner_authority
  ON document_notes (userId, authorityId);
CREATE INDEX idx_document_notes_owner_activity
  ON document_notes (userId, updatedAt DESC, id DESC);

-- There is no deletedAt column: #194 asks for permanent deletion, not the
-- 10-second Undo contract passage_annotations carries for legacy saved_quotes.
-- A note is deleted outright, and the API reports that plainly.
--
-- A document note keeps its library root alive exactly as an annotation does;
-- creating one registers a row in private_research_authority_guards, and
-- deleteAnnotation only drops the root once no note and no annotation remain.
-- Without that, deleting the last highlight on a document would drop the root
-- and cascade the reader's note away with it.

-- Private organisation and follow-up state (#197, #199).
--
-- Landed together because My Library (#195) filters on both, and a card that
-- could not count unresolved follow-ups or filter by tag would have to be rebuilt
-- when each arrived.

-- passage_annotations.id is already the primary key, but an owner-bound composite
-- foreign key needs (userId, id) to be unique in its own right. Same shape the
-- saved_authorities root uses, so a follow-up can never reference another user's
-- annotation even if its id were guessed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_passage_annotations_owner_id
  ON passage_annotations (userId, id);

-- Follow up is tracked state, not a colour. Keying on the annotation rather than
-- on its label is what makes #199's promise hold: renaming, recolouring, or
-- archiving the "Follow up" label cannot lose the open/resolved state, because
-- the state never lived in the label.
CREATE TABLE annotation_follow_ups (
  userId TEXT NOT NULL,
  annotationId TEXT NOT NULL,
  note TEXT CHECK (note IS NULL OR length(note) <= 2000),
  -- Stored as a UTC instant. The client formats in the reader's zone; overdue is
  -- computed against the same instant so it cannot flip with a timezone change.
  dueAt INTEGER,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  resolvedAt INTEGER,
  PRIMARY KEY (userId, annotationId),
  FOREIGN KEY (userId, annotationId)
    REFERENCES passage_annotations (userId, id) ON DELETE CASCADE
);

CREATE INDEX idx_annotation_follow_ups_open
  ON annotation_follow_ups (userId, resolvedAt, dueAt);

-- Tags describe topics across documents; collections group authorities for a
-- matter. Both are owner-scoped, both are case-insensitively unique per owner so
-- "Negligence" and "negligence" cannot become two tags, and both archive rather
-- than force a destructive delete.
CREATE TABLE research_tags (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  archivedAt INTEGER
);

CREATE UNIQUE INDEX idx_research_tags_owner_name
  ON research_tags (userId, name COLLATE NOCASE);

CREATE TABLE research_collections (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 2000),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  archivedAt INTEGER
);

CREATE UNIQUE INDEX idx_research_collections_owner_name
  ON research_collections (userId, name COLLATE NOCASE);

-- Membership cascades from either side, so deleting a tag removes memberships and
-- never the authority: the ON DELETE CASCADE points at the membership row only.
CREATE TABLE research_tag_members (
  userId TEXT NOT NULL,
  tagId TEXT NOT NULL,
  authorityId TEXT NOT NULL,
  addedAt INTEGER NOT NULL,
  PRIMARY KEY (userId, tagId, authorityId),
  FOREIGN KEY (userId, authorityId)
    REFERENCES saved_authorities (userId, id) ON DELETE CASCADE,
  FOREIGN KEY (tagId) REFERENCES research_tags (id) ON DELETE CASCADE
);

CREATE INDEX idx_research_tag_members_authority
  ON research_tag_members (userId, authorityId);

CREATE TABLE research_collection_members (
  userId TEXT NOT NULL,
  collectionId TEXT NOT NULL,
  authorityId TEXT NOT NULL,
  addedAt INTEGER NOT NULL,
  -- Explicit ordering within a collection; ties fall back to addedAt.
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (userId, collectionId, authorityId),
  FOREIGN KEY (userId, authorityId)
    REFERENCES saved_authorities (userId, id) ON DELETE CASCADE,
  FOREIGN KEY (collectionId) REFERENCES research_collections (id) ON DELETE CASCADE
);

CREATE INDEX idx_research_collection_members_authority
  ON research_collection_members (userId, authorityId);

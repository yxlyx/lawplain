-- Canonical private-research document roots. Existing rows are explicit saves.
ALTER TABLE saved_authorities ADD COLUMN citation TEXT NOT NULL DEFAULT '';
ALTER TABLE saved_authorities ADD COLUMN savedAt INTEGER;
ALTER TABLE saved_authorities ADD COLUMN activityAt INTEGER NOT NULL DEFAULT 0;

UPDATE saved_authorities
SET savedAt = createdAt,
    activityAt = CASE WHEN updatedAt > createdAt THEN updatedAt ELSE createdAt END;

-- Required by passage_annotations' owner-bound composite foreign key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_authorities_user_id
  ON saved_authorities (userId, id);
CREATE INDEX IF NOT EXISTS idx_saved_authorities_user_activity
  ON saved_authorities (userId, activityAt DESC, id DESC);

CREATE TABLE passage_annotations (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  authorityId TEXT NOT NULL,
  title TEXT NOT NULL,
  citation TEXT NOT NULL,
  path TEXT NOT NULL,
  exactText TEXT NOT NULL CHECK (length(exactText) BETWEEN 1 AND 5000),
  anchor TEXT NOT NULL,
  startOffset INTEGER NOT NULL CHECK (startOffset >= 0),
  endOffset INTEGER NOT NULL CHECK (endOffset >= startOffset),
  contextBefore TEXT NOT NULL,
  contextAfter TEXT NOT NULL,
  note TEXT CHECK (note IS NULL OR length(note) <= 10000),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  FOREIGN KEY (userId, authorityId)
    REFERENCES saved_authorities (userId, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_passage_annotations_owner_location
  ON passage_annotations (
    userId, authorityId, anchor, startOffset, endOffset, exactText
  );
CREATE INDEX idx_passage_annotations_owner_activity
  ON passage_annotations (userId, updatedAt DESC, id DESC);
CREATE INDEX idx_passage_annotations_owner_authority
  ON passage_annotations (userId, authorityId, createdAt DESC, id DESC);

-- Capture one millisecond-precision cutoff for a consistent migration snapshot.
CREATE TABLE private_research_migration_clock (restoreCutoff INTEGER NOT NULL);
INSERT INTO private_research_migration_clock (restoreCutoff)
VALUES (
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) - 10000
);

-- Every active or still-restorable legacy quote becomes a canonical library
-- root. Existing explicit roots win, retaining their identity and savedAt.
-- Quote-only roots are not explicit bookmarks.
INSERT INTO saved_authorities (
  id, userId, docType, docId, title, path, createdAt, updatedAt,
  citation, savedAt, activityAt
)
SELECT
  'quote-root:' || q.id, q.userId, q.docType, q.docId, q.sourceTitle,
  CASE WHEN instr(q.path, '#') > 0
    THEN substr(q.path, 1, instr(q.path, '#') - 1) ELSE q.path END,
  q.createdAt, q.createdAt, q.citation, NULL, q.createdAt
FROM saved_quotes q
WHERE q.deletedAt IS NULL OR q.deletedAt >=
  (SELECT restoreCutoff FROM private_research_migration_clock)
ON CONFLICT(userId, docType, docId) DO UPDATE SET
  citation = CASE WHEN saved_authorities.citation = '' THEN excluded.citation
    ELSE saved_authorities.citation END,
  activityAt = CASE
    WHEN excluded.activityAt > saved_authorities.activityAt
      THEN excluded.activityAt ELSE saved_authorities.activityAt END;

-- Annotation IDs equal old quote IDs when the location is unique. If legacy
-- duplicates exist, the first insert wins and quote aliases below keep every
-- old deep link resolving. Only legacy DELETE/restore compatibility synchronizes
-- saved_quotes tombstones after migration; canonical creation never mirrors rows.
INSERT INTO passage_annotations (
  id, userId, authorityId, title, citation, path, exactText, anchor,
  startOffset, endOffset, contextBefore, contextAfter, note, createdAt,
  updatedAt, deletedAt
)
SELECT
  q.id, q.userId, a.id, q.sourceTitle, q.citation, q.path, q.exactText,
  q.anchor, q.startOffset, q.endOffset, q.contextBefore, q.contextAfter,
  NULL, q.createdAt, COALESCE(q.deletedAt, q.createdAt), q.deletedAt
FROM saved_quotes q
JOIN saved_authorities a
  ON a.userId = q.userId AND a.docType = q.docType AND a.docId = q.docId
WHERE q.deletedAt IS NULL OR q.deletedAt >=
  (SELECT restoreCutoff FROM private_research_migration_clock)
ON CONFLICT(userId, authorityId, anchor, startOffset, endOffset, exactText)
DO UPDATE SET
  deletedAt = CASE
    WHEN passage_annotations.deletedAt IS NULL OR excluded.deletedAt IS NULL
      THEN NULL
    WHEN excluded.updatedAt >= passage_annotations.updatedAt
      THEN excluded.deletedAt ELSE passage_annotations.deletedAt END,
  updatedAt = MAX(passage_annotations.updatedAt, excluded.updatedAt);

-- Keep authority roots with annotations safe while the previous worker version
-- is still serving during migration/deploy overlap. The new worker removes this
-- guard in the same batch that permanently deletes the final annotation.
CREATE TABLE private_research_authority_guards (
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  authorityId TEXT NOT NULL,
  PRIMARY KEY (userId, authorityId)
);

CREATE TABLE private_research_quote_aliases (
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  quoteId TEXT NOT NULL,
  annotationId TEXT NOT NULL,
  PRIMARY KEY (userId, quoteId)
);
CREATE INDEX idx_private_research_quote_alias_annotation
  ON private_research_quote_aliases (userId, annotationId);

-- A document-level watermark contains no selected text. It survives permanent
-- deletion so an already-started old-worker insert cannot recreate deleted data.
CREATE TABLE private_research_document_delete_watermarks (
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  docType TEXT NOT NULL CHECK (docType IN ('judgment', 'statute')),
  docId TEXT NOT NULL,
  deletedAt INTEGER NOT NULL,
  PRIMARY KEY (userId, docType, docId)
);

INSERT INTO private_research_quote_aliases (userId, quoteId, annotationId)
SELECT q.userId, q.id, p.id
FROM saved_quotes q
JOIN saved_authorities a
  ON a.userId = q.userId AND a.docType = q.docType AND a.docId = q.docId
JOIN passage_annotations p
  ON p.userId = q.userId AND p.authorityId = a.id
  AND p.anchor = q.anchor AND p.startOffset = q.startOffset
  AND p.endOffset = q.endOffset AND p.exactText = q.exactText
WHERE q.deletedAt IS NULL OR q.deletedAt >=
  (SELECT restoreCutoff FROM private_research_migration_clock);

-- Expired legacy tombstones have no remaining Undo contract. Remove their
-- selected text now that all live/restorable rows have canonical copies.
DELETE FROM saved_quotes
WHERE deletedAt IS NOT NULL AND deletedAt <
  (SELECT restoreCutoff FROM private_research_migration_clock);
DROP TABLE private_research_migration_clock;

INSERT INTO private_research_authority_guards (userId, authorityId)
SELECT DISTINCT userId, authorityId FROM passage_annotations;

CREATE TRIGGER private_research_protect_authority_delete
BEFORE DELETE ON saved_authorities
WHEN EXISTS (
  SELECT 1 FROM private_research_authority_guards
  WHERE userId = OLD.userId AND authorityId = OLD.id
) AND EXISTS (SELECT 1 FROM user WHERE id = OLD.userId)
BEGIN
  UPDATE saved_authorities SET savedAt = NULL
  WHERE userId = OLD.userId AND id = OLD.id;
  SELECT RAISE(IGNORE);
END;

-- Old workers omit the new savedAt/activityAt columns. Recognise those legacy
-- writes without changing annotation-only roots created by the new worker.
CREATE TRIGGER private_research_legacy_authority_insert
AFTER INSERT ON saved_authorities
WHEN NEW.savedAt IS NULL AND NEW.activityAt = 0
BEGIN
  UPDATE saved_authorities
  SET savedAt = NEW.createdAt,
      activityAt = CASE WHEN NEW.updatedAt > NEW.createdAt
        THEN NEW.updatedAt ELSE NEW.createdAt END
  WHERE userId = NEW.userId AND id = NEW.id;
END;

CREATE TRIGGER private_research_legacy_authority_update
AFTER UPDATE OF title, path, updatedAt ON saved_authorities
WHEN OLD.savedAt IS NULL
  AND NEW.savedAt IS NULL
  AND NEW.activityAt = OLD.activityAt
  AND (
    NEW.updatedAt != OLD.updatedAt OR NEW.title != OLD.title OR NEW.path != OLD.path
  )
BEGIN
  UPDATE saved_authorities
  SET savedAt = NEW.updatedAt,
      activityAt = CASE WHEN NEW.updatedAt > NEW.activityAt
        THEN NEW.updatedAt ELSE NEW.activityAt END
  WHERE userId = NEW.userId AND id = NEW.id;
END;

-- Mirror quotes written by an old worker after the one-time copy. These
-- triggers are one-way; canonical APIs never create or update saved_quotes.
CREATE TRIGGER private_research_reject_stale_quote_insert
BEFORE INSERT ON saved_quotes
WHEN EXISTS (
  SELECT 1 FROM private_research_document_delete_watermarks
  WHERE userId = NEW.userId AND docType = NEW.docType AND docId = NEW.docId
    AND NEW.createdAt <= deletedAt
)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER private_research_legacy_quote_insert
AFTER INSERT ON saved_quotes
WHEN NEW.deletedAt IS NULL
BEGIN
  INSERT INTO saved_authorities (
    id, userId, docType, docId, title, path, createdAt, updatedAt,
    citation, savedAt, activityAt
  ) VALUES (
    'quote-root:' || NEW.id, NEW.userId, NEW.docType, NEW.docId,
    NEW.sourceTitle,
    CASE WHEN instr(NEW.path, '#') > 0
      THEN substr(NEW.path, 1, instr(NEW.path, '#') - 1) ELSE NEW.path END,
    NEW.createdAt, NEW.createdAt, NEW.citation, NULL, NEW.createdAt
  )
  ON CONFLICT(userId, docType, docId) DO UPDATE SET
    citation = CASE WHEN saved_authorities.citation = '' THEN excluded.citation
      ELSE saved_authorities.citation END,
    activityAt = MAX(saved_authorities.activityAt, excluded.activityAt),
    updatedAt = MAX(saved_authorities.updatedAt, excluded.updatedAt);

  INSERT INTO passage_annotations (
    id, userId, authorityId, title, citation, path, exactText, anchor,
    startOffset, endOffset, contextBefore, contextAfter, note, createdAt,
    updatedAt, deletedAt
  )
  SELECT NEW.id, NEW.userId, a.id, NEW.sourceTitle, NEW.citation, NEW.path,
    NEW.exactText, NEW.anchor, NEW.startOffset, NEW.endOffset,
    NEW.contextBefore, NEW.contextAfter, NULL, NEW.createdAt, NEW.createdAt,
    NULL
  FROM saved_authorities a
  WHERE a.userId = NEW.userId AND a.docType = NEW.docType
    AND a.docId = NEW.docId
  ON CONFLICT(userId, authorityId, anchor, startOffset, endOffset, exactText)
  DO UPDATE SET
    deletedAt = CASE
      WHEN excluded.updatedAt >= passage_annotations.updatedAt THEN NULL
      ELSE passage_annotations.deletedAt END,
    updatedAt = MAX(passage_annotations.updatedAt, excluded.updatedAt);

  INSERT INTO private_research_quote_aliases (userId, quoteId, annotationId)
  SELECT NEW.userId, NEW.id, p.id
  FROM passage_annotations p
  JOIN saved_authorities a
    ON a.userId = p.userId AND a.id = p.authorityId
  WHERE p.userId = NEW.userId AND a.docType = NEW.docType
    AND a.docId = NEW.docId AND p.anchor = NEW.anchor
    AND p.startOffset = NEW.startOffset AND p.endOffset = NEW.endOffset
    AND p.exactText = NEW.exactText
  ON CONFLICT(userId, quoteId) DO UPDATE SET
    annotationId = excluded.annotationId;

  INSERT OR IGNORE INTO private_research_authority_guards
    (userId, authorityId)
  SELECT NEW.userId, id FROM saved_authorities
  WHERE userId = NEW.userId AND docType = NEW.docType AND docId = NEW.docId;
END;

-- Reject an expired or stale old-worker Undo before UPDATE ... RETURNING can
-- report success. A canonical row already restored by a newer request is safe.
CREATE TRIGGER private_research_reject_stale_quote_restore
BEFORE UPDATE OF deletedAt ON saved_quotes
WHEN NEW.deletedAt IS NULL AND OLD.deletedAt IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM passage_annotations
    WHERE userId = NEW.userId AND id = COALESCE(
      (SELECT annotationId FROM private_research_quote_aliases
        WHERE userId = NEW.userId AND quoteId = NEW.id),
      NEW.id
    ) AND deletedAt IS NULL
  )
  AND (
    OLD.deletedAt <
      CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) - 10000
    OR OLD.deletedAt >
      CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    OR EXISTS (
      SELECT 1 FROM passage_annotations
      WHERE userId = NEW.userId AND id = COALESCE(
        (SELECT annotationId FROM private_research_quote_aliases
          WHERE userId = NEW.userId AND quoteId = NEW.id),
        NEW.id
      ) AND deletedAt IS NOT OLD.deletedAt
    )
    OR (
      NOT EXISTS (
        SELECT 1 FROM passage_annotations
        WHERE userId = NEW.userId AND id = COALESCE(
          (SELECT annotationId FROM private_research_quote_aliases
            WHERE userId = NEW.userId AND quoteId = NEW.id),
          NEW.id
        )
      )
      AND EXISTS (
        SELECT 1 FROM private_research_document_delete_watermarks
        WHERE userId = NEW.userId AND docType = NEW.docType
          AND docId = NEW.docId AND NEW.createdAt <= deletedAt
      )
    )
  )
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER private_research_legacy_quote_delete_restore
AFTER UPDATE OF deletedAt ON saved_quotes
BEGIN
  INSERT INTO saved_authorities (
    id, userId, docType, docId, title, path, createdAt, updatedAt,
    citation, savedAt, activityAt
  )
  SELECT 'quote-root:' || NEW.id, NEW.userId, NEW.docType, NEW.docId,
    NEW.sourceTitle,
    CASE WHEN instr(NEW.path, '#') > 0
      THEN substr(NEW.path, 1, instr(NEW.path, '#') - 1) ELSE NEW.path END,
    NEW.createdAt, NEW.createdAt, NEW.citation, NULL, NEW.createdAt
  WHERE NEW.deletedAt IS NULL AND OLD.deletedAt IS NOT NULL
    AND OLD.deletedAt BETWEEN
      CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) - 10000
      AND CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    AND NOT EXISTS (
      SELECT 1 FROM private_research_document_delete_watermarks
      WHERE userId = NEW.userId AND docType = NEW.docType
        AND docId = NEW.docId AND NEW.createdAt <= deletedAt
    )
  ON CONFLICT(userId, docType, docId) DO NOTHING;

  INSERT INTO passage_annotations (
    id, userId, authorityId, title, citation, path, exactText, anchor,
    startOffset, endOffset, contextBefore, contextAfter, note, createdAt,
    updatedAt, deletedAt
  )
  SELECT NEW.id, NEW.userId, a.id, NEW.sourceTitle, NEW.citation, NEW.path,
    NEW.exactText, NEW.anchor, NEW.startOffset, NEW.endOffset,
    NEW.contextBefore, NEW.contextAfter, NULL, NEW.createdAt, NEW.createdAt,
    NEW.deletedAt
  FROM saved_authorities a
  WHERE NEW.deletedAt IS NULL AND OLD.deletedAt IS NOT NULL
    AND OLD.deletedAt BETWEEN
      CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) - 10000
      AND CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    AND a.userId = NEW.userId AND a.docType = NEW.docType
    AND a.docId = NEW.docId
    AND NOT EXISTS (
      SELECT 1 FROM private_research_document_delete_watermarks
      WHERE userId = NEW.userId AND docType = NEW.docType
        AND docId = NEW.docId AND NEW.createdAt <= deletedAt
    )
  ON CONFLICT(userId, authorityId, anchor, startOffset, endOffset, exactText)
  DO NOTHING;

  INSERT INTO private_research_quote_aliases (userId, quoteId, annotationId)
  SELECT NEW.userId, NEW.id, p.id
  FROM passage_annotations p
  JOIN saved_authorities a
    ON a.userId = p.userId AND a.id = p.authorityId
  WHERE NEW.deletedAt IS NULL AND OLD.deletedAt IS NOT NULL
    AND OLD.deletedAt BETWEEN
      CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) - 10000
      AND CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    AND p.userId = NEW.userId AND a.docType = NEW.docType
    AND a.docId = NEW.docId
    AND p.anchor = NEW.anchor AND p.startOffset = NEW.startOffset
    AND p.endOffset = NEW.endOffset AND p.exactText = NEW.exactText
  ON CONFLICT(userId, quoteId) DO UPDATE SET
    annotationId = excluded.annotationId;

  UPDATE passage_annotations
  SET deletedAt = NEW.deletedAt,
      updatedAt = MAX(updatedAt, COALESCE(NEW.deletedAt, NEW.createdAt))
  WHERE userId = NEW.userId AND id = COALESCE(
    (SELECT annotationId FROM private_research_quote_aliases
      WHERE userId = NEW.userId AND quoteId = NEW.id),
    NEW.id
  ) AND (
    (NEW.deletedAt IS NOT NULL AND updatedAt <= NEW.deletedAt)
    OR (NEW.deletedAt IS NULL AND OLD.deletedAt IS NOT NULL
      AND OLD.deletedAt BETWEEN
        CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) - 10000
        AND CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
      AND deletedAt = OLD.deletedAt)
  );

  -- Keep every legacy ID for one canonical annotation in the same state. The
  -- null-safe predicates also make these updates finite with recursive triggers.
  UPDATE saved_quotes
  SET deletedAt = NEW.deletedAt
  WHERE NEW.deletedAt IS NOT NULL AND userId = NEW.userId
    AND deletedAt IS NOT NEW.deletedAt
    AND (
      id = COALESCE(
        (SELECT annotationId FROM private_research_quote_aliases
          WHERE userId = NEW.userId AND quoteId = NEW.id),
        NEW.id
      )
      OR id IN (
        SELECT quoteId FROM private_research_quote_aliases
        WHERE userId = NEW.userId AND annotationId = COALESCE(
          (SELECT annotationId FROM private_research_quote_aliases
            WHERE userId = NEW.userId AND quoteId = NEW.id),
          NEW.id
        )
      )
    );

  UPDATE saved_quotes
  SET deletedAt = NULL
  WHERE NEW.deletedAt IS NULL AND OLD.deletedAt IS NOT NULL
    AND userId = NEW.userId AND deletedAt IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM passage_annotations
      WHERE userId = NEW.userId AND id = COALESCE(
        (SELECT annotationId FROM private_research_quote_aliases
          WHERE userId = NEW.userId AND quoteId = NEW.id),
        NEW.id
      ) AND deletedAt IS NULL
    )
    AND (
      id = COALESCE(
        (SELECT annotationId FROM private_research_quote_aliases
          WHERE userId = NEW.userId AND quoteId = NEW.id),
        NEW.id
      )
      OR id IN (
        SELECT quoteId FROM private_research_quote_aliases
        WHERE userId = NEW.userId AND annotationId = COALESCE(
          (SELECT annotationId FROM private_research_quote_aliases
            WHERE userId = NEW.userId AND quoteId = NEW.id),
          NEW.id
        )
      )
    );

  -- An expired or stale restore is rolled back before the transaction commits,
  -- using the canonical tombstone when a newer deletion already exists.
  UPDATE saved_quotes
  SET deletedAt = COALESCE(
    (SELECT deletedAt FROM passage_annotations
      WHERE userId = NEW.userId AND id = COALESCE(
        (SELECT annotationId FROM private_research_quote_aliases
          WHERE userId = NEW.userId AND quoteId = NEW.id),
        NEW.id
      )),
    OLD.deletedAt
  )
  WHERE NEW.deletedAt IS NULL AND OLD.deletedAt IS NOT NULL
    AND userId = NEW.userId
    AND NOT EXISTS (
      SELECT 1 FROM passage_annotations
      WHERE userId = NEW.userId AND id = COALESCE(
        (SELECT annotationId FROM private_research_quote_aliases
          WHERE userId = NEW.userId AND quoteId = NEW.id),
        NEW.id
      ) AND deletedAt IS NULL
    )
    AND deletedAt IS NOT COALESCE(
      (SELECT deletedAt FROM passage_annotations
        WHERE userId = NEW.userId AND id = COALESCE(
          (SELECT annotationId FROM private_research_quote_aliases
            WHERE userId = NEW.userId AND quoteId = NEW.id),
          NEW.id
        )),
      OLD.deletedAt
    )
    AND (
      id = COALESCE(
        (SELECT annotationId FROM private_research_quote_aliases
          WHERE userId = NEW.userId AND quoteId = NEW.id),
        NEW.id
      )
      OR id IN (
        SELECT quoteId FROM private_research_quote_aliases
        WHERE userId = NEW.userId AND annotationId = COALESCE(
          (SELECT annotationId FROM private_research_quote_aliases
            WHERE userId = NEW.userId AND quoteId = NEW.id),
          NEW.id
        )
      )
    );

  INSERT OR IGNORE INTO private_research_authority_guards
    (userId, authorityId)
  SELECT NEW.userId, id FROM saved_authorities
  WHERE NEW.deletedAt IS NULL AND userId = NEW.userId
    AND docType = NEW.docType AND docId = NEW.docId
    AND EXISTS (
      SELECT 1 FROM passage_annotations p
      WHERE p.userId = NEW.userId AND p.authorityId = saved_authorities.id
        AND p.deletedAt IS NULL
    );
END;

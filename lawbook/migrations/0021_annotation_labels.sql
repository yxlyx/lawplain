-- Legal annotation labels (#193 foundation for #191 and #192).
--
-- The column is length-bounded rather than enum-bounded on purpose: #193 proper
-- adds user-defined labels, and an enumerated CHECK would force a full table
-- rebuild to admit them. The accepted set is validated in src/lib/annotation-
-- labels.ts, and readers fall back to a neutral display name for any id they do
-- not recognise, so renaming or archiving a label never hides a passage.
--
-- Existing annotations predate labelling and become "Key point", the preset's
-- general-purpose label, which is also the default for a plain Highlight.
ALTER TABLE passage_annotations
  ADD COLUMN label TEXT NOT NULL DEFAULT 'key-point'
  CHECK (length(label) BETWEEN 1 AND 64);

-- Serves "my Rule / Holding passages, most recent first" in My Library (#195)
-- and the label filter in #196, both owner-scoped like every other private read.
CREATE INDEX idx_passage_annotations_owner_label
  ON passage_annotations (userId, label, updatedAt DESC, id DESC);

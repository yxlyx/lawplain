# Private research architecture (#189)

## Canonical model

`saved_authorities` is the owner/document root for the private library. A root may represent an explicit bookmark (`savedAt` is non-null), one or more annotations, or both. `passage_annotations` belongs to a root through an owner-bound composite foreign key. Active and still-restorable `saved_quotes` rows are migrated into this model. Quote IDs are retained as annotation IDs where the location is unique; owner-scoped aliases preserve every old private quote link when canonical deduplication chooses another ID. `saved_quotes` is legacy after migration: annotation creation and note editing never mirror into it, compatibility DELETE/restore only synchronizes tombstones, and permanent annotation deletion purges every mapped legacy row and alias.

Captured source material is immutable: document identity, title/citation/path, exact text, anchor, offsets, and surrounding context are not editable annotation fields. Only the user's note is editable (up to 10,000 characters). Anchors are snapshots and may become stale when a source changes; clients must retain the captured text/context, report that state, and never silently move an annotation to a merely similar passage.

## Ownership, time, and pagination

Every query and mutation is scoped by authenticated `userId`, including prepared statements in D1 batches. Annotation foreign keys include `userId`; a foreign or nonexistent ID has the same 404/null result. List APIs use bounded keyset pagination. Cursors encode the owner and complete query shape as well as the last `(activityAt, id)` key and are rejected when replayed for another owner or query.

The timestamps have distinct meanings:

- `createdAt`: when the root or annotation first entered the library; never rewritten.
- `savedAt`: when the document was explicitly bookmarked; nullable. Saving sets it only when absent, and unsaving clears it.
- `activityAt`: latest private-library activity used for ordering. Annotation creation/note edits and explicit saves advance it without changing `savedAt` unnecessarily.

## Organisation and lifecycle

Labels are user-defined display names; tags are the normalized, owner-scoped label identities; collections are owner-scoped ordered groupings of roots. These are intentionally deferred, but must attach to the canonical root rather than duplicate source records. Future schemas must enforce owner-bound foreign keys and owner-local uniqueness.

Deleting through the annotation API is permanent. It removes the canonical annotation plus every mapped legacy quote and alias. An annotation-only root is removed once its last annotation is permanently deleted; unsaving removes a root only if it has no annotations. For deployment compatibility, the legacy quote DELETE/restore endpoints use a 10-second canonical annotation tombstone so cached clients can honour their existing Undo promise. They tombstone or restore the canonical annotation and every owner-scoped mapped legacy row in one D1 batch. Recent pre-migration tombstones are copied so Undo also survives the worker handoff, while already-expired legacy tombstones and their selected text are purged during migration. Owner-scoped quote, annotation-list, and library reads opportunistically purge later-expired tombstones, mapped legacy rows, aliases, unused guards, and empty annotation-only roots after first writing a deletion watermark; explicit saves survive. New annotation clients never expose that soft-delete contract.

Migrations run before the new worker deploys, so migration `0020` includes a one-way compatibility bridge for overlapping old workers. Legacy-shaped authority writes receive explicit-save timestamps, and causally current legacy quote inserts/deletes/restores are mirrored into canonical annotations. Old-worker deletes synchronize every legacy ID mapped to the canonical annotation, while expired or stale restores are rejected before `UPDATE ... RETURNING` can report success. Guard rows prevent an old worker's hard unsave from cascading through annotations; canonical final-annotation deletion removes the guard in the same D1 batch. A document-level deletion watermark, containing no selected text, rejects already-started old-worker or canonical inserts that arrive after permanent deletion. Guards, aliases, and watermarks all bypass or cascade with account deletion, so account deletion still removes roots, annotations, compatibility metadata, legacy quotes, and future labels/tags/collections.

## Privacy, export, and AI

Every private API response, including authentication, validation, conflict, and not-found errors, is `private, no-store` and carries no-cache and no-index headers. Private research must not enter shared/CDN caches. A future account export should include canonical roots, timestamps, immutable source snapshots, notes, and organisation metadata in a documented portable format; legacy quote rows are not a second export source after migration.

Private source text and notes are never sent to an AI feature implicitly. Each AI operation requires explicit, purpose-specific user consent. Stored AI output must record provenance: consenting user, selected source/annotation IDs, model/provider, prompt or policy version, creation time, and enough transformation metadata to audit the result. Consent for one operation is not blanket consent for later training, retention, or unrelated processing.

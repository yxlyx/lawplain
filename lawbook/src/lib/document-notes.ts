/**
 * Document-level private notes (#194).
 *
 * One note per authority per owner. A note is a whole-document scratchpad and
 * carries no selected text, so it needs none of the anchoring machinery in
 * private-annotations.ts — but it shares that module's ownership rules exactly:
 * every statement is owner-scoped, the authority root is created on first save so
 * the document joins My Library, and the root is guarded so a later annotation
 * delete cannot cascade the note away.
 */
import { getAuthDb } from "@/lib/d1";
import {
  FREE_FORM_TEMPLATE_ID,
  isDocumentNoteTemplateId,
} from "@/lib/document-note-templates";
import { normalizeInternalPath } from "@/lib/internal-path";
import type { SavedDocType } from "@/lib/saved-workspace";

const MAX_BODY = 50_000;
const MAX_SHORT = 500;

export interface DocumentNoteInput {
  docType: SavedDocType;
  docId: string;
  title: string;
  citation: string;
  path: string;
  body: string;
  template: string;
}

export interface DocumentNote {
  id: string;
  authorityId: string;
  docType: SavedDocType;
  docId: string;
  title: string;
  citation: string;
  path: string;
  body: string;
  template: string;
  createdAt: number;
  updatedAt: number;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function canonicalAuthorityPath(path: string): string {
  const hashIndex = path.indexOf("#");
  return hashIndex === -1 ? path : path.slice(0, hashIndex);
}

export function normalizeDocumentNoteInput(
  value: unknown,
): DocumentNoteInput | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.docType !== "judgment" && raw.docType !== "statute") return null;
  const docId = boundedText(raw.docId, MAX_SHORT);
  const title = boundedText(raw.title, MAX_SHORT);
  const citation = boundedText(raw.citation, MAX_SHORT);
  const path = normalizeInternalPath(raw.path);
  // An empty body is not a note. Deleting is an explicit DELETE, so that a
  // cleared editor cannot quietly destroy a reader's work on autosave.
  const body =
    typeof raw.body === "string" && raw.body.length <= MAX_BODY
      ? raw.body
      : null;
  // An omitted template is free form. An unknown id is rejected rather than
  // silently defaulted, so a client bug cannot mislabel how a note was written.
  const template =
    raw.template === undefined
      ? FREE_FORM_TEMPLATE_ID
      : isDocumentNoteTemplateId(raw.template)
        ? raw.template
        : null;
  if (
    !docId ||
    !title ||
    !citation ||
    !path ||
    !path.startsWith(`/${raw.docType}/`) ||
    body === null ||
    !body.trim() ||
    template === null
  )
    return null;
  return { docType: raw.docType, docId, title, citation, path, body, template };
}

const SELECT_NOTE = `SELECT n.id, n.authorityId, a.docType, a.docId, n.title,
  n.citation, n.path, n.body, n.template, n.createdAt, n.updatedAt
  FROM document_notes n
  JOIN saved_authorities a ON a.userId = n.userId AND a.id = n.authorityId`;

/**
 * Create or replace the note for one document. Idempotent by (owner, authority),
 * so a retried save updates rather than duplicating.
 */
export async function saveDocumentNote(
  userId: string,
  input: DocumentNoteInput,
): Promise<DocumentNote> {
  const db = await getAuthDb();
  const now = Date.now();
  const authorityId = crypto.randomUUID();
  const noteId = crypto.randomUUID();
  const [, noteWrite] = await db.batch<{ id: string }>([
    db
      .prepare(`INSERT INTO saved_authorities
      (id, userId, docType, docId, title, path, createdAt, updatedAt,
       citation, savedAt, activityAt)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM private_research_document_delete_watermarks
        WHERE userId = ? AND docType = ? AND docId = ? AND deletedAt >= ?
      )
      ON CONFLICT(userId, docType, docId) DO UPDATE SET
        title = excluded.title,
        citation = excluded.citation,
        path = excluded.path,
        activityAt = MAX(saved_authorities.activityAt, excluded.activityAt),
        updatedAt = MAX(saved_authorities.updatedAt, excluded.updatedAt)`)
      .bind(
        authorityId,
        userId,
        input.docType,
        input.docId,
        input.title,
        canonicalAuthorityPath(input.path),
        now,
        now,
        input.citation,
        now,
        userId,
        input.docType,
        input.docId,
        now,
      ),
    db
      .prepare(`INSERT INTO document_notes
      (id, userId, authorityId, title, citation, path, body, template,
       createdAt, updatedAt)
      SELECT ?, ?, id, ?, ?, ?, ?, ?, ?, ?
      FROM saved_authorities
      WHERE userId = ? AND docType = ? AND docId = ?
        AND NOT EXISTS (
          SELECT 1 FROM private_research_document_delete_watermarks
          WHERE userId = ? AND docType = ? AND docId = ? AND deletedAt >= ?
        )
      ON CONFLICT(userId, authorityId) DO UPDATE SET
        title = excluded.title,
        citation = excluded.citation,
        path = excluded.path,
        body = CASE
          WHEN excluded.updatedAt >= document_notes.updatedAt
            THEN excluded.body
          ELSE document_notes.body END,
        template = CASE
          WHEN excluded.updatedAt >= document_notes.updatedAt
            THEN excluded.template
          ELSE document_notes.template END,
        updatedAt = MAX(document_notes.updatedAt, excluded.updatedAt)
      RETURNING id`)
      .bind(
        noteId,
        userId,
        input.title,
        input.citation,
        input.path,
        input.body,
        input.template,
        now,
        now,
        userId,
        input.docType,
        input.docId,
        userId,
        input.docType,
        input.docId,
        now,
      ),
    db
      .prepare(`INSERT OR IGNORE INTO private_research_authority_guards
        (userId, authorityId)
      SELECT a.userId, a.id FROM saved_authorities a
      WHERE a.userId = ? AND a.docType = ? AND a.docId = ?
        AND EXISTS (SELECT 1 FROM document_notes n
          WHERE n.userId = a.userId AND n.authorityId = a.id)`)
      .bind(userId, input.docType, input.docId),
  ]);
  if (noteWrite.results.length === 0) throw new Error("STALE_NOTE_WRITE");
  const row = await db
    .prepare(
      `${SELECT_NOTE} WHERE n.userId = ? AND a.docType = ? AND a.docId = ?`,
    )
    .bind(userId, input.docType, input.docId)
    .first<DocumentNote>();
  if (!row) throw new Error("STALE_NOTE_WRITE");
  return row;
}

export async function getDocumentNote(
  userId: string,
  docType: SavedDocType,
  docId: string,
): Promise<DocumentNote | null> {
  const db = await getAuthDb();
  return (
    (await db
      .prepare(
        `${SELECT_NOTE} WHERE n.userId = ? AND a.docType = ? AND a.docId = ?`,
      )
      .bind(userId, docType, docId)
      .first<DocumentNote>()) ?? null
  );
}

/**
 * Permanently delete a note. The authority root is only removed when it holds no
 * annotation either and was never explicitly saved, so deleting a note never
 * takes a reader's highlights or an explicit bookmark with it.
 */
export async function deleteDocumentNote(
  userId: string,
  docType: SavedDocType,
  docId: string,
): Promise<boolean> {
  const db = await getAuthDb();
  const existing = await db
    .prepare(`SELECT n.authorityId FROM document_notes n
      JOIN saved_authorities a ON a.userId = n.userId AND a.id = n.authorityId
      WHERE n.userId = ? AND a.docType = ? AND a.docId = ?`)
    .bind(userId, docType, docId)
    .first<{ authorityId: string }>();
  if (!existing) return false;
  const [deleted] = await db.batch<{ authorityId: string }>([
    db
      .prepare(
        "DELETE FROM document_notes WHERE userId = ? AND authorityId = ? RETURNING authorityId",
      )
      .bind(userId, existing.authorityId),
    db
      .prepare(`DELETE FROM private_research_authority_guards
      WHERE userId = ? AND authorityId = ?
        AND NOT EXISTS (SELECT 1 FROM document_notes
          WHERE userId = ? AND authorityId = ?)
        AND NOT EXISTS (SELECT 1 FROM passage_annotations
          WHERE userId = ? AND authorityId = ?)`)
      .bind(
        userId,
        existing.authorityId,
        userId,
        existing.authorityId,
        userId,
        existing.authorityId,
      ),
    db
      .prepare(`DELETE FROM saved_authorities
      WHERE userId = ? AND id = ? AND savedAt IS NULL
        AND NOT EXISTS (SELECT 1 FROM document_notes
          WHERE userId = ? AND authorityId = ?)
        AND NOT EXISTS (SELECT 1 FROM passage_annotations
          WHERE userId = ? AND authorityId = ?)`)
      .bind(
        userId,
        existing.authorityId,
        userId,
        existing.authorityId,
        userId,
        existing.authorityId,
      ),
  ]);
  return deleted.results.length > 0;
}

import { getAuthDb } from "@/lib/d1";
import { normalizeInternalPath } from "@/lib/internal-path";
import type { SavedDocType } from "@/lib/saved-workspace";

const MAX_TEXT = 5_000;
const MAX_NOTE = 10_000;
const MAX_SHORT = 500;
const MAX_CONTEXT = 1_000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export interface AnnotationInput {
  docType: SavedDocType;
  docId: string;
  title: string;
  citation: string;
  path: string;
  exactText: string;
  anchor: string;
  startOffset: number;
  endOffset: number;
  contextBefore: string;
  contextAfter: string;
  note: string | null;
}

export interface Annotation extends AnnotationInput {
  id: string;
  authorityId: string;
  createdAt: number;
  updatedAt: number;
}

interface AnnotationRow {
  id: string;
  authorityId: string;
  docType: SavedDocType;
  docId: string;
  title: string;
  citation: string;
  path: string;
  exactText: string;
  anchor: string;
  startOffset: number;
  endOffset: number;
  contextBefore: string;
  contextAfter: string;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function offset(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function canonicalAuthorityPath(path: string): string {
  const hashIndex = path.indexOf("#");
  return hashIndex === -1 ? path : path.slice(0, hashIndex);
}

export function normalizeAnnotationInput(
  value: unknown,
): AnnotationInput | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.docType !== "judgment" && raw.docType !== "statute") return null;
  const docId = boundedText(raw.docId, MAX_SHORT);
  const title = boundedText(raw.title, MAX_SHORT);
  const citation = boundedText(raw.citation, MAX_SHORT);
  const exactText =
    typeof raw.exactText === "string" && raw.exactText.length <= MAX_TEXT
      ? raw.exactText
      : null;
  const anchor = boundedText(raw.anchor, MAX_SHORT);
  const path = normalizeInternalPath(raw.path);
  const startOffset = offset(raw.startOffset);
  const endOffset = offset(raw.endOffset);
  const contextBefore =
    typeof raw.contextBefore === "string" &&
    raw.contextBefore.length <= MAX_CONTEXT
      ? raw.contextBefore
      : null;
  const contextAfter =
    typeof raw.contextAfter === "string" &&
    raw.contextAfter.length <= MAX_CONTEXT
      ? raw.contextAfter
      : null;
  const note =
    raw.note === undefined || raw.note === null
      ? null
      : typeof raw.note === "string" && raw.note.length <= MAX_NOTE
        ? raw.note
        : undefined;
  if (
    !docId ||
    !title ||
    !citation ||
    !exactText?.trim() ||
    !anchor ||
    !path ||
    !path.startsWith(`/${raw.docType}/`) ||
    startOffset === null ||
    endOffset === null ||
    startOffset < 0 ||
    endOffset - startOffset !== exactText.length ||
    contextBefore === null ||
    contextAfter === null ||
    note === undefined
  )
    return null;
  return {
    docType: raw.docType,
    docId,
    title,
    citation,
    path,
    exactText,
    anchor,
    startOffset,
    endOffset,
    contextBefore,
    contextAfter,
    note,
  };
}

const SELECT_ANNOTATION = `SELECT p.id, p.authorityId, a.docType, a.docId,
  p.title, p.citation, p.path, p.exactText, p.anchor, p.startOffset,
  p.endOffset, p.contextBefore, p.contextAfter, p.note, p.createdAt, p.updatedAt
  FROM passage_annotations p
  JOIN saved_authorities a ON a.userId = p.userId AND a.id = p.authorityId`;

export async function createAnnotation(
  userId: string,
  input: AnnotationInput,
): Promise<Annotation> {
  const db = await getAuthDb();
  const now = Date.now();
  const authorityId = crypto.randomUUID();
  const annotationId = crypto.randomUUID();
  const [, annotationWrite] = await db.batch<{ id: string }>([
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
      .prepare(`INSERT INTO passage_annotations
      (id, userId, authorityId, title, citation, path, exactText, anchor,
       startOffset, endOffset, contextBefore, contextAfter, note, createdAt,
       updatedAt)
      SELECT ?, ?, id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM saved_authorities
      WHERE userId = ? AND docType = ? AND docId = ?
        AND NOT EXISTS (
          SELECT 1 FROM private_research_document_delete_watermarks
          WHERE userId = ? AND docType = ? AND docId = ? AND deletedAt >= ?
        )
      ON CONFLICT(userId, authorityId, anchor, startOffset, endOffset, exactText)
      DO UPDATE SET
        note = CASE
          WHEN excluded.updatedAt >= passage_annotations.updatedAt
            AND excluded.note IS NOT NULL THEN excluded.note
          ELSE passage_annotations.note END,
        deletedAt = CASE
          WHEN excluded.updatedAt >= passage_annotations.updatedAt THEN NULL
          ELSE passage_annotations.deletedAt END,
        updatedAt = MAX(passage_annotations.updatedAt, excluded.updatedAt)
      RETURNING id`)
      .bind(
        annotationId,
        userId,
        input.title,
        input.citation,
        input.path,
        input.exactText,
        input.anchor,
        input.startOffset,
        input.endOffset,
        input.contextBefore,
        input.contextAfter,
        input.note,
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
        AND EXISTS (SELECT 1 FROM passage_annotations p
          WHERE p.userId = a.userId AND p.authorityId = a.id)`)
      .bind(userId, input.docType, input.docId),
  ]);
  if (annotationWrite.results.length === 0)
    throw new Error("STALE_ANNOTATION_WRITE");
  const row = await db
    .prepare(`${SELECT_ANNOTATION}
    WHERE p.userId = ? AND p.deletedAt IS NULL
      AND a.docType = ? AND a.docId = ? AND p.anchor = ?
      AND p.startOffset = ? AND p.endOffset = ? AND p.exactText = ?`)
    .bind(
      userId,
      input.docType,
      input.docId,
      input.anchor,
      input.startOffset,
      input.endOffset,
      input.exactText,
    )
    .first<AnnotationRow>();
  if (!row) throw new Error("STALE_ANNOTATION_WRITE");
  return row;
}

export async function getAnnotation(
  userId: string,
  id: string,
): Promise<Annotation | null> {
  const db = await getAuthDb();
  return (
    (await db
      .prepare(
        `${SELECT_ANNOTATION} WHERE p.userId = ? AND p.id = ? AND p.deletedAt IS NULL`,
      )
      .bind(userId, id)
      .first<AnnotationRow>()) ?? null
  );
}

const LEGACY_QUOTE_RESTORE_WINDOW_MS = 10_000;

async function purgeExpiredSoftDeletedAnnotationsWithDb(
  db: D1Database,
  userId: string,
  now: number,
): Promise<void> {
  const cutoff = now - LEGACY_QUOTE_RESTORE_WINDOW_MS;
  await db.batch([
    db
      .prepare(`INSERT INTO private_research_document_delete_watermarks
        (userId, docType, docId, deletedAt)
      SELECT DISTINCT p.userId, a.docType, a.docId, ?
      FROM passage_annotations p
      JOIN saved_authorities a
        ON a.userId = p.userId AND a.id = p.authorityId
      WHERE p.userId = ? AND p.deletedAt IS NOT NULL AND p.deletedAt < ?
      ON CONFLICT(userId, docType, docId) DO UPDATE SET
        deletedAt = MAX(
          private_research_document_delete_watermarks.deletedAt,
          excluded.deletedAt
        )`)
      .bind(now, userId, cutoff),
    db
      .prepare(`DELETE FROM saved_quotes
      WHERE userId = ? AND (
        id IN (
          SELECT qa.quoteId FROM private_research_quote_aliases qa
          JOIN passage_annotations p
            ON p.userId = qa.userId AND p.id = qa.annotationId
          WHERE qa.userId = ? AND p.deletedAt IS NOT NULL
            AND p.deletedAt < ?
        ) OR id IN (
          SELECT id FROM passage_annotations
          WHERE userId = ? AND deletedAt IS NOT NULL AND deletedAt < ?
        )
      )`)
      .bind(userId, userId, cutoff, userId, cutoff),
    db
      .prepare(`DELETE FROM private_research_quote_aliases
      WHERE userId = ? AND annotationId IN (
        SELECT id FROM passage_annotations
        WHERE userId = ? AND deletedAt IS NOT NULL AND deletedAt < ?
      )`)
      .bind(userId, userId, cutoff),
    db
      .prepare(`DELETE FROM passage_annotations
      WHERE userId = ? AND deletedAt IS NOT NULL AND deletedAt < ?`)
      .bind(userId, cutoff),
    db
      .prepare(`DELETE FROM private_research_authority_guards
      WHERE userId = ? AND NOT EXISTS (
        SELECT 1 FROM passage_annotations p
        WHERE p.userId = ?
          AND p.authorityId = private_research_authority_guards.authorityId
      )`)
      .bind(userId, userId),
    db
      .prepare(`DELETE FROM saved_authorities
      WHERE userId = ? AND savedAt IS NULL AND NOT EXISTS (
        SELECT 1 FROM passage_annotations p
        WHERE p.userId = ? AND p.authorityId = saved_authorities.id
      )`)
      .bind(userId, userId),
  ]);
}

export async function purgeExpiredSoftDeletedAnnotations(
  userId: string,
): Promise<void> {
  const db = await getAuthDb();
  await purgeExpiredSoftDeletedAnnotationsWithDb(db, userId, Date.now());
}

export async function resolveLegacyAnnotationId(
  userId: string,
  quoteId: string,
): Promise<string> {
  const db = await getAuthDb();
  await purgeExpiredSoftDeletedAnnotationsWithDb(db, userId, Date.now());
  const alias = await db
    .prepare(`SELECT annotationId FROM private_research_quote_aliases
      WHERE userId = ? AND quoteId = ?`)
    .bind(userId, quoteId)
    .first<{ annotationId: string }>();
  return alias?.annotationId ?? quoteId;
}

export async function softDeleteAnnotation(
  userId: string,
  id: string,
): Promise<Annotation | null> {
  const existing = await getAnnotation(userId, id);
  if (!existing) return null;
  const db = await getAuthDb();
  const deletedAt = Date.now();
  const [deleted] = await db.batch<{ id: string }>([
    db
      .prepare(`UPDATE passage_annotations
      SET deletedAt = ?, updatedAt = MAX(updatedAt, ?)
      WHERE userId = ? AND id = ? AND deletedAt IS NULL AND updatedAt <= ?
      RETURNING id`)
      .bind(deletedAt, deletedAt, userId, id, deletedAt),
    db
      .prepare(`UPDATE saved_quotes SET deletedAt = ?
      WHERE userId = ? AND (
        id = ? OR id IN (
          SELECT quoteId FROM private_research_quote_aliases
          WHERE userId = ? AND annotationId = ?
        )
      ) AND EXISTS (
        SELECT 1 FROM passage_annotations
        WHERE userId = ? AND id = ? AND deletedAt = ?
      )`)
      .bind(deletedAt, userId, id, userId, id, userId, id, deletedAt),
  ]);
  return deleted.results.some((row) => row.id === id) ? existing : null;
}

export async function restoreSoftDeletedAnnotation(
  userId: string,
  id: string,
): Promise<Annotation | null> {
  const db = await getAuthDb();
  const tombstone = await db
    .prepare(`SELECT authorityId, deletedAt FROM passage_annotations
      WHERE userId = ? AND id = ? AND deletedAt IS NOT NULL`)
    .bind(userId, id)
    .first<{ authorityId: string; deletedAt: number }>();
  if (!tombstone) return null;
  const now = Date.now();
  const [restored] = await db.batch<{ id: string }>([
    db
      .prepare(`UPDATE passage_annotations
      SET deletedAt = NULL, updatedAt = MAX(updatedAt, ?)
      WHERE userId = ? AND id = ? AND deletedAt = ? AND deletedAt >= ?
        AND updatedAt <= ?
      RETURNING id`)
      .bind(
        now,
        userId,
        id,
        tombstone.deletedAt,
        now - LEGACY_QUOTE_RESTORE_WINDOW_MS,
        now,
      ),
    db
      .prepare(`UPDATE saved_quotes SET deletedAt = NULL
      WHERE userId = ? AND deletedAt IS NOT NULL AND (
        id = ? OR id IN (
          SELECT quoteId FROM private_research_quote_aliases
          WHERE userId = ? AND annotationId = ?
        )
      ) AND EXISTS (
        SELECT 1 FROM passage_annotations
        WHERE userId = ? AND id = ? AND deletedAt IS NULL AND updatedAt = ?
      )`)
      .bind(userId, id, userId, id, userId, id, now),
    db
      .prepare(`UPDATE saved_authorities
      SET activityAt = MAX(activityAt, ?), updatedAt = MAX(updatedAt, ?)
      WHERE userId = ? AND id = ? AND EXISTS (
        SELECT 1 FROM passage_annotations
        WHERE userId = ? AND id = ? AND deletedAt IS NULL AND updatedAt = ?
      )`)
      .bind(now, now, userId, tombstone.authorityId, userId, id, now),
  ]);
  if (!restored.results.some((row) => row.id === id)) return null;
  return getAnnotation(userId, id);
}

type Cursor = { v: 1; owner: string; shape: string; at: number; id: string };

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(
  value: string | null,
  owner: string,
  shape: string,
): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString(),
    ) as Cursor;
    return parsed.v === 1 &&
      parsed.owner === owner &&
      parsed.shape === shape &&
      Number.isSafeInteger(parsed.at) &&
      typeof parsed.id === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export interface AnnotationListOptions {
  limit?: number;
  cursor?: string | null;
  docType?: SavedDocType;
  docId?: string;
}

export async function listAnnotations(
  userId: string,
  options: AnnotationListOptions = {},
) {
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, options.limit ?? DEFAULT_LIMIT),
  );
  const docType = options.docType ?? "";
  const docId = options.docId ?? "";
  const shape = JSON.stringify({ docType, docId });
  const cursor = decodeCursor(options.cursor ?? null, userId, shape);
  if (options.cursor && !cursor) throw new Error("INVALID_CURSOR");
  const db = await getAuthDb();
  await purgeExpiredSoftDeletedAnnotationsWithDb(db, userId, Date.now());
  const rows = await db
    .prepare(`${SELECT_ANNOTATION}
    WHERE p.userId = ? AND p.deletedAt IS NULL
      AND (? = '' OR a.docType = ?) AND (? = '' OR a.docId = ?)
      AND (? IS NULL OR p.updatedAt < ? OR (p.updatedAt = ? AND p.id < ?))
    ORDER BY p.updatedAt DESC, p.id DESC LIMIT ?`)
    .bind(
      userId,
      docType,
      docType,
      docId,
      docId,
      cursor?.at ?? null,
      cursor?.at ?? null,
      cursor?.at ?? null,
      cursor?.id ?? null,
      limit + 1,
    )
    .all<AnnotationRow>();
  const all = rows.results ?? [];
  const items = all.slice(0, limit);
  const last = items.at(-1);
  return {
    annotations: items,
    nextCursor:
      all.length > limit && last
        ? encodeCursor({
            v: 1,
            owner: userId,
            shape,
            at: last.updatedAt,
            id: last.id,
          })
        : null,
  };
}

export async function updateAnnotationNote(
  userId: string,
  id: string,
  note: string | null,
): Promise<Annotation | null> {
  if (note !== null && (typeof note !== "string" || note.length > MAX_NOTE))
    throw new Error("INVALID_NOTE");
  const db = await getAuthDb();
  const now = Date.now();
  await db.batch([
    db
      .prepare(`UPDATE passage_annotations SET note = ?, updatedAt = ?
      WHERE userId = ? AND id = ? AND deletedAt IS NULL AND updatedAt <= ?`)
      .bind(note, now, userId, id, now),
    db
      .prepare(`UPDATE saved_authorities
      SET activityAt = MAX(activityAt, ?), updatedAt = MAX(updatedAt, ?)
      WHERE userId = ? AND id = (SELECT authorityId FROM passage_annotations
        WHERE userId = ? AND id = ? AND deletedAt IS NULL)`)
      .bind(now, now, userId, userId, id),
  ]);
  return getAnnotation(userId, id);
}

export async function deleteAnnotation(
  userId: string,
  id: string,
): Promise<boolean> {
  const db = await getAuthDb();
  const existing = await db
    .prepare(`SELECT p.authorityId, a.docType, a.docId
      FROM passage_annotations p
      JOIN saved_authorities a ON a.userId = p.userId AND a.id = p.authorityId
      WHERE p.userId = ? AND p.id = ?`)
    .bind(userId, id)
    .first<{
      authorityId: string;
      docType: SavedDocType;
      docId: string;
    }>();
  if (!existing) return false;
  const deletedAt = Date.now();
  const [, deleted] = await db.batch<{ authorityId: string }>([
    db
      .prepare(`INSERT INTO private_research_document_delete_watermarks
        (userId, docType, docId, deletedAt) VALUES (?, ?, ?, ?)
        ON CONFLICT(userId, docType, docId) DO UPDATE SET
          deletedAt = MAX(
            private_research_document_delete_watermarks.deletedAt,
            excluded.deletedAt
          )`)
      .bind(userId, existing.docType, existing.docId, deletedAt),
    db
      .prepare(
        "DELETE FROM passage_annotations WHERE userId = ? AND id = ? RETURNING authorityId",
      )
      .bind(userId, id),
    db
      .prepare(`DELETE FROM saved_quotes
      WHERE userId = ? AND (id = ? OR id IN (
        SELECT quoteId FROM private_research_quote_aliases
        WHERE userId = ? AND annotationId = ?
      ))`)
      .bind(userId, id, userId, id),
    db
      .prepare(`DELETE FROM private_research_quote_aliases
      WHERE userId = ? AND annotationId = ?`)
      .bind(userId, id),
    db
      .prepare(`DELETE FROM private_research_authority_guards
      WHERE userId = ? AND authorityId = ?
        AND NOT EXISTS (SELECT 1 FROM passage_annotations
          WHERE userId = ? AND authorityId = ?)`)
      .bind(userId, existing.authorityId, userId, existing.authorityId),
    db
      .prepare(`DELETE FROM saved_authorities
      WHERE userId = ? AND id = ? AND savedAt IS NULL
        AND NOT EXISTS (SELECT 1 FROM passage_annotations
          WHERE userId = ? AND authorityId = ?)`)
      .bind(userId, existing.authorityId, userId, existing.authorityId),
  ]);
  return deleted.results.some(
    (row) => row.authorityId === existing.authorityId,
  );
}

export async function listLibrary(
  userId: string,
  limitValue?: number,
  cursorValue?: string | null,
) {
  const limit = Math.max(1, Math.min(MAX_LIMIT, limitValue ?? DEFAULT_LIMIT));
  const shape = "library";
  const cursor = decodeCursor(cursorValue ?? null, userId, shape);
  if (cursorValue && !cursor) throw new Error("INVALID_CURSOR");
  const db = await getAuthDb();
  await purgeExpiredSoftDeletedAnnotationsWithDb(db, userId, Date.now());
  const result = await db
    .prepare(`SELECT a.id, a.docType, a.docId, a.title,
      a.citation, a.path, a.savedAt, a.createdAt, a.activityAt,
      COUNT(p.id) AS annotationCount
    FROM saved_authorities a LEFT JOIN passage_annotations p
      ON p.userId = a.userId AND p.authorityId = a.id AND p.deletedAt IS NULL
    WHERE a.userId = ? AND (a.savedAt IS NOT NULL OR p.id IS NOT NULL)
      AND (? IS NULL OR a.activityAt < ? OR (a.activityAt = ? AND a.id < ?))
    GROUP BY a.id
    ORDER BY a.activityAt DESC, a.id DESC LIMIT ?`)
    .bind(
      userId,
      cursor?.at ?? null,
      cursor?.at ?? null,
      cursor?.at ?? null,
      cursor?.id ?? null,
      limit + 1,
    )
    .all<Record<string, unknown>>();
  const all = result.results ?? [];
  const items = all.slice(0, limit);
  const last = items.at(-1) as { activityAt?: number; id?: string } | undefined;
  return {
    authorities: items,
    nextCursor:
      all.length > limit &&
      last &&
      typeof last.activityAt === "number" &&
      last.id
        ? encodeCursor({
            v: 1,
            owner: userId,
            shape,
            at: last.activityAt,
            id: last.id,
          })
        : null,
  };
}

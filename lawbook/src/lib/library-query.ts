/**
 * My Library query construction (#195).
 *
 * Pure: no D1 access, so tests execute the real statement against a real migrated
 * schema. `library.ts` wraps this with the database call. The cursor helper is
 * imported relatively because `node --test` strips types but cannot resolve the
 * `@/` alias for a value import.
 *
 * One card per authority, whether it arrived by an explicit save, a first
 * highlight, or a first document note. Everything here is owner-scoped, and the
 * note preview is opt-in per request: when a reader hides previews the client
 * stops asking for them, so the note text never leaves the server rather than
 * merely going unrendered.
 */

import type { SavedDocType } from "@/lib/saved-workspace";
import { decodeCursor, encodeCursor } from "./private-cursor.ts";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
/** Long enough to recognise a note, short enough not to be the note. */
export const NOTE_PREVIEW_LENGTH = 160;

export type LibrarySort = "activity" | "saved" | "title";

export interface LibraryFilters {
  docType?: SavedDocType;
  /** An annotation label id; matches documents carrying at least one. */
  label?: string;
  hasPassageNotes?: boolean;
  hasDocumentNote?: boolean;
  hasOpenFollowUps?: boolean;
  tagId?: string;
  collectionId?: string;
  savedFrom?: number;
  savedTo?: number;
  sort?: LibrarySort;
  /** Opt in to a bounded snippet of the most recent private note. */
  includePreview?: boolean;
}

export interface LibraryOptions extends LibraryFilters {
  limit?: number;
  cursor?: string | null;
}

export interface LibraryCard {
  id: string;
  docType: SavedDocType;
  docId: string;
  title: string;
  citation: string;
  path: string;
  /** Null for a card the reader never explicitly saved. */
  savedAt: number | null;
  createdAt: number;
  activityAt: number;
  annotationCount: number;
  passageNoteCount: number;
  documentNoteCount: number;
  lastAnnotationAt: number | null;
  /** Distinct annotation label ids on this document. */
  labels: string[];
  notePreview: string | null;
  openFollowUpCount: number;
  tags: string[];
  collections: string[];
}

export interface LibraryRow
  extends Omit<LibraryCard, "labels" | "notePreview" | "tags" | "collections"> {
  labelList: string | null;
  tagList: string | null;
  collectionList: string | null;
  notePreview: string | null;
}

/** group_concat has no distinct-with-separator form; split on the default comma. */
function splitList(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function bounded(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > NOTE_PREVIEW_LENGTH
    ? `${cleaned.slice(0, NOTE_PREVIEW_LENGTH).trimEnd()}…`
    : cleaned;
}

const SORT_COLUMNS: Record<LibrarySort, string> = {
  activity: "a.activityAt",
  // COALESCE keeps annotation-only cards in the ordering instead of dropping
  // them to the bottom of a saved-date sort as NULLs.
  saved: "COALESCE(a.savedAt, a.createdAt)",
  title: "a.activityAt",
};

/**
 * Build the library query without touching D1.
 *
 * Split out so tests can execute the real statement against a real migrated
 * schema with real rows. A query this shape — nine composable filters, three sort
 * orders, keyset pagination that has to compare the same expression it orders by
 * — cannot be checked by matching source text.
 */
export function buildLibraryQuery(
  userId: string,
  options: LibraryOptions = {},
) {
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, options.limit ?? DEFAULT_LIMIT),
  );
  const sort: LibrarySort = options.sort ?? "activity";
  const filters: LibraryFilters = {
    docType: options.docType,
    label: options.label,
    hasPassageNotes: options.hasPassageNotes,
    hasDocumentNote: options.hasDocumentNote,
    hasOpenFollowUps: options.hasOpenFollowUps,
    tagId: options.tagId,
    collectionId: options.collectionId,
    savedFrom: options.savedFrom,
    savedTo: options.savedTo,
    sort,
    includePreview: options.includePreview,
  };
  // The cursor is bound to this exact filter set, so it cannot be replayed
  // against a wider one to page past a filter.
  const shape = JSON.stringify(filters);
  const cursor = decodeCursor(options.cursor ?? null, userId, shape);
  if (options.cursor && !cursor) throw new Error("INVALID_CURSOR");

  const sortColumn = SORT_COLUMNS[sort];
  const orderBy =
    sort === "title"
      ? "a.title COLLATE NOCASE ASC, a.id ASC"
      : `${sortColumn} DESC, a.id DESC`;
  // Keyset pagination has to compare the same expression it orders by.
  const keyset =
    sort === "title"
      ? "(? IS NULL OR a.id > ?)"
      : `(? IS NULL OR ${sortColumn} < ? OR (${sortColumn} = ? AND a.id < ?))`;

  const preview = filters.includePreview
    ? `(SELECT COALESCE(
          (SELECT n.body FROM document_notes n
            WHERE n.userId = a.userId AND n.authorityId = a.id),
          (SELECT p3.note FROM passage_annotations p3
            WHERE p3.userId = a.userId AND p3.authorityId = a.id
              AND p3.deletedAt IS NULL AND p3.note IS NOT NULL AND p3.note != ''
            ORDER BY p3.updatedAt DESC, p3.id DESC LIMIT 1)
        )) AS notePreview`
    : "NULL AS notePreview";

  const sql = `SELECT a.id, a.docType, a.docId, a.title, a.citation, a.path,
      a.savedAt, a.createdAt, a.activityAt,
      COUNT(p.id) AS annotationCount,
      SUM(CASE WHEN p.note IS NOT NULL AND p.note != '' THEN 1 ELSE 0 END)
        AS passageNoteCount,
      MAX(p.updatedAt) AS lastAnnotationAt,
      group_concat(DISTINCT p.label) AS labelList,
      (SELECT COUNT(*) FROM document_notes n
        WHERE n.userId = a.userId AND n.authorityId = a.id)
        AS documentNoteCount,
      (SELECT COUNT(*) FROM annotation_follow_ups f
        JOIN passage_annotations p2
          ON p2.userId = f.userId AND p2.id = f.annotationId
        WHERE f.userId = a.userId AND p2.authorityId = a.id
          AND f.resolvedAt IS NULL AND p2.deletedAt IS NULL)
        AS openFollowUpCount,
      (SELECT group_concat(t.name) FROM research_tag_members m
        JOIN research_tags t ON t.id = m.tagId
        WHERE m.userId = a.userId AND m.authorityId = a.id
          AND t.archivedAt IS NULL) AS tagList,
      (SELECT group_concat(c.name) FROM research_collection_members m
        JOIN research_collections c ON c.id = m.collectionId
        WHERE m.userId = a.userId AND m.authorityId = a.id
          AND c.archivedAt IS NULL) AS collectionList,
      ${preview}
    FROM saved_authorities a
    LEFT JOIN passage_annotations p
      ON p.userId = a.userId AND p.authorityId = a.id AND p.deletedAt IS NULL
    WHERE a.userId = ?
      AND (
        a.savedAt IS NOT NULL OR p.id IS NOT NULL
        OR EXISTS (SELECT 1 FROM document_notes n
          WHERE n.userId = a.userId AND n.authorityId = a.id)
      )
      AND (? = '' OR a.docType = ?)
      AND (? = '' OR EXISTS (SELECT 1 FROM passage_annotations pl
        WHERE pl.userId = a.userId AND pl.authorityId = a.id
          AND pl.deletedAt IS NULL AND pl.label = ?))
      AND (? = 0 OR EXISTS (SELECT 1 FROM passage_annotations pn
        WHERE pn.userId = a.userId AND pn.authorityId = a.id
          AND pn.deletedAt IS NULL AND pn.note IS NOT NULL AND pn.note != ''))
      AND (? = 0 OR EXISTS (SELECT 1 FROM document_notes nd
        WHERE nd.userId = a.userId AND nd.authorityId = a.id))
      AND (? = 0 OR EXISTS (SELECT 1 FROM annotation_follow_ups fo
        JOIN passage_annotations pf
          ON pf.userId = fo.userId AND pf.id = fo.annotationId
        WHERE fo.userId = a.userId AND pf.authorityId = a.id
          AND fo.resolvedAt IS NULL AND pf.deletedAt IS NULL))
      AND (? = '' OR EXISTS (SELECT 1 FROM research_tag_members mt
        WHERE mt.userId = a.userId AND mt.authorityId = a.id AND mt.tagId = ?))
      AND (? = '' OR EXISTS (SELECT 1 FROM research_collection_members mc
        WHERE mc.userId = a.userId AND mc.authorityId = a.id
          AND mc.collectionId = ?))
      AND (? IS NULL OR COALESCE(a.savedAt, a.createdAt) >= ?)
      AND (? IS NULL OR COALESCE(a.savedAt, a.createdAt) <= ?)
      AND ${keyset}
    GROUP BY a.id
    ORDER BY ${orderBy} LIMIT ?`;

  const filterParams: unknown[] = [
    userId,
    filters.docType ?? "",
    filters.docType ?? "",
    filters.label ?? "",
    filters.label ?? "",
    filters.hasPassageNotes ? 1 : 0,
    filters.hasDocumentNote ? 1 : 0,
    filters.hasOpenFollowUps ? 1 : 0,
    filters.tagId ?? "",
    filters.tagId ?? "",
    filters.collectionId ?? "",
    filters.collectionId ?? "",
    filters.savedFrom ?? null,
    filters.savedFrom ?? null,
    filters.savedTo ?? null,
    filters.savedTo ?? null,
  ];
  const keysetParams =
    sort === "title"
      ? [cursor?.id ?? null, cursor?.id ?? null]
      : [
          cursor?.at ?? null,
          cursor?.at ?? null,
          cursor?.at ?? null,
          cursor?.id ?? null,
        ];

  return {
    sql,
    params: [...filterParams, ...keysetParams, limit + 1],
    limit,
    sort,
    shape,
  };
}

interface PageContext {
  limit: number;
  sort: LibrarySort;
  shape: string;
  userId: string;
}

/** Shape raw rows into cards, splitting the concatenated lists. */
export function toLibraryPage(
  rows: LibraryRow[],
  { limit, sort, shape, userId }: PageContext,
) {
  const all = rows;
  const page = all.slice(0, limit);
  const cards: LibraryCard[] = page.map(
    ({ labelList, tagList, collectionList, ...row }) => ({
      ...row,
      labels: splitList(labelList),
      tags: splitList(tagList),
      collections: splitList(collectionList),
      notePreview: bounded(row.notePreview),
    }),
  );

  const last = page.at(-1);
  const cursorAt =
    sort === "saved" ? (last?.savedAt ?? last?.createdAt) : last?.activityAt;
  return {
    authorities: cards,
    sort,
    nextCursor:
      all.length > limit && last && typeof cursorAt === "number"
        ? encodeCursor({
            v: 1,
            owner: userId,
            shape,
            at: cursorAt,
            id: last.id,
          })
        : null,
  };
}

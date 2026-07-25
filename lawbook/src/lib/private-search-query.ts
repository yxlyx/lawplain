/**
 * Search a reader's own private research (#196).
 *
 * Pure query construction, so the statement can be executed against the real
 * migrated schema in tests. Four match sources, each reported so a result can say
 * *why* it matched, and each kept distinct so the reader's own words are never
 * presented as the law's.
 *
 * D1 has no FTS5 table here, and adding one would mean mirroring private note
 * text into a second table — more copies of the most sensitive data in the
 * product. A bounded LIKE scan over one user's rows, with owner-scoped indexes
 * doing the selection first, is the right trade at personal-library size.
 */
import { decodeCursor, encodeCursor } from "./private-cursor.ts";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
export const MAX_QUERY_LENGTH = 200;
export const SNIPPET_LENGTH = 180;

/** Where a hit came from. Source text and the reader's own text stay separate. */
export type MatchField =
  | "title"
  | "citation"
  | "passage"
  | "passageNote"
  | "documentNote";

export interface PrivateSearchOptions {
  q: string;
  docType?: "judgment" | "statute";
  label?: string;
  tagId?: string;
  collectionId?: string;
  limit?: number;
  cursor?: string | null;
}

export interface PrivateSearchHit {
  kind: "annotation" | "documentNote" | "document";
  authorityId: string;
  annotationId: string | null;
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  citation: string;
  path: string;
  label: string | null;
  /** Verbatim source text, when the hit is anchored to a passage. */
  sourceText: string | null;
  /** The reader's own words. Never merged with sourceText. */
  noteText: string | null;
  matchedIn: MatchField[];
  updatedAt: number;
}

interface SearchRow extends Omit<PrivateSearchHit, "matchedIn"> {
  matchTitle: number;
  matchCitation: number;
  matchPassage: number;
  matchPassageNote: number;
  matchDocumentNote: number;
}

export function normalizeSearchQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > MAX_QUERY_LENGTH) return null;
  return cleaned;
}

/**
 * Escape LIKE wildcards so a query containing % or _ searches for those
 * characters instead of matching everything.
 */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** A window of text around the first match, so the reader sees why it matched. */
export function snippet(text: string | null, q: string): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at === -1)
    return flat.length > SNIPPET_LENGTH
      ? `${flat.slice(0, SNIPPET_LENGTH).trimEnd()}…`
      : flat;
  const start = Math.max(0, at - Math.floor(SNIPPET_LENGTH / 3));
  const end = Math.min(flat.length, start + SNIPPET_LENGTH);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${
    end < flat.length ? "…" : ""
  }`;
}

/**
 * Union of three row shapes: annotations, document notes, and documents matched by
 * their own title or citation. Every branch is filtered by userId first.
 */
export function buildPrivateSearchQuery(
  userId: string,
  options: PrivateSearchOptions,
) {
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, options.limit ?? DEFAULT_LIMIT),
  );
  const filters = {
    q: options.q,
    docType: options.docType,
    label: options.label,
    tagId: options.tagId,
    collectionId: options.collectionId,
  };
  const shape = JSON.stringify(filters);
  const cursor = decodeCursor(options.cursor ?? null, userId, shape);
  if (options.cursor && !cursor) throw new Error("INVALID_CURSOR");

  const pattern = likePattern(options.q);
  const docType = options.docType ?? "";
  const label = options.label ?? "";
  const tagId = options.tagId ?? "";
  const collectionId = options.collectionId ?? "";

  // Repeated for each branch of the union.
  const scope = `AND (? = '' OR a.docType = ?)
      AND (? = '' OR EXISTS (SELECT 1 FROM research_tag_members mt
        WHERE mt.userId = a.userId AND mt.authorityId = a.id AND mt.tagId = ?))
      AND (? = '' OR EXISTS (SELECT 1 FROM research_collection_members mc
        WHERE mc.userId = a.userId AND mc.authorityId = a.id
          AND mc.collectionId = ?))`;
  const scopeParams = [
    docType,
    docType,
    tagId,
    tagId,
    collectionId,
    collectionId,
  ];

  const sql = `SELECT * FROM (
      SELECT 'annotation' AS kind, p.authorityId, p.id AS annotationId,
        a.docType, a.docId, p.title, p.citation, p.path, p.label,
        p.exactText AS sourceText, p.note AS noteText,
        0 AS matchTitle, 0 AS matchCitation,
        (p.exactText LIKE ? ESCAPE '\\') AS matchPassage,
        (p.note IS NOT NULL AND p.note LIKE ? ESCAPE '\\') AS matchPassageNote,
        0 AS matchDocumentNote,
        p.updatedAt
      FROM passage_annotations p
      JOIN saved_authorities a ON a.userId = p.userId AND a.id = p.authorityId
      WHERE p.userId = ? AND p.deletedAt IS NULL
        AND (p.exactText LIKE ? ESCAPE '\\'
          OR (p.note IS NOT NULL AND p.note LIKE ? ESCAPE '\\'))
        AND (? = '' OR p.label = ?)
        ${scope}

      UNION ALL

      SELECT 'documentNote' AS kind, n.authorityId, NULL AS annotationId,
        a.docType, a.docId, n.title, n.citation, n.path, NULL AS label,
        NULL AS sourceText, n.body AS noteText,
        0 AS matchTitle, 0 AS matchCitation, 0 AS matchPassage,
        0 AS matchPassageNote, 1 AS matchDocumentNote,
        n.updatedAt
      FROM document_notes n
      JOIN saved_authorities a ON a.userId = n.userId AND a.id = n.authorityId
      WHERE n.userId = ? AND n.body LIKE ? ESCAPE '\\'
        AND ? = ''
        ${scope}

      UNION ALL

      SELECT 'document' AS kind, a.id AS authorityId, NULL AS annotationId,
        a.docType, a.docId, a.title, a.citation, a.path, NULL AS label,
        NULL AS sourceText, NULL AS noteText,
        (a.title LIKE ? ESCAPE '\\') AS matchTitle,
        (a.citation LIKE ? ESCAPE '\\') AS matchCitation,
        0 AS matchPassage, 0 AS matchPassageNote, 0 AS matchDocumentNote,
        a.activityAt AS updatedAt
      FROM saved_authorities a
      WHERE a.userId = ?
        AND (a.title LIKE ? ESCAPE '\\' OR a.citation LIKE ? ESCAPE '\\')
        AND ? = ''
        ${scope}
    )
    WHERE (? IS NULL OR updatedAt < ? OR (updatedAt = ? AND authorityId < ?))
    ORDER BY updatedAt DESC, authorityId DESC LIMIT ?`;

  const params: unknown[] = [
    // annotation branch
    pattern,
    pattern,
    userId,
    pattern,
    pattern,
    label,
    label,
    ...scopeParams,
    // document-note branch: a label filter is about passages, so a label filter
    // excludes document notes rather than silently ignoring the filter.
    userId,
    pattern,
    label,
    ...scopeParams,
    // document branch: same reasoning for the label filter.
    pattern,
    pattern,
    userId,
    pattern,
    pattern,
    label,
    ...scopeParams,
    // keyset
    cursor?.at ?? null,
    cursor?.at ?? null,
    cursor?.at ?? null,
    cursor?.id ?? null,
    limit + 1,
  ];

  return { sql, params, limit, shape };
}

const FIELDS: Array<[keyof SearchRow, MatchField]> = [
  ["matchTitle", "title"],
  ["matchCitation", "citation"],
  ["matchPassage", "passage"],
  ["matchPassageNote", "passageNote"],
  ["matchDocumentNote", "documentNote"],
];

export function toPrivateSearchPage(
  rows: SearchRow[],
  {
    limit,
    shape,
    userId,
    q,
  }: { limit: number; shape: string; userId: string; q: string },
) {
  const page = rows.slice(0, limit);
  const results: PrivateSearchHit[] = page.map((row) => {
    const matchedIn = FIELDS.filter(([key]) => Number(row[key]) === 1).map(
      ([, field]) => field,
    );
    return {
      kind: row.kind,
      authorityId: row.authorityId,
      annotationId: row.annotationId,
      docType: row.docType,
      docId: row.docId,
      title: row.title,
      citation: row.citation,
      path: row.path,
      label: row.label,
      // Kept in separate fields all the way to the client so a rendering mistake
      // cannot present the reader's commentary as the law's words.
      sourceText: snippet(row.sourceText, q),
      noteText: snippet(row.noteText, q),
      matchedIn,
      updatedAt: row.updatedAt,
    };
  });
  const last = page.at(-1);
  return {
    results,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({
            v: 1,
            owner: userId,
            shape,
            at: last.updatedAt,
            id: last.authorityId,
          })
        : null,
  };
}

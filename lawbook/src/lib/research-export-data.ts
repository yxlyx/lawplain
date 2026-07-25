/**
 * Gather one reader's research for export (#198).
 *
 * Every statement is owner-scoped; the export route never narrows by anything but
 * the session's own user id, so an export can only ever contain the caller's data.
 */
import { getAuthDb } from "@/lib/d1";
import type { ExportDocument } from "@/lib/research-export";

const MAX_DOCUMENTS = 2_000;
const MAX_ANNOTATIONS = 20_000;

interface DocRow {
  authorityId: string;
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  citation: string;
  path: string;
  savedAt: number | null;
  noteBody: string | null;
  noteTemplate: string | null;
  noteUpdatedAt: number | null;
  tagList: string | null;
  collectionList: string | null;
}

interface AnnotationRow {
  authorityId: string;
  annotationId: string;
  exactText: string;
  note: string | null;
  label: string;
  path: string;
  startOffset: number;
  endOffset: number;
  createdAt: number;
  updatedAt: number;
}

function splitList(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function collectResearchForExport(
  userId: string,
  scope: { docType?: "judgment" | "statute"; docId?: string } = {},
): Promise<ExportDocument[]> {
  const db = await getAuthDb();
  const docType = scope.docType ?? "";
  const docId = scope.docId ?? "";

  const documents = await db
    .prepare(`SELECT a.id AS authorityId, a.docType, a.docId, a.title,
        a.citation, a.path, a.savedAt,
        n.body AS noteBody, n.template AS noteTemplate,
        n.updatedAt AS noteUpdatedAt,
        (SELECT group_concat(t.name) FROM research_tag_members m
          JOIN research_tags t ON t.id = m.tagId
          WHERE m.userId = a.userId AND m.authorityId = a.id) AS tagList,
        (SELECT group_concat(c.name) FROM research_collection_members m
          JOIN research_collections c ON c.id = m.collectionId
          WHERE m.userId = a.userId AND m.authorityId = a.id) AS collectionList
      FROM saved_authorities a
      LEFT JOIN document_notes n
        ON n.userId = a.userId AND n.authorityId = a.id
      WHERE a.userId = ?
        AND (? = '' OR a.docType = ?)
        AND (? = '' OR a.docId = ?)
      ORDER BY a.activityAt DESC, a.id DESC
      LIMIT ?`)
    .bind(userId, docType, docType, docId, docId, MAX_DOCUMENTS)
    .all<DocRow>();

  const rows = documents.results ?? [];
  if (rows.length === 0) return [];

  const annotations = await db
    .prepare(`SELECT p.authorityId, p.id AS annotationId, p.exactText, p.note,
        p.label, p.path, p.startOffset, p.endOffset, p.createdAt, p.updatedAt
      FROM passage_annotations p
      JOIN saved_authorities a ON a.userId = p.userId AND a.id = p.authorityId
      WHERE p.userId = ? AND p.deletedAt IS NULL
        AND (? = '' OR a.docType = ?)
        AND (? = '' OR a.docId = ?)
      ORDER BY p.createdAt ASC, p.id ASC
      LIMIT ?`)
    .bind(userId, docType, docType, docId, docId, MAX_ANNOTATIONS)
    .all<AnnotationRow>();

  const byAuthority = new Map<string, AnnotationRow[]>();
  for (const row of annotations.results ?? []) {
    const list = byAuthority.get(row.authorityId) ?? [];
    list.push(row);
    byAuthority.set(row.authorityId, list);
  }

  return rows.map((row) => ({
    docType: row.docType,
    docId: row.docId,
    title: row.title,
    citation: row.citation,
    path: row.path,
    savedAt: row.savedAt,
    documentNote:
      row.noteBody !== null
        ? {
            body: row.noteBody,
            template: row.noteTemplate ?? "free",
            updatedAt: row.noteUpdatedAt ?? 0,
          }
        : null,
    annotations: (byAuthority.get(row.authorityId) ?? []).map((a) => ({
      annotationId: a.annotationId,
      exactText: a.exactText,
      note: a.note,
      label: a.label,
      path: a.path,
      startOffset: a.startOffset,
      endOffset: a.endOffset,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
    tags: splitList(row.tagList),
    collections: splitList(row.collectionList),
  }));
}

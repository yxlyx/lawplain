/**
 * Server-side assembly of consented private context (#200).
 *
 * Authorization is rechecked here, on every request, against the session's own
 * user id — the client's claim about which annotations it may use is treated as a
 * request, never as a fact. An id the reader does not own simply does not come
 * back from the query, so it cannot enter a prompt.
 */

import type { AskConsent, ManifestItem } from "@/lib/ask-consent";
import { getAuthDb } from "@/lib/d1";

const PREVIEW_LIMIT = 4_000;

function bounded(value: string | null): string | null {
  if (!value) return null;
  const flat = value.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > PREVIEW_LIMIT
    ? `${flat.slice(0, PREVIEW_LIMIT)}…`
    : flat;
}

/**
 * Load exactly the consented rows the reader actually owns.
 *
 * Returns items and their deep links. When consent is absent this does no query at
 * all, so an un-consented request cannot even read the note text server-side.
 */
export async function loadConsentedContext(
  userId: string,
  consent: AskConsent,
): Promise<{ items: ManifestItem[]; urls: Record<string, string> }> {
  if (!consent.includePrivateNotes) return { items: [], urls: {} };

  const db = await getAuthDb();
  const items: ManifestItem[] = [];
  const urls: Record<string, string> = {};

  if (consent.annotationIds.length > 0) {
    const placeholders = consent.annotationIds.map(() => "?").join(", ");
    const rows = await db
      .prepare(`SELECT p.id, p.title, p.citation, p.label, p.exactText, p.note,
          p.path
        FROM passage_annotations p
        JOIN saved_authorities a ON a.userId = p.userId AND a.id = p.authorityId
        WHERE p.userId = ? AND p.deletedAt IS NULL
          AND p.id IN (${placeholders})`)
      .bind(userId, ...consent.annotationIds)
      .all<{
        id: string;
        title: string;
        citation: string;
        label: string;
        exactText: string;
        note: string | null;
        path: string;
      }>();
    for (const row of rows.results ?? []) {
      items.push({
        kind: "annotation",
        id: row.id,
        title: row.title,
        citation: row.citation,
        label: row.label,
        sourcePreview: bounded(row.exactText),
        notePreview: bounded(row.note),
        hasNote: Boolean(row.note?.trim()),
      });
      urls[row.id] = row.path;
    }
  }

  if (consent.documentNoteAuthorityIds.length > 0) {
    const placeholders = consent.documentNoteAuthorityIds
      .map(() => "?")
      .join(", ");
    const rows = await db
      .prepare(`SELECT n.authorityId, n.title, n.citation, n.body, n.path
        FROM document_notes n
        JOIN saved_authorities a ON a.userId = n.userId AND a.id = n.authorityId
        WHERE n.userId = ? AND n.authorityId IN (${placeholders})`)
      .bind(userId, ...consent.documentNoteAuthorityIds)
      .all<{
        authorityId: string;
        title: string;
        citation: string;
        body: string;
        path: string;
      }>();
    for (const row of rows.results ?? []) {
      items.push({
        kind: "documentNote",
        id: row.authorityId,
        title: row.title,
        citation: row.citation,
        label: null,
        sourcePreview: null,
        notePreview: bounded(row.body),
        hasNote: Boolean(row.body.trim()),
      });
      urls[row.authorityId] = row.path;
    }
  }

  return { items, urls };
}

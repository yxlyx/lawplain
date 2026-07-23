import { getAuthDb } from "@/lib/d1";

export type SavedDocType = "judgment" | "statute";

export interface SavedAuthority {
  id: string;
  docType: SavedDocType;
  docId: string;
  title: string;
  citation: string;
  path: string;
  savedAt: number;
  createdAt: number;
  activityAt: number;
  /** Compatibility alias used by the existing saved-workspace UI. */
  updatedAt: number;
}

export function isSavedDocType(value: unknown): value is SavedDocType {
  return value === "judgment" || value === "statute";
}

export function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const SAVED_COLUMNS = `id, docType, docId, title, citation, path, savedAt,
  createdAt, activityAt, activityAt AS updatedAt`;

export async function listSavedAuthorities(
  userId: string,
): Promise<SavedAuthority[]> {
  const db = await getAuthDb();
  const result = await db
    .prepare(`SELECT ${SAVED_COLUMNS}
    FROM saved_authorities WHERE userId = ? AND savedAt IS NOT NULL
    ORDER BY activityAt DESC, id DESC LIMIT 100`)
    .bind(userId)
    .all<SavedAuthority>();
  return result.results ?? [];
}

export async function getSavedAuthority({
  userId,
  docType,
  docId,
}: {
  userId: string;
  docType: SavedDocType;
  docId: string;
}): Promise<SavedAuthority | null> {
  const db = await getAuthDb();
  return (
    (await db
      .prepare(`SELECT ${SAVED_COLUMNS} FROM saved_authorities
    WHERE userId = ? AND docType = ? AND docId = ? AND savedAt IS NOT NULL`)
      .bind(userId, docType, docId)
      .first<SavedAuthority>()) ?? null
  );
}

export async function saveAuthority({
  userId,
  docType,
  docId,
  title,
  path,
  citation = "",
}: {
  userId: string;
  docType: SavedDocType;
  docId: string;
  title: string;
  path: string;
  citation?: string;
}): Promise<SavedAuthority> {
  const db = await getAuthDb();
  const now = Date.now();
  await db
    .prepare(`INSERT INTO saved_authorities
    (id, userId, docType, docId, title, path, createdAt, updatedAt,
     citation, savedAt, activityAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(userId, docType, docId) DO UPDATE SET
      title = excluded.title,
      citation = CASE WHEN excluded.citation = '' THEN saved_authorities.citation
        ELSE excluded.citation END,
      path = excluded.path,
      savedAt = COALESCE(saved_authorities.savedAt, excluded.savedAt),
      activityAt = MAX(saved_authorities.activityAt, excluded.activityAt),
      updatedAt = excluded.updatedAt`)
    .bind(
      crypto.randomUUID(),
      userId,
      docType,
      docId,
      title,
      path,
      now,
      now,
      citation,
      now,
      now,
    )
    .run();
  const saved = await getSavedAuthority({ userId, docType, docId });
  if (!saved) throw new Error("Saved authority write did not produce a row");
  return saved;
}

export async function deleteSavedAuthority({
  userId,
  docType,
  docId,
}: {
  userId: string;
  docType: SavedDocType;
  docId: string;
}): Promise<void> {
  const db = await getAuthDb();
  await db.batch([
    db
      .prepare(`UPDATE saved_authorities SET savedAt = NULL, updatedAt = ?
      WHERE userId = ? AND docType = ? AND docId = ? AND savedAt IS NOT NULL`)
      .bind(Date.now(), userId, docType, docId),
    db
      .prepare(`DELETE FROM saved_authorities
      WHERE userId = ? AND docType = ? AND docId = ? AND savedAt IS NULL
        AND NOT EXISTS (SELECT 1 FROM passage_annotations
          WHERE userId = ? AND authorityId = saved_authorities.id)`)
      .bind(userId, docType, docId, userId),
  ]);
}

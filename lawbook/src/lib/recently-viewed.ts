import { getAuthDb } from "@/lib/d1";

export const RECENT_DOCUMENT_TYPES = [
  "judgment",
  "statute",
  "hansard",
  "bills",
  "subsidiary",
  "practice",
  "guidance",
] as const;

export type RecentDocumentType = (typeof RECENT_DOCUMENT_TYPES)[number];

export interface RecentlyViewedDocument {
  id: string;
  docType: RecentDocumentType;
  docId: string;
  title: string;
  path: string;
  viewedAt: number;
  createdAt: number;
  updatedAt: number;
}

const RECENTLY_VIEWED_LIMIT = 50;

export function isRecentDocumentType(
  value: unknown,
): value is RecentDocumentType {
  return (
    typeof value === "string" &&
    RECENT_DOCUMENT_TYPES.includes(value as RecentDocumentType)
  );
}

export function cleanRecentText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function listRecentlyViewedDocuments(
  userId: string,
  limit = RECENTLY_VIEWED_LIMIT,
): Promise<RecentlyViewedDocument[]> {
  const db = await getAuthDb();
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  const result = await db
    .prepare(
      `SELECT id, docType, docId, title, path, viewedAt, createdAt, updatedAt
       FROM recently_viewed_documents
       WHERE userId = ?
       ORDER BY viewedAt DESC, updatedAt DESC, id DESC
       LIMIT ?`,
    )
    .bind(userId, safeLimit)
    .all<RecentlyViewedDocument>();
  return result.results ?? [];
}

export async function recordRecentlyViewedDocument({
  userId,
  docType,
  docId,
  title,
  path,
}: {
  userId: string;
  docType: RecentDocumentType;
  docId: string;
  title: string;
  path: string;
}): Promise<RecentlyViewedDocument> {
  const db = await getAuthDb();
  const existing =
    (await db
      .prepare(
        `SELECT id, createdAt
         FROM recently_viewed_documents
         WHERE userId = ? AND docType = ? AND docId = ?`,
      )
      .bind(userId, docType, docId)
      .first<{ id: string; createdAt: number }>()) ?? null;
  const now = Date.now();
  const id = existing?.id ?? crypto.randomUUID();
  const createdAt = existing?.createdAt ?? now;

  await db.batch([
    db
      .prepare(
        `INSERT INTO recently_viewed_documents
          (id, userId, docType, docId, title, path, viewedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(userId, docType, docId) DO UPDATE SET
           title = excluded.title,
           path = excluded.path,
           viewedAt = excluded.viewedAt,
           updatedAt = excluded.updatedAt`,
      )
      .bind(id, userId, docType, docId, title, path, now, createdAt, now),
    db
      .prepare(
        `DELETE FROM recently_viewed_documents
         WHERE userId = ?
           AND id NOT IN (
             SELECT id
             FROM recently_viewed_documents
             WHERE userId = ?
             ORDER BY viewedAt DESC, updatedAt DESC, id DESC
             LIMIT ?
           )`,
      )
      .bind(userId, userId, RECENTLY_VIEWED_LIMIT),
  ]);

  return {
    id,
    docType,
    docId,
    title,
    path,
    viewedAt: now,
    createdAt,
    updatedAt: now,
  };
}

export async function deleteRecentlyViewedDocument({
  userId,
  docType,
  docId,
}: {
  userId: string;
  docType: RecentDocumentType;
  docId: string;
}): Promise<void> {
  const db = await getAuthDb();
  await db
    .prepare(
      "DELETE FROM recently_viewed_documents WHERE userId = ? AND docType = ? AND docId = ?",
    )
    .bind(userId, docType, docId)
    .run();
}

export async function clearRecentlyViewedDocuments(
  userId: string,
): Promise<void> {
  const db = await getAuthDb();
  await db
    .prepare("DELETE FROM recently_viewed_documents WHERE userId = ?")
    .bind(userId)
    .run();
}

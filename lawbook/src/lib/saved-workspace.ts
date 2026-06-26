import { getAuthDb } from "@/lib/d1";

export type SavedDocType = "judgment" | "statute";

export interface SavedAuthority {
  id: string;
  docType: SavedDocType;
  docId: string;
  title: string;
  path: string;
  createdAt: number;
  updatedAt: number;
}

export interface SavedHighlight {
  id: string;
  docType: SavedDocType;
  docId: string;
  title: string;
  path: string;
  sectionId: string | null;
  selectedText: string;
  createdAt: number;
  updatedAt: number;
}

export function isSavedDocType(value: unknown): value is SavedDocType {
  return value === "judgment" || value === "statute";
}

export function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function listSavedAuthorities(
  userId: string,
): Promise<SavedAuthority[]> {
  const db = await getAuthDb();
  const result = await db
    .prepare(
      `SELECT id, docType, docId, title, path, createdAt, updatedAt
       FROM saved_authorities
       WHERE userId = ?
       ORDER BY updatedAt DESC, createdAt DESC
       LIMIT 100`,
    )
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
      .prepare(
        `SELECT id, docType, docId, title, path, createdAt, updatedAt
         FROM saved_authorities
         WHERE userId = ? AND docType = ? AND docId = ?`,
      )
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
}: {
  userId: string;
  docType: SavedDocType;
  docId: string;
  title: string;
  path: string;
}): Promise<SavedAuthority> {
  const db = await getAuthDb();
  const existing = await getSavedAuthority({ userId, docType, docId });
  const now = Date.now();
  const id = existing?.id ?? crypto.randomUUID();
  const createdAt = existing?.createdAt ?? now;
  await db
    .prepare(
      `INSERT INTO saved_authorities (id, userId, docType, docId, title, path, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId, docType, docId) DO UPDATE SET
         title = excluded.title,
         path = excluded.path,
         updatedAt = excluded.updatedAt`,
    )
    .bind(id, userId, docType, docId, title, path, createdAt, now)
    .run();
  return { id, docType, docId, title, path, createdAt, updatedAt: now };
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
  await db
    .prepare(
      "DELETE FROM saved_authorities WHERE userId = ? AND docType = ? AND docId = ?",
    )
    .bind(userId, docType, docId)
    .run();
}

export async function listSavedHighlights(
  userId: string,
): Promise<SavedHighlight[]> {
  const db = await getAuthDb();
  const result = await db
    .prepare(
      `SELECT id, docType, docId, title, path, sectionId, selectedText, createdAt, updatedAt
       FROM saved_highlights
       WHERE userId = ?
       ORDER BY createdAt DESC
       LIMIT 100`,
    )
    .bind(userId)
    .all<SavedHighlight>();
  return result.results ?? [];
}

export async function createSavedHighlight({
  userId,
  docType,
  docId,
  title,
  path,
  sectionId,
  selectedText,
}: {
  userId: string;
  docType: SavedDocType;
  docId: string;
  title: string;
  path: string;
  sectionId?: string;
  selectedText: string;
}): Promise<SavedHighlight> {
  const db = await getAuthDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const cleanSectionId = sectionId || null;
  await db
    .prepare(
      `INSERT INTO saved_highlights (id, userId, docType, docId, title, path, sectionId, selectedText, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      docType,
      docId,
      title,
      path,
      cleanSectionId,
      selectedText,
      now,
      now,
    )
    .run();
  return {
    id,
    docType,
    docId,
    title,
    path,
    sectionId: cleanSectionId,
    selectedText,
    createdAt: now,
    updatedAt: now,
  };
}

export async function deleteSavedHighlight({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<void> {
  const db = await getAuthDb();
  await db
    .prepare("DELETE FROM saved_highlights WHERE userId = ? AND id = ?")
    .bind(userId, id)
    .run();
}

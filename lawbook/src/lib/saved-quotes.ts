import { getAuthDb } from "@/lib/d1";
import { normalizeInternalPath } from "@/lib/internal-path";

export const MAX_QUOTE_LENGTH = 5_000;
export const QUOTE_RESTORE_WINDOW_MS = 10_000;

export function quoteRestoreCutoff(now = Date.now()) {
  return now - QUOTE_RESTORE_WINDOW_MS;
}

const MAX_SHORT = 500;
const MAX_CONTEXT = 300;

export type SavedQuote = {
  id: string;
  docType: "judgment" | "statute";
  docId: string;
  exactText: string;
  sourceTitle: string;
  citation: string;
  path: string;
  anchor: string;
  startOffset: number;
  endOffset: number;
  contextBefore: string;
  contextAfter: string;
  createdAt: number;
};

type QuoteInput = Omit<SavedQuote, "id" | "createdAt">;

export function normalizeQuote(value: unknown): QuoteInput | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.docType !== "judgment" && raw.docType !== "statute") return null;
  const exactText =
    typeof raw.exactText === "string" &&
    raw.exactText.length <= MAX_QUOTE_LENGTH
      ? raw.exactText
      : "";
  const docId = clean(raw.docId, MAX_SHORT);
  const sourceTitle = clean(raw.sourceTitle, MAX_SHORT);
  const citation = clean(raw.citation, MAX_SHORT);
  const path = normalizeInternalPath(raw.path);
  const anchor = clean(raw.anchor, MAX_SHORT);
  const startOffset = integer(raw.startOffset);
  const endOffset = integer(raw.endOffset);
  if (
    !exactText.trim() ||
    !docId ||
    !sourceTitle ||
    !citation ||
    !path ||
    !path.startsWith(`/${raw.docType}/`) ||
    !anchor ||
    startOffset === null ||
    endOffset === null ||
    startOffset < 0 ||
    endOffset - startOffset !== exactText.length
  )
    return null;
  return {
    docType: raw.docType,
    docId,
    exactText,
    sourceTitle,
    citation,
    path,
    anchor,
    startOffset,
    endOffset,
    contextBefore: contextBefore(raw.contextBefore),
    contextAfter: contextAfter(raw.contextAfter),
  };
}

export async function listSavedQuotes(userId: string): Promise<SavedQuote[]> {
  const db = await getAuthDb();
  const result = await db
    .prepare(
      `SELECT id, docType, docId, exactText, sourceTitle, citation, path, anchor,
            startOffset, endOffset, contextBefore, contextAfter, createdAt
       FROM saved_quotes WHERE userId = ? AND deletedAt IS NULL
       ORDER BY createdAt DESC, id DESC LIMIT 100`,
    )
    .bind(userId)
    .all<SavedQuote>();
  return result.results ?? [];
}

export async function getSavedQuote(userId: string, id: string) {
  const db = await getAuthDb();
  return db
    .prepare(
      `SELECT id, docType, docId, exactText, sourceTitle, citation, path, anchor,
              startOffset, endOffset, contextBefore, contextAfter, createdAt
       FROM saved_quotes
       WHERE userId = ? AND id = ? AND deletedAt IS NULL`,
    )
    .bind(userId, id)
    .first<SavedQuote>();
}

export async function createSavedQuote(userId: string, quote: QuoteInput) {
  const db = await getAuthDb();
  const saved = { ...quote, id: crypto.randomUUID(), createdAt: Date.now() };
  await db
    .prepare(
      `INSERT OR IGNORE INTO saved_quotes
      (id, userId, docType, docId, exactText, sourceTitle, citation, path, anchor,
       startOffset, endOffset, contextBefore, contextAfter, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      saved.id,
      userId,
      saved.docType,
      saved.docId,
      saved.exactText,
      saved.sourceTitle,
      saved.citation,
      saved.path,
      saved.anchor,
      saved.startOffset,
      saved.endOffset,
      saved.contextBefore,
      saved.contextAfter,
      saved.createdAt,
    )
    .run();
  const existing = await db
    .prepare(
      `SELECT id, docType, docId, exactText, sourceTitle, citation, path, anchor,
              startOffset, endOffset, contextBefore, contextAfter, createdAt
       FROM saved_quotes
       WHERE userId = ? AND docType = ? AND docId = ? AND anchor = ?
         AND startOffset = ? AND endOffset = ? AND exactText = ?
         AND deletedAt IS NULL`,
    )
    .bind(
      userId,
      quote.docType,
      quote.docId,
      quote.anchor,
      quote.startOffset,
      quote.endOffset,
      quote.exactText,
    )
    .first<SavedQuote>();
  if (!existing) throw new Error("Could not save quote");
  return existing;
}

export async function deleteSavedQuote(userId: string, id: string) {
  const db = await getAuthDb();
  return db
    .prepare(
      `UPDATE saved_quotes SET deletedAt = ?
       WHERE userId = ? AND id = ? AND deletedAt IS NULL
       RETURNING id, docType, docId, exactText, sourceTitle, citation, path, anchor,
                 startOffset, endOffset, contextBefore, contextAfter, createdAt`,
    )
    .bind(Date.now(), userId, id)
    .first<SavedQuote>();
}

export async function restoreSavedQuote(userId: string, id: string) {
  const db = await getAuthDb();
  const cutoff = quoteRestoreCutoff();
  const restored = await db
    .prepare(
      `UPDATE saved_quotes SET deletedAt = NULL
       WHERE userId = ? AND id = ? AND deletedAt IS NOT NULL AND deletedAt >= ?
         AND NOT EXISTS (
           SELECT 1 FROM saved_quotes AS active
           WHERE active.userId = saved_quotes.userId
             AND active.docType = saved_quotes.docType
             AND active.docId = saved_quotes.docId
             AND active.anchor = saved_quotes.anchor
             AND active.startOffset = saved_quotes.startOffset
             AND active.endOffset = saved_quotes.endOffset
             AND active.exactText = saved_quotes.exactText
             AND active.deletedAt IS NULL
         )
       RETURNING id, docType, docId, exactText, sourceTitle, citation, path, anchor,
                 startOffset, endOffset, contextBefore, contextAfter, createdAt`,
    )
    .bind(userId, id, cutoff)
    .first<SavedQuote>();
  if (restored) return restored;

  return db
    .prepare(
      `SELECT active.id, active.docType, active.docId, active.exactText,
              active.sourceTitle, active.citation, active.path, active.anchor,
              active.startOffset, active.endOffset, active.contextBefore,
              active.contextAfter, active.createdAt
       FROM saved_quotes AS deleted
       JOIN saved_quotes AS active
         ON active.userId = deleted.userId
        AND active.docType = deleted.docType
        AND active.docId = deleted.docId
        AND active.anchor = deleted.anchor
        AND active.startOffset = deleted.startOffset
        AND active.endOffset = deleted.endOffset
        AND active.exactText = deleted.exactText
        AND active.deletedAt IS NULL
       WHERE deleted.userId = ? AND deleted.id = ?
         AND deleted.deletedAt IS NOT NULL AND deleted.deletedAt >= ?
       LIMIT 1`,
    )
    .bind(userId, id, cutoff)
    .first<SavedQuote>();
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function contextBefore(value: unknown) {
  return typeof value === "string" ? value.slice(-MAX_CONTEXT) : "";
}

function contextAfter(value: unknown) {
  return typeof value === "string" ? value.slice(0, MAX_CONTEXT) : "";
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

import { getCloudflareContext } from "@opennextjs/cloudflare";

interface AskHistoryEnv extends CloudflareEnv {
  AUTH_DB?: D1Database;
}

export interface AskQuestionHistoryEntry {
  id: string;
  question: string;
  createdAt: number;
}

const ASK_HISTORY_LIMIT = 50;

export async function getAskHistoryDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as AskHistoryEnv).AUTH_DB;

  if (!db) {
    throw new Error(
      "Missing Cloudflare D1 binding AUTH_DB. Create the D1 database and configure wrangler.jsonc before using Ask history.",
    );
  }

  return db;
}

export async function recordAskQuestion({
  userId,
  question,
  cite,
  kind,
}: {
  userId: string;
  question: string;
  cite?: string;
  kind?: string;
}): Promise<void> {
  const db = await getAskHistoryDb();
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const trimmedQuestion = question.trim().slice(0, 4000);

  if (!trimmedQuestion) return;

  await db.batch([
    db
      .prepare(
        `INSERT INTO ask_question_history (id, userId, question, cite, kind, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, userId, trimmedQuestion, cite ?? null, kind ?? null, createdAt),
    db
      .prepare(
        `DELETE FROM ask_question_history
         WHERE userId = ?
           AND id NOT IN (
             SELECT id
             FROM ask_question_history
             WHERE userId = ?
             ORDER BY createdAt DESC, id DESC
             LIMIT ?
           )`,
      )
      .bind(userId, userId, ASK_HISTORY_LIMIT),
  ]);
}

export async function listAskQuestions({
  userId,
  limit = ASK_HISTORY_LIMIT,
}: {
  userId: string;
  limit?: number;
}): Promise<AskQuestionHistoryEntry[]> {
  const db = await getAskHistoryDb();
  const safeLimit = Math.max(1, Math.min(limit, 100));

  const result = await db
    .prepare(
      `SELECT id, question, createdAt
       FROM ask_question_history
       WHERE userId = ?
       ORDER BY createdAt DESC, id DESC
       LIMIT ?`,
    )
    .bind(userId, safeLimit)
    .all<AskQuestionHistoryEntry>();

  return result.results ?? [];
}

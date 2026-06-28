import { getCloudflareContext } from "@opennextjs/cloudflare";

interface ThreadsEnv extends CloudflareEnv {
  AUTH_DB?: D1Database;
}

export interface ThreadSummary {
  id: string;
  title: string;
  cite: string | null;
  kind: string | null;
  sourceHref: string | null;
  messageCount: number;
  updatedAt: number;
  runId: string | null;
  status: string | null; // 'running' | 'done' | null (legacy = done)
}

export interface ThreadDetail extends ThreadSummary {
  messages: unknown[];
  createdAt: number;
}

const LIST_LIMIT = 100;
/** Cap the serialized transcript so a runaway thread can't bloat the row. */
const MAX_MESSAGES_BYTES = 400_000;

async function getDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as ThreadsEnv).AUTH_DB;
  if (!db) {
    throw new Error(
      "Missing Cloudflare D1 binding AUTH_DB. Apply migrations before using Ask threads.",
    );
  }
  return db;
}

export async function saveThread(input: {
  userId: string;
  id: string;
  title: string;
  messages: unknown[];
  cite?: string;
  kind?: string;
  sourceHref?: string;
  runId?: string;
  status?: string;
}): Promise<{ id: string; updatedAt: number }> {
  const db = await getDb();
  const now = Date.now();

  let msgs = Array.isArray(input.messages) ? input.messages : [];
  let json = JSON.stringify(msgs);
  // Drop the oldest messages until the blob fits, never below one.
  while (json.length > MAX_MESSAGES_BYTES && msgs.length > 1) {
    msgs = msgs.slice(1);
    json = JSON.stringify(msgs);
  }

  await db
    .prepare(
      `INSERT INTO ask_threads
        (id, userId, title, messages, messageCount, cite, kind, sourceHref, runId, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         messages = excluded.messages,
         messageCount = excluded.messageCount,
         cite = excluded.cite,
         kind = excluded.kind,
         sourceHref = excluded.sourceHref,
         runId = excluded.runId,
         status = excluded.status,
         updatedAt = excluded.updatedAt
       WHERE ask_threads.userId = excluded.userId`,
    )
    .bind(
      input.id,
      input.userId,
      input.title.slice(0, 200),
      json,
      msgs.length,
      input.cite || null,
      input.kind || null,
      input.sourceHref || null,
      input.runId || null,
      input.status || null,
      now,
      now,
    )
    .run();

  return { id: input.id, updatedAt: now };
}

interface SummaryRow {
  id: string;
  title: string;
  cite: string | null;
  kind: string | null;
  sourceHref: string | null;
  messageCount: number;
  updatedAt: number;
  runId: string | null;
  status: string | null;
}

export async function listThreads(userId: string): Promise<ThreadSummary[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT id, title, cite, kind, sourceHref, messageCount, updatedAt, runId, status
       FROM ask_threads
       WHERE userId = ?
       ORDER BY updatedAt DESC, id DESC
       LIMIT ?`,
    )
    .bind(userId, LIST_LIMIT)
    .all<SummaryRow>();
  return (results ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    cite: r.cite,
    kind: r.kind,
    sourceHref: r.sourceHref,
    messageCount: Number(r.messageCount),
    updatedAt: Number(r.updatedAt),
    runId: r.runId,
    status: r.status,
  }));
}

interface DetailRow extends SummaryRow {
  messages: string;
  createdAt: number;
}

export async function getThread(
  userId: string,
  id: string,
): Promise<ThreadDetail | null> {
  const db = await getDb();
  const row = await db
    .prepare(
      `SELECT id, title, messages, messageCount, cite, kind, sourceHref, runId, status, createdAt, updatedAt
       FROM ask_threads
       WHERE userId = ? AND id = ?`,
    )
    .bind(userId, id)
    .first<DetailRow>();
  if (!row) return null;
  let messages: unknown[] = [];
  try {
    const parsed = JSON.parse(row.messages);
    if (Array.isArray(parsed)) messages = parsed;
  } catch {
    // ignore malformed transcript
  }
  return {
    id: row.id,
    title: row.title,
    cite: row.cite,
    kind: row.kind,
    sourceHref: row.sourceHref,
    messageCount: Number(row.messageCount),
    updatedAt: Number(row.updatedAt),
    createdAt: Number(row.createdAt),
    runId: row.runId,
    status: row.status,
    messages,
  };
}

export async function deleteThread(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db
    .prepare(`DELETE FROM ask_threads WHERE userId = ? AND id = ?`)
    .bind(userId, id)
    .run();
}

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
  lastPromptAt: number;
  createdAt: number;
  updatedAt: number;
  runId: string | null;
  status: string | null; // 'running' | 'stopped' | 'error' | 'done' | null (legacy = done)
  unread: boolean;
}

export interface ThreadDetail extends ThreadSummary {
  messages: unknown[];
}

const LIST_LIMIT = 100;
/** Cap the serialized transcript so a runaway thread can't bloat the row. */
const MAX_MESSAGES_BYTES = 400_000;

function transcriptScore(messages: unknown[]): number {
  const serializedLength = JSON.stringify(messages).length;
  return messages.reduce<number>((score, message) => {
    if (!message || typeof message !== "object") return score + 1000;
    const row = message as Record<string, unknown>;
    return (
      score +
      1000 +
      (typeof row.text === "string" ? row.text.length : 0) +
      (Array.isArray(row.tools) ? row.tools.length * 50 : 0) +
      (Array.isArray(row.progress) ? row.progress.length * 20 : 0) +
      (typeof row.eventCursor === "number" && Number.isFinite(row.eventCursor)
        ? row.eventCursor * 100
        : 0)
    );
  }, serializedLength);
}

function latestPromptTimestamp(messages: unknown[]): number {
  return messages.reduce<number>((latest, message) => {
    if (!message || typeof message !== "object") return latest;
    const row = message as Record<string, unknown>;
    if (row.role !== "user") return latest;
    const startedAt = row.startedAt;
    return typeof startedAt === "number" &&
      Number.isFinite(startedAt) &&
      startedAt > latest
      ? Math.trunc(startedAt)
      : latest;
  }, 0);
}

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
  const score = transcriptScore(msgs);
  // New clients timestamp user messages when they are submitted. A zero value
  // deliberately preserves the existing activity time for legacy snapshots,
  // so merely opening and re-saving a chat cannot move it in History.
  const lastPromptAt = latestPromptTimestamp(msgs);

  await db
    .prepare(
      `INSERT INTO ask_threads
        (id, userId, title, messages, messageCount, transcriptScore, cite, kind, sourceHref, runId, status, lastPromptAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = CASE
           WHEN (
               COALESCE(excluded.transcriptScore, 0) < COALESCE(ask_threads.transcriptScore, 0)
               OR (
                 excluded.status = 'running'
                 AND ask_threads.status IS NOT NULL
                 AND ask_threads.status != 'running'
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
               OR (
                 ask_threads.runId IS NOT NULL
                 AND (excluded.runId IS NULL OR ask_threads.runId != excluded.runId)
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
             )
           THEN ask_threads.title
           ELSE excluded.title
         END,
         messages = CASE
           WHEN (
               COALESCE(excluded.transcriptScore, 0) < COALESCE(ask_threads.transcriptScore, 0)
               OR (
                 excluded.status = 'running'
                 AND ask_threads.status IS NOT NULL
                 AND ask_threads.status != 'running'
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
               OR (
                 ask_threads.runId IS NOT NULL
                 AND (excluded.runId IS NULL OR ask_threads.runId != excluded.runId)
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
             )
           THEN ask_threads.messages
           ELSE excluded.messages
         END,
         messageCount = CASE
           WHEN (
               COALESCE(excluded.transcriptScore, 0) < COALESCE(ask_threads.transcriptScore, 0)
               OR (
                 excluded.status = 'running'
                 AND ask_threads.status IS NOT NULL
                 AND ask_threads.status != 'running'
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
               OR (
                 ask_threads.runId IS NOT NULL
                 AND (excluded.runId IS NULL OR ask_threads.runId != excluded.runId)
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
             )
           THEN ask_threads.messageCount
           ELSE excluded.messageCount
         END,
         transcriptScore = CASE
           WHEN (
               COALESCE(excluded.transcriptScore, 0) < COALESCE(ask_threads.transcriptScore, 0)
               OR (
                 excluded.status = 'running'
                 AND ask_threads.status IS NOT NULL
                 AND ask_threads.status != 'running'
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
               OR (
                 ask_threads.runId IS NOT NULL
                 AND (excluded.runId IS NULL OR ask_threads.runId != excluded.runId)
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
             )
           THEN ask_threads.transcriptScore
           ELSE excluded.transcriptScore
         END,
         cite = excluded.cite,
         kind = excluded.kind,
         sourceHref = excluded.sourceHref,
         runId = CASE
           WHEN (
               COALESCE(excluded.transcriptScore, 0) < COALESCE(ask_threads.transcriptScore, 0)
               OR (
                 excluded.status = 'running'
                 AND ask_threads.status IS NOT NULL
                 AND ask_threads.status != 'running'
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
               OR (
                 ask_threads.runId IS NOT NULL
                 AND (excluded.runId IS NULL OR ask_threads.runId != excluded.runId)
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
             )
           THEN ask_threads.runId
           ELSE excluded.runId
         END,
         status = CASE
           WHEN (
               COALESCE(excluded.transcriptScore, 0) < COALESCE(ask_threads.transcriptScore, 0)
               OR (
                 excluded.status = 'running'
                 AND ask_threads.status IS NOT NULL
                 AND ask_threads.status != 'running'
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
               OR (
                 ask_threads.runId IS NOT NULL
                 AND (excluded.runId IS NULL OR ask_threads.runId != excluded.runId)
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
             )
           THEN ask_threads.status
           ELSE excluded.status
         END,
         unread = CASE
           WHEN (
               COALESCE(excluded.transcriptScore, 0) < COALESCE(ask_threads.transcriptScore, 0)
               OR (
                 excluded.status = 'running'
                 AND ask_threads.status IS NOT NULL
                 AND ask_threads.status != 'running'
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
               OR (
                 ask_threads.runId IS NOT NULL
                 AND (excluded.runId IS NULL OR ask_threads.runId != excluded.runId)
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
             )
           THEN ask_threads.unread
           ELSE 0
         END,
         lastPromptAt = CASE
           WHEN excluded.lastPromptAt > ask_threads.lastPromptAt
           THEN excluded.lastPromptAt
           ELSE ask_threads.lastPromptAt
         END,
         updatedAt = CASE
           WHEN (
               COALESCE(excluded.transcriptScore, 0) < COALESCE(ask_threads.transcriptScore, 0)
               OR (
                 excluded.status = 'running'
                 AND ask_threads.status IS NOT NULL
                 AND ask_threads.status != 'running'
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
               OR (
                 ask_threads.runId IS NOT NULL
                 AND (excluded.runId IS NULL OR ask_threads.runId != excluded.runId)
                 AND COALESCE(excluded.transcriptScore, 0) <= COALESCE(ask_threads.transcriptScore, 0)
               )
             )
           THEN ask_threads.updatedAt
           ELSE excluded.updatedAt
         END
       WHERE ask_threads.userId = excluded.userId`,
    )
    .bind(
      input.id,
      input.userId,
      input.title.slice(0, 200),
      json,
      msgs.length,
      score,
      input.cite || null,
      input.kind || null,
      input.sourceHref || null,
      input.runId || null,
      input.status || null,
      lastPromptAt,
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
  lastPromptAt: number;
  createdAt: number;
  updatedAt: number;
  runId: string | null;
  status: string | null;
  unread: number | null;
}

export async function listThreads(userId: string): Promise<ThreadSummary[]> {
  const db = await getDb();
  // Only a newly submitted user prompt advances lastPromptAt. Autosaves,
  // status reconciliation, and viewing another thread leave the order alone.
  const { results } = await db
    .prepare(
      `SELECT id, title, cite, kind, sourceHref, messageCount, lastPromptAt, createdAt, updatedAt, runId, status, unread
       FROM ask_threads
       WHERE userId = ?
       ORDER BY lastPromptAt DESC, createdAt DESC, id DESC
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
    lastPromptAt: Number(r.lastPromptAt) || Number(r.createdAt),
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt),
    runId: r.runId,
    status: r.status,
    unread: Number(r.unread) === 1,
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
      `SELECT id, title, messages, messageCount, cite, kind, sourceHref, runId, status, unread, lastPromptAt, createdAt, updatedAt
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
    lastPromptAt: Number(row.lastPromptAt) || Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    createdAt: Number(row.createdAt),
    runId: row.runId,
    status: row.status,
    unread: Number(row.unread) === 1,
    messages,
  };
}

export async function updateThreadRunStatus(input: {
  userId: string;
  id: string;
  status: "running" | "done" | "error" | "stopped";
  unread?: boolean;
  /** Explicitly remove a stale completion notification. */
  clearUnread?: boolean;
  /** Avoid re-notifying a terminal row that the foreground client has seen. */
  unreadOnlyIfRunning?: boolean;
}): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `UPDATE ask_threads
       SET status = ?,
           unread = CASE
             WHEN ? = 1 THEN 0
             WHEN ? = 1 AND (? = 0 OR status = 'running') THEN 1
             ELSE unread
           END,
           updatedAt = ?
       WHERE userId = ? AND id = ?`,
    )
    .bind(
      input.status,
      input.clearUnread ? 1 : 0,
      input.unread ? 1 : 0,
      input.unreadOnlyIfRunning ? 1 : 0,
      Date.now(),
      input.userId,
      input.id,
    )
    .run();
}

export async function markThreadSeen(
  userId: string,
  id: string,
): Promise<void> {
  const db = await getDb();
  await db
    .prepare(`UPDATE ask_threads SET unread = 0 WHERE userId = ? AND id = ?`)
    .bind(userId, id)
    .run();
}

export async function deleteThread(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db
    .prepare(`DELETE FROM ask_threads WHERE userId = ? AND id = ?`)
    .bind(userId, id)
    .run();
}

import type { AgentEvent } from "../lib/agent";
import { boundedText, MAX_ASK_TEXT_BYTES } from "./ask-security";

const MAX_PROMPT_BYTES = 1_000_000;
const EVENT_BATCH_SIZE = 50;

type TerminalStatus = "done" | "error" | "stopped";

export type TrajectoryRating = "helpful" | "not_helpful";

export interface TrajectoryRatingRow {
  runId: string;
  rating: TrajectoryRating | null;
  ratedAt: number | null;
  reason: string | null;
  reasonAt: number | null;
}

export interface TrajectoryStart {
  runId: string;
  threadId?: string;
  userId: string;
  title?: string;
  question: string;
  prompt: string;
  model: string;
  cite?: string;
  kind?: string;
  sourceHref?: string;
  startedAt: number;
}

export interface SequencedAgentEvent {
  seq: number;
  event: AgentEvent;
}

function clipped(value: string, maxBytes: number): string {
  return boundedText(value, maxBytes).text;
}

/** Create a run summary without ever resetting an already-started run. */
export async function startTrajectory(
  db: D1Database | undefined,
  input: TrajectoryStart,
): Promise<void> {
  if (!db) return;
  await db
    .prepare(
      `INSERT OR IGNORE INTO ask_trajectories
        (runId, threadId, userId, title, question, prompt, model, cite, kind, sourceHref,
         status, startedAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
    )
    .bind(
      input.runId,
      input.threadId || null,
      input.userId,
      input.title?.slice(0, 200) || null,
      clipped(input.question, MAX_PROMPT_BYTES),
      clipped(input.prompt, MAX_PROMPT_BYTES),
      input.model.slice(0, 100),
      input.cite?.slice(0, 300) || null,
      input.kind?.slice(0, 40) || null,
      input.sourceHref?.slice(0, 800) || null,
      input.startedAt,
      input.startedAt,
    )
    .run();
}

/** Persist ordered normalized events and keep a query-friendly output summary. */
export async function recordTrajectoryEvents(
  db: D1Database | undefined,
  runId: string,
  events: SequencedAgentEvent[],
): Promise<void> {
  if (!db || events.length === 0) return;
  const now = Date.now();

  for (let offset = 0; offset < events.length; offset += EVENT_BATCH_SIZE) {
    const chunk = events.slice(offset, offset + EVENT_BATCH_SIZE);
    await db.batch(
      chunk.map(({ seq, event }) => {
        // The canonical final answer lives on the summary row. Avoid storing a
        // second full copy in the terminal event payload.
        const payload = event.type === "done" ? { ...event, text: "" } : event;
        return db
          .prepare(
            `INSERT OR IGNORE INTO ask_trajectory_events
              (runId, seq, type, payload, createdAt)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(runId, seq, event.type, JSON.stringify(payload), now);
      }),
    );
  }

  const maxSeq = Math.max(...events.map(({ seq }) => seq));
  const deltas = events.filter(
    (
      row,
    ): row is SequencedAgentEvent & {
      event: Extract<AgentEvent, { type: "delta" }>;
    } => row.event.type === "delta",
  );
  const deltaText = clipped(
    deltas.map(({ event }) => event.text).join(""),
    MAX_ASK_TEXT_BYTES,
  );
  const firstDeltaSeq = deltas[0]?.seq ?? -1;
  const lastDeltaSeq = deltas[deltas.length - 1]?.seq ?? -1;
  const done = [...events].reverse().find(
    (
      row,
    ): row is SequencedAgentEvent & {
      event: Extract<AgentEvent, { type: "done" }>;
    } => row.event.type === "done",
  );
  const error = [...events].reverse().find(
    (
      row,
    ): row is SequencedAgentEvent & {
      event: Extract<AgentEvent, { type: "error" }>;
    } => row.event.type === "error",
  );

  if (done) {
    await db
      .prepare(
        `UPDATE ask_trajectories
         SET output = ?, outputEventSeq = ?, status = 'done', error = NULL,
             costUsd = ?, contextTokens = ?,
             eventCount = MAX(eventCount, ?), completedAt = ?, updatedAt = ?
         WHERE runId = ?`,
      )
      .bind(
        clipped(done.event.text, MAX_ASK_TEXT_BYTES),
        maxSeq,
        done.event.costUsd,
        done.event.contextTokens,
        maxSeq + 1,
        now,
        now,
        runId,
      )
      .run();
    return;
  }

  await db
    .prepare(
      `UPDATE ask_trajectories
       SET output = CASE
             WHEN ? >= 0 AND outputEventSeq < ? THEN output || ?
             ELSE output
           END,
           outputEventSeq = CASE
             WHEN ? >= 0 AND outputEventSeq < ? THEN ?
             ELSE outputEventSeq
           END,
           status = CASE WHEN ? IS NOT NULL THEN 'error' ELSE status END,
           error = COALESCE(?, error),
           eventCount = MAX(eventCount, ?),
           completedAt = CASE WHEN ? IS NOT NULL THEN ? ELSE completedAt END,
           updatedAt = ?
       WHERE runId = ?`,
    )
    .bind(
      firstDeltaSeq,
      firstDeltaSeq,
      deltaText,
      lastDeltaSeq,
      firstDeltaSeq,
      lastDeltaSeq,
      error?.event.message ?? null,
      error?.event.message ?? null,
      maxSeq + 1,
      error?.event.message ?? null,
      now,
      now,
      runId,
    )
    .run();
}

/** Mark the authoritative terminal status even when no terminal event exists. */
export async function finishTrajectory(
  db: D1Database | undefined,
  runId: string,
  status: TerminalStatus,
): Promise<void> {
  if (!db) return;
  const now = Date.now();
  await db
    .prepare(
      `UPDATE ask_trajectories
       SET status = ?, completedAt = COALESCE(completedAt, ?), updatedAt = ?
       WHERE runId = ?`,
    )
    .bind(status, now, now, runId)
    .run();
}

/** List the owner's rateable completed runs without exposing trajectory content. */
export async function listTrajectoryRatings(
  db: D1Database,
  userId: string,
  threadId: string,
): Promise<TrajectoryRatingRow[]> {
  const { results } = await db
    .prepare(
      `SELECT runId, rating, ratedAt, feedbackReason, feedbackReasonAt
       FROM ask_trajectories
       WHERE userId = ? AND threadId = ? AND status = 'done'
       ORDER BY startedAt ASC`,
    )
    .bind(userId, threadId)
    .all<{
      runId: string;
      rating: string | null;
      ratedAt: number | null;
      feedbackReason: string | null;
      feedbackReasonAt: number | null;
    }>();

  return (results ?? []).map((row) => ({
    runId: row.runId,
    rating:
      row.rating === "helpful" || row.rating === "not_helpful"
        ? row.rating
        : null,
    ratedAt:
      row.ratedAt === null || !Number.isFinite(Number(row.ratedAt))
        ? null
        : Number(row.ratedAt),
    reason:
      row.rating === "not_helpful" && typeof row.feedbackReason === "string"
        ? row.feedbackReason
        : null,
    reasonAt:
      row.rating !== "not_helpful" ||
      row.feedbackReasonAt === null ||
      !Number.isFinite(Number(row.feedbackReasonAt))
        ? null
        : Number(row.feedbackReasonAt),
  }));
}

/** Set, change, or clear feedback only on the owner's completed run. */
export async function setTrajectoryRating(
  db: D1Database,
  input: {
    runId: string;
    userId: string;
    rating: TrajectoryRating | null;
  },
): Promise<{ runId: string; rating: TrajectoryRating | null } | null> {
  const now = Date.now();
  const row = await db
    .prepare(
      `UPDATE ask_trajectories
       SET rating = ?, ratedAt = CASE WHEN ? IS NULL THEN NULL ELSE ? END,
           feedbackReason = CASE
             WHEN ? = 'not_helpful' THEN feedbackReason
             ELSE NULL
           END,
           feedbackReasonAt = CASE
             WHEN ? = 'not_helpful' THEN feedbackReasonAt
             ELSE NULL
           END,
           updatedAt = MAX(updatedAt, ?)
       WHERE runId = ? AND userId = ? AND status = 'done'
       RETURNING runId, rating`,
    )
    .bind(
      input.rating,
      input.rating,
      now,
      input.rating,
      input.rating,
      now,
      input.runId,
      input.userId,
    )
    .first<{ runId: string; rating: string | null }>();

  if (!row) return null;
  return {
    runId: row.runId,
    rating:
      row.rating === "helpful" || row.rating === "not_helpful"
        ? row.rating
        : null,
  };
}

/** Add, change, or clear a reason only after the owner rates a run negatively. */
export async function setTrajectoryFeedbackReason(
  db: D1Database,
  input: {
    runId: string;
    userId: string;
    reason: string | null;
  },
): Promise<{ runId: string; reason: string | null } | null> {
  const now = Date.now();
  const row = await db
    .prepare(
      `UPDATE ask_trajectories
       SET feedbackReason = ?,
           feedbackReasonAt = CASE WHEN ? IS NULL THEN NULL ELSE ? END,
           updatedAt = MAX(updatedAt, ?)
       WHERE runId = ? AND userId = ? AND status = 'done'
         AND rating = 'not_helpful'
       RETURNING runId, feedbackReason`,
    )
    .bind(input.reason, input.reason, now, now, input.runId, input.userId)
    .first<{ runId: string; feedbackReason: string | null }>();

  if (!row) return null;
  return { runId: row.runId, reason: row.feedbackReason };
}

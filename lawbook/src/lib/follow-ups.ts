/**
 * Private follow-up workflow (#199).
 *
 * A follow-up is tracked state, not a colour. It keys on the annotation, never on
 * the annotation's label, which is exactly what makes #199's promise hold: the
 * "Follow up" label can be renamed, recoloured, or replaced entirely and the
 * open/resolved state is untouched, because the state never lived in the label.
 *
 * Resolved follow-ups are kept rather than deleted, so a reader can see what they
 * have already dealt with without it crowding the default view.
 */
import { getAuthDb } from "@/lib/d1";
import {
  isOverdue,
  normalizeDueAt,
  normalizeFollowUpNote,
} from "@/lib/follow-up-rules";

export {
  isOverdue,
  MAX_FOLLOW_UP_NOTE,
  normalizeDueAt,
  normalizeFollowUpNote,
} from "@/lib/follow-up-rules";

export interface FollowUp {
  annotationId: string;
  note: string | null;
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

export interface FollowUpItem extends FollowUp {
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  citation: string;
  path: string;
  exactText: string;
  label: string;
  overdue: boolean;
}

const SELECT_ITEM = `SELECT f.annotationId, f.note, f.dueAt, f.createdAt,
    f.updatedAt, f.resolvedAt, a.docType, a.docId, p.title, p.citation, p.path,
    p.exactText, p.label
  FROM annotation_follow_ups f
  JOIN passage_annotations p ON p.userId = f.userId AND p.id = f.annotationId
  JOIN saved_authorities a ON a.userId = p.userId AND a.id = p.authorityId`;

/**
 * Open or resolve a follow-up on one annotation. Idempotent per annotation, so a
 * double tap marks rather than duplicates.
 */
export async function setFollowUp(
  userId: string,
  annotationId: string,
  changes: { note?: string | null; dueAt?: number | null; resolved?: boolean },
): Promise<FollowUpItem | null> {
  const db = await getAuthDb();
  const now = Date.now();
  const resolvedAt = changes.resolved ? now : null;
  // The insert is bound to an annotation this owner actually has, so a borrowed
  // annotation id resolves to no row rather than crossing accounts.
  await db
    .prepare(`INSERT INTO annotation_follow_ups
        (userId, annotationId, note, dueAt, createdAt, updatedAt, resolvedAt)
      SELECT ?, p.id, ?, ?, ?, ?, ?
      FROM passage_annotations p
      WHERE p.userId = ? AND p.id = ? AND p.deletedAt IS NULL
      ON CONFLICT(userId, annotationId) DO UPDATE SET
        note = CASE WHEN ? THEN excluded.note ELSE annotation_follow_ups.note END,
        dueAt = CASE WHEN ? THEN excluded.dueAt
          ELSE annotation_follow_ups.dueAt END,
        resolvedAt = CASE WHEN ? THEN excluded.resolvedAt
          ELSE annotation_follow_ups.resolvedAt END,
        updatedAt = excluded.updatedAt`)
    .bind(
      userId,
      changes.note ?? null,
      changes.dueAt ?? null,
      now,
      now,
      resolvedAt,
      userId,
      annotationId,
      changes.note !== undefined ? 1 : 0,
      changes.dueAt !== undefined ? 1 : 0,
      changes.resolved !== undefined ? 1 : 0,
    )
    .run();
  return getFollowUp(userId, annotationId);
}

export async function getFollowUp(
  userId: string,
  annotationId: string,
): Promise<FollowUpItem | null> {
  const db = await getAuthDb();
  const row = await db
    .prepare(`${SELECT_ITEM} WHERE f.userId = ? AND f.annotationId = ?`)
    .bind(userId, annotationId)
    .first<Omit<FollowUpItem, "overdue">>();
  return row ? { ...row, overdue: isOverdue(row.dueAt, row.resolvedAt) } : null;
}

/** Remove the follow-up but never the annotation it was attached to. */
export async function deleteFollowUp(
  userId: string,
  annotationId: string,
): Promise<boolean> {
  const db = await getAuthDb();
  const deleted = await db
    .prepare(`DELETE FROM annotation_follow_ups
      WHERE userId = ? AND annotationId = ? RETURNING annotationId`)
    .bind(userId, annotationId)
    .first<{ annotationId: string }>();
  return Boolean(deleted);
}

export interface FollowUpListOptions {
  /** Default lists open items only; resolved stay reachable on request. */
  state?: "open" | "resolved" | "all";
  docType?: "judgment" | "statute";
  docId?: string;
  limit?: number;
}

/**
 * List follow-ups for the owner, soonest due first and undated last, so a list
 * with dates reads as a queue and one without still reads as a list.
 */
export async function listFollowUps(
  userId: string,
  options: FollowUpListOptions = {},
): Promise<FollowUpItem[]> {
  const state = options.state ?? "open";
  const limit = Math.max(1, Math.min(200, options.limit ?? 100));
  const db = await getAuthDb();
  const result = await db
    .prepare(`${SELECT_ITEM}
      WHERE f.userId = ? AND p.deletedAt IS NULL
        AND (? = 'all'
          OR (? = 'open' AND f.resolvedAt IS NULL)
          OR (? = 'resolved' AND f.resolvedAt IS NOT NULL))
        AND (? = '' OR a.docType = ?)
        AND (? = '' OR a.docId = ?)
      ORDER BY f.resolvedAt IS NOT NULL, f.dueAt IS NULL, f.dueAt ASC,
        f.createdAt DESC
      LIMIT ?`)
    .bind(
      userId,
      state,
      state,
      state,
      options.docType ?? "",
      options.docType ?? "",
      options.docId ?? "",
      options.docId ?? "",
      limit,
    )
    .all<Omit<FollowUpItem, "overdue">>();
  return (result.results ?? []).map((row) => ({
    ...row,
    overdue: isOverdue(row.dueAt, row.resolvedAt),
  }));
}

export function normalizeFollowUpChanges(
  value: unknown,
): { note?: string | null; dueAt?: number | null; resolved?: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const changes: {
    note?: string | null;
    dueAt?: number | null;
    resolved?: boolean;
  } = {};
  if (raw.note !== undefined) {
    const note = normalizeFollowUpNote(raw.note);
    if (note === undefined) return null;
    changes.note = note;
  }
  if (raw.dueAt !== undefined) {
    const dueAt = normalizeDueAt(raw.dueAt);
    if (dueAt === undefined) return null;
    changes.dueAt = dueAt;
  }
  if (raw.resolved !== undefined) {
    if (typeof raw.resolved !== "boolean") return null;
    changes.resolved = raw.resolved;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

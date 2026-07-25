/**
 * Pure rules for follow-ups (#199).
 *
 * Separate from follow-ups.ts, which touches D1, so overdue and timezone
 * behaviour can be executed in tests rather than reasoned about.
 */
export const MAX_FOLLOW_UP_NOTE = 2_000;

/**
 * `null` clears the note. `undefined` means the input was unusable, so the caller
 * answers 400 rather than silently discarding what the reader typed.
 */
export function normalizeFollowUpNote(
  value: unknown,
): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (cleaned.length > MAX_FOLLOW_UP_NOTE) return undefined;
  return cleaned || null;
}

/**
 * A due date is stored as a UTC instant, never a local calendar date. Overdue is
 * then a comparison of two instants, so it cannot flip because the reader
 * travelled or because the server runs in another zone.
 */
export function normalizeDueAt(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // A bare calendar date means end of that day UTC, so "due today" does not read
  // as overdue for the whole day.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const stamp = Date.UTC(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
      23,
      59,
      59,
      999,
    );
    return Number.isNaN(stamp) ? undefined : stamp;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Resolved items are never overdue, however old their date. */
export function isOverdue(
  dueAt: number | null,
  resolvedAt: number | null,
  now: number = Date.now(),
): boolean {
  if (resolvedAt !== null || dueAt === null) return false;
  return dueAt < now;
}

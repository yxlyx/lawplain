/**
 * Pagination cursors for private research listings.
 *
 * A cursor carries its owner and the exact query shape it was issued for, and
 * both are checked on decode. That is what makes a guessed, borrowed, or replayed
 * cursor useless: it cannot page another account's rows, and it cannot be reused
 * against a different filter set to walk past the filter.
 */
export type Cursor = {
  v: 1;
  owner: string;
  shape: string;
  at: number;
  id: string;
};

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(
  value: string | null,
  owner: string,
  shape: string,
): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString(),
    ) as Cursor;
    return parsed.v === 1 &&
      parsed.owner === owner &&
      parsed.shape === shape &&
      Number.isSafeInteger(parsed.at) &&
      typeof parsed.id === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

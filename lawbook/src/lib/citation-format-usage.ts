import { CITATION_FORMAT_LABELS, type CitationFormat } from "@/lib/citations";
import { getAuthDb } from "@/lib/d1";

export interface CitationFormatUsage {
  format: CitationFormat;
  count: number;
  firstUsedAt: number;
  lastUsedAt: number;
}

export function isCitationFormat(value: unknown): value is CitationFormat {
  return (
    typeof value === "string" && Object.hasOwn(CITATION_FORMAT_LABELS, value)
  );
}

export async function listCitationFormatUsage(
  userId: string,
): Promise<CitationFormatUsage[]> {
  const db = await getAuthDb();
  const result = await db
    .prepare(
      `SELECT format, count, firstUsedAt, lastUsedAt
       FROM citation_format_usage
       WHERE userId = ?
       ORDER BY count DESC, lastUsedAt DESC`,
    )
    .bind(userId)
    .all<CitationFormatUsage>();

  return (result.results ?? []).filter((row) => isCitationFormat(row.format));
}

export async function recordCitationFormatUsage({
  userId,
  format,
}: {
  userId: string;
  format: CitationFormat;
}): Promise<CitationFormatUsage> {
  const db = await getAuthDb();
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO citation_format_usage (userId, format, count, firstUsedAt, lastUsedAt)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(userId, format) DO UPDATE SET
         count = count + 1,
         lastUsedAt = excluded.lastUsedAt`,
    )
    .bind(userId, format, now, now)
    .run();

  return (
    (await db
      .prepare(
        `SELECT format, count, firstUsedAt, lastUsedAt
         FROM citation_format_usage
         WHERE userId = ? AND format = ?`,
      )
      .bind(userId, format)
      .first<CitationFormatUsage>()) ?? {
      format,
      count: 1,
      firstUsedAt: now,
      lastUsedAt: now,
    }
  );
}

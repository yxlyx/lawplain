export type SuggestionDocType = "judgment" | "statute";

export interface SuggestedSection {
  sectionId: string;
  count: number;
}

export interface SuggestionsResult {
  total: number;
  sections: SuggestedSection[];
}

export const DEFAULT_MIN_SAMPLE = 30;

export function normalizeSuggestionTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getMinSample(): number {
  const raw = process.env.SUGGESTIONS_MIN_SAMPLE;
  if (!raw) return DEFAULT_MIN_SAMPLE;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_MIN_SAMPLE;
}

export function isSuggestionDocType(value: string): value is SuggestionDocType {
  return value === "judgment" || value === "statute";
}

export async function getSuggestions({
  db,
  docType,
  docId,
  term,
  minSample = getMinSample(),
}: {
  db: D1Database;
  docType: SuggestionDocType;
  docId: string;
  term: string;
  minSample?: number;
}): Promise<SuggestionsResult> {
  const normalizedTerm = normalizeSuggestionTerm(term);
  if (!docId.trim() || !normalizedTerm) return { total: 0, sections: [] };

  try {
    const totalRow = await db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM section_engagement_sample
         WHERE doc_type = ? AND doc_id = ? AND term = ?`,
      )
      .bind(docType, docId, normalizedTerm)
      .first<{ total: number }>();

    const total = Number(totalRow?.total ?? 0);
    if (total < minSample) return { total: 0, sections: [] };

    const { results } = await db
      .prepare(
        `SELECT section_id AS sectionId, count
         FROM section_engagement
         WHERE doc_type = ? AND doc_id = ? AND term = ?
         ORDER BY count DESC, section_id ASC
         LIMIT 5`,
      )
      .bind(docType, docId, normalizedTerm)
      .all<SuggestedSection>();

    return {
      total,
      sections: (results ?? []).map((row) => ({
        sectionId: row.sectionId,
        count: Number(row.count),
      })),
    };
  } catch (err) {
    // A fresh/local D1 that has not run 0003_section_engagement.sql lacks the
    // engagement tables. Degrade to empty suggestions instead of 500ing the
    // user-facing endpoint; re-throw anything that isn't a missing-table error.
    if (isMissingTableError(err)) return { total: 0, sections: [] };
    throw err;
  }
}

function isMissingTableError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /no such table/i.test(message);
}

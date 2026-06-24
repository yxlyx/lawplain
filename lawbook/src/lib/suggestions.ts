import { getCloudflareContext } from "@opennextjs/cloudflare";

interface SuggestionsEnv extends CloudflareEnv {
  AUTH_DB?: D1Database;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Minimum number of observed samples (SUM(count)) before suggestions are
 * surfaced. Below this threshold the signal is too noisy, so `sections` is
 * returned empty. Overridable via SUGGESTIONS_MIN_SAMPLE.
 */
export const MIN_SAMPLE = parsePositiveInt(
  process.env.SUGGESTIONS_MIN_SAMPLE,
  30,
);

/** Maximum number of sections returned. */
export const TOP_N = 5;

export interface SuggestionSection {
  sectionId: string;
  count: number;
}

export interface SuggestionsResult {
  total: number;
  sections: SuggestionSection[];
}

export interface GetSuggestionsParams {
  docType: string;
  docId: string;
  term: string;
}

export async function getSuggestionsDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as SuggestionsEnv).AUTH_DB;

  if (!db) {
    throw new Error(
      "Missing Cloudflare D1 binding AUTH_DB. Create the D1 database and configure wrangler.jsonc before using suggestions.",
    );
  }

  return db;
}

// D1 returns SQLite INTEGER columns (incl. SUM/COUNT aggregates) as JS numbers.
interface SectionRow {
  section_id: string;
  count: number;
}

interface TotalRow {
  total: number | null;
}

/**
 * Returns the most-engaged sections for a given (docType, docId, term),
 * gated by MIN_SAMPLE. When total < MIN_SAMPLE, `sections` is empty but the
 * real `total` is still reported so callers can show progress toward the gate.
 *
 * Aggregate-only: never returns or exposes individual engagement events.
 */
export async function getSuggestions({
  docType,
  docId,
  term,
}: GetSuggestionsParams): Promise<SuggestionsResult> {
  const db = await getSuggestionsDb();

  const totalRow = await db
    .prepare(
      `SELECT COALESCE(SUM(count), 0) AS total
       FROM section_engagement
       WHERE doc_type = ? AND doc_id = ? AND term = ?`,
    )
    .bind(docType, docId, term)
    .first<TotalRow>();

  const total = totalRow?.total ?? 0;

  if (total < MIN_SAMPLE) {
    return { total, sections: [] };
  }

  const result = await db
    .prepare(
      `SELECT section_id, count
       FROM section_engagement
       WHERE doc_type = ? AND doc_id = ? AND term = ?
       ORDER BY count DESC, section_id ASC
       LIMIT ?`,
    )
    .bind(docType, docId, term, TOP_N)
    .all<SectionRow>();

  const sections: SuggestionSection[] = (result.results ?? []).map((row) => ({
    sectionId: row.section_id,
    count: row.count,
  }));

  return { total, sections };
}

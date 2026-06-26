import { getAuthDb } from "@/lib/d1";

export const SEARCH_TABS = [
  "judgments",
  "statutes",
  "hansard",
  "bills",
  "subsidiary",
  "practice",
] as const;

export type SearchTab = (typeof SEARCH_TABS)[number];
export type SearchFilters = Record<string, string>;

export interface SearchResultSnapshotItem {
  id: string;
  rank: number;
  title: string;
  path: string;
  citation?: string;
  reference?: string;
  score?: number;
}

export interface SearchHistoryEntry {
  id: string;
  tab: SearchTab;
  query: string;
  filters: SearchFilters;
  resultCount: number;
  topResults: SearchResultSnapshotItem[];
  createdAt: number;
}

interface SearchHistoryRow {
  id: string;
  tab: SearchTab;
  query: string;
  filters: string;
  resultCount: number;
  topResults: string;
  createdAt: number;
}

const HISTORY_LIMIT = 50;
const MAX_QUERY_LENGTH = 500;
const MAX_FILTER_VALUE_LENGTH = 250;
const MAX_TITLE_LENGTH = 500;
const MAX_PATH_LENGTH = 800;
const MAX_SNAPSHOT_ITEMS = 50;

export function isSearchTab(value: unknown): value is SearchTab {
  return typeof value === "string" && SEARCH_TABS.includes(value as SearchTab);
}

export function normalizeSearchQuery(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_QUERY_LENGTH)
    : "";
}

export function normalizeSearchFilters(value: unknown): SearchFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: SearchFilters = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!key || raw == null) continue;
    const cleanKey = key.trim().slice(0, 80);
    const cleanValue = String(raw).trim().slice(0, MAX_FILTER_VALUE_LENGTH);
    if (cleanKey && cleanValue) out[cleanKey] = cleanValue;
  }
  return out;
}

export function normalizeResultSnapshot(
  value: unknown,
  { limit = MAX_SNAPSHOT_ITEMS }: { limit?: number } = {},
): SearchResultSnapshotItem[] {
  if (!Array.isArray(value)) return [];
  const safeLimit = Math.max(1, Math.min(limit, MAX_SNAPSHOT_ITEMS));
  const out: SearchResultSnapshotItem[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const id = cleanString(raw.id, 300);
    const title = cleanString(raw.title, MAX_TITLE_LENGTH);
    const path = cleanString(raw.path, MAX_PATH_LENGTH);
    if (!id || !title || !path.startsWith("/")) continue;

    const rank = toSafeInteger(raw.rank, out.length + 1);
    const score =
      typeof raw.score === "number" && Number.isFinite(raw.score)
        ? raw.score
        : undefined;
    const citation = cleanString(raw.citation, 300) || undefined;
    const reference = cleanString(raw.reference, 300) || undefined;

    out.push({ id, rank, title, path, citation, reference, score });
    if (out.length >= safeLimit) break;
  }

  return out;
}

export async function recordSearchHistory({
  userId,
  tab,
  query,
  filters = {},
  resultCount = 0,
  topResults = [],
}: {
  userId: string;
  tab: SearchTab;
  query: string;
  filters?: SearchFilters;
  resultCount?: number;
  topResults?: SearchResultSnapshotItem[];
}): Promise<void> {
  const cleanQuery = normalizeSearchQuery(query);
  if (!cleanQuery) return;

  const db = await getAuthDb();
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const safeResultCount = Math.max(0, Math.floor(resultCount));

  await db.batch([
    db
      .prepare(
        `INSERT INTO search_history (id, userId, tab, query, filters, resultCount, topResults, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        userId,
        tab,
        cleanQuery,
        JSON.stringify(normalizeSearchFilters(filters)),
        safeResultCount,
        JSON.stringify(normalizeResultSnapshot(topResults, { limit: 10 })),
        createdAt,
      ),
    db
      .prepare(
        `DELETE FROM search_history
         WHERE userId = ?
           AND id NOT IN (
             SELECT id
             FROM search_history
             WHERE userId = ?
             ORDER BY createdAt DESC, id DESC
             LIMIT ?
           )`,
      )
      .bind(userId, userId, HISTORY_LIMIT),
  ]);
}

export async function listSearchHistory({
  userId,
  tab,
  limit = HISTORY_LIMIT,
}: {
  userId: string;
  tab?: SearchTab;
  limit?: number;
}): Promise<SearchHistoryEntry[]> {
  const db = await getAuthDb();
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  const query = tab
    ? db
        .prepare(
          `SELECT id, tab, query, filters, resultCount, topResults, createdAt
           FROM search_history
           WHERE userId = ? AND tab = ?
           ORDER BY createdAt DESC, id DESC
           LIMIT ?`,
        )
        .bind(userId, tab, safeLimit)
    : db
        .prepare(
          `SELECT id, tab, query, filters, resultCount, topResults, createdAt
           FROM search_history
           WHERE userId = ?
           ORDER BY createdAt DESC, id DESC
           LIMIT ?`,
        )
        .bind(userId, safeLimit);

  const result = await query.all<SearchHistoryRow>();
  return (result.results ?? []).map(parseSearchHistoryRow);
}

export async function deleteSearchHistoryEntry({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const db = await getAuthDb();
  const result = await db
    .prepare("DELETE FROM search_history WHERE userId = ? AND id = ?")
    .bind(userId, id)
    .run();
  return Boolean(result.meta.changes);
}

export async function clearSearchHistory({
  userId,
}: {
  userId: string;
}): Promise<void> {
  const db = await getAuthDb();
  await db
    .prepare("DELETE FROM search_history WHERE userId = ?")
    .bind(userId)
    .run();
}

function parseSearchHistoryRow(row: SearchHistoryRow): SearchHistoryEntry {
  return {
    id: row.id,
    tab: row.tab,
    query: row.query,
    filters: parseJson(row.filters, {}),
    resultCount: row.resultCount,
    topResults: normalizeResultSnapshot(parseJson(row.topResults, [])),
    createdAt: row.createdAt,
  };
}

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function toSafeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback;
}

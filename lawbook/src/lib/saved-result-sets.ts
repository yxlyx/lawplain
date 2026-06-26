import { getAuthDb } from "@/lib/d1";
import {
  isSearchTab,
  normalizeResultSnapshot,
  normalizeSearchFilters,
  normalizeSearchQuery,
  parseJson,
  type SearchFilters,
  type SearchResultSnapshotItem,
  type SearchTab,
} from "@/lib/search-history";

export interface SavedResultSet {
  id: string;
  name: string;
  tab: SearchTab;
  query: string;
  filters: SearchFilters;
  resultCount: number;
  results: SearchResultSnapshotItem[];
  createdAt: number;
  updatedAt: number;
}

interface SavedResultSetRow {
  id: string;
  name: string;
  tab: SearchTab;
  query: string;
  filters: string;
  resultCount: number;
  results: string;
  createdAt: number;
  updatedAt: number;
}

const MAX_NAME_LENGTH = 120;
const DEFAULT_LIMIT = 50;

export function normalizeResultSetName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_NAME_LENGTH)
    : "";
}

export async function createSavedResultSet({
  userId,
  name,
  tab,
  query,
  filters = {},
  resultCount = 0,
  results = [],
}: {
  userId: string;
  name: string;
  tab: SearchTab;
  query: string;
  filters?: SearchFilters;
  resultCount?: number;
  results?: SearchResultSnapshotItem[];
}): Promise<SavedResultSet> {
  const cleanName = normalizeResultSetName(name);
  const cleanQuery = normalizeSearchQuery(query);
  if (!cleanName) throw new Error("Name is required");
  if (!isSearchTab(tab)) throw new Error("Invalid tab");
  if (!cleanQuery) throw new Error("Search query is required");

  const db = await getAuthDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const safeResultCount = Math.max(0, Math.floor(resultCount));
  const saved: SavedResultSet = {
    id,
    name: cleanName,
    tab,
    query: cleanQuery,
    filters: normalizeSearchFilters(filters),
    resultCount: safeResultCount,
    results: normalizeResultSnapshot(results, { limit: 50 }),
    createdAt: now,
    updatedAt: now,
  };

  await db
    .prepare(
      `INSERT INTO saved_result_set (id, userId, name, tab, query, filters, resultCount, results, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      saved.id,
      userId,
      saved.name,
      saved.tab,
      saved.query,
      JSON.stringify(saved.filters),
      saved.resultCount,
      JSON.stringify(saved.results),
      saved.createdAt,
      saved.updatedAt,
    )
    .run();

  return saved;
}

export async function listSavedResultSets({
  userId,
  tab,
  limit = DEFAULT_LIMIT,
}: {
  userId: string;
  tab?: SearchTab;
  limit?: number;
}): Promise<SavedResultSet[]> {
  const db = await getAuthDb();
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  const query = tab
    ? db
        .prepare(
          `SELECT id, name, tab, query, filters, resultCount, results, createdAt, updatedAt
           FROM saved_result_set
           WHERE userId = ? AND tab = ?
           ORDER BY updatedAt DESC, id DESC
           LIMIT ?`,
        )
        .bind(userId, tab, safeLimit)
    : db
        .prepare(
          `SELECT id, name, tab, query, filters, resultCount, results, createdAt, updatedAt
           FROM saved_result_set
           WHERE userId = ?
           ORDER BY updatedAt DESC, id DESC
           LIMIT ?`,
        )
        .bind(userId, safeLimit);

  const result = await query.all<SavedResultSetRow>();
  return (result.results ?? []).map(parseSavedResultSetRow);
}

export async function getSavedResultSet({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<SavedResultSet | null> {
  const db = await getAuthDb();
  const row = await db
    .prepare(
      `SELECT id, name, tab, query, filters, resultCount, results, createdAt, updatedAt
       FROM saved_result_set
       WHERE userId = ? AND id = ?`,
    )
    .bind(userId, id)
    .first<SavedResultSetRow>();
  return row ? parseSavedResultSetRow(row) : null;
}

export async function updateSavedResultSet({
  userId,
  id,
  name,
}: {
  userId: string;
  id: string;
  name: string;
}): Promise<SavedResultSet | null> {
  const cleanName = normalizeResultSetName(name);
  if (!cleanName) throw new Error("Name is required");
  const db = await getAuthDb();
  await db
    .prepare(
      "UPDATE saved_result_set SET name = ?, updatedAt = ? WHERE userId = ? AND id = ?",
    )
    .bind(cleanName, Date.now(), userId, id)
    .run();
  return getSavedResultSet({ userId, id });
}

export async function deleteSavedResultSet({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const db = await getAuthDb();
  const result = await db
    .prepare("DELETE FROM saved_result_set WHERE userId = ? AND id = ?")
    .bind(userId, id)
    .run();
  return Boolean(result.meta.changes);
}

export function compareResultSnapshots(
  left: SearchResultSnapshotItem[],
  right: SearchResultSnapshotItem[],
) {
  const leftById = new Map(left.map((item) => [item.id, item]));
  const rightById = new Map(right.map((item) => [item.id, item]));
  const overlap = left.filter((item) => rightById.has(item.id));
  const added = right.filter((item) => !leftById.has(item.id));
  const removed = left.filter((item) => !rightById.has(item.id));
  const rankDeltas = overlap.map((item) => {
    const other = rightById.get(item.id);
    return {
      id: item.id,
      title: other?.title ?? item.title,
      fromRank: item.rank,
      toRank: other?.rank ?? item.rank,
      delta: (other?.rank ?? item.rank) - item.rank,
    };
  });
  return { overlap, added, removed, rankDeltas };
}

function parseSavedResultSetRow(row: SavedResultSetRow): SavedResultSet {
  return {
    id: row.id,
    name: row.name,
    tab: row.tab,
    query: row.query,
    filters: normalizeSearchFilters(parseJson(row.filters, {})),
    resultCount: row.resultCount,
    results: normalizeResultSnapshot(parseJson(row.results, []), { limit: 50 }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

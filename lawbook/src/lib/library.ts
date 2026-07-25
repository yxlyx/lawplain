/**
 * My Library — the reader's personal research workspace (#195).
 *
 * One card per authority, whether it arrived by an explicit save, a first
 * highlight, or a first document note. The query itself lives in library-query.ts
 * so it can be executed in tests without a D1 binding.
 */
import { getAuthDb } from "@/lib/d1";
import {
  buildLibraryQuery,
  type LibraryOptions,
  type LibraryRow,
  toLibraryPage,
} from "@/lib/library-query";
import { purgeExpiredSoftDeletedAnnotations } from "@/lib/private-annotations";

export type {
  LibraryCard,
  LibraryFilters,
  LibraryOptions,
  LibrarySort,
} from "@/lib/library-query";
export { buildLibraryQuery, toLibraryPage } from "@/lib/library-query";

/**
 * Read one page of My Library for the signed-in owner.
 */
export async function listLibrary(
  userId: string,
  options: LibraryOptions = {},
) {
  const built = buildLibraryQuery(userId, options);
  // Expired tombstones must go before counting, or a card reports highlights the
  // reader already deleted.
  await purgeExpiredSoftDeletedAnnotations(userId);
  const db = await getAuthDb();
  const result = await db
    .prepare(built.sql)
    .bind(...built.params)
    .all<LibraryRow>();
  return toLibraryPage(result.results ?? [], {
    limit: built.limit,
    sort: built.sort,
    shape: built.shape,
    userId,
  });
}
